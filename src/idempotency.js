const crypto = require('crypto');

const CLIENT_MUTATION_HEADER = 'x-client-mutation-id';
const CLIENT_MUTATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function requestHash(req) {
  return crypto
    .createHash('sha256')
    .update(stableJson(req.body ?? null))
    .digest('hex');
}

function replayResponse(res, mutation) {
  res.set('X-Client-Mutation-Id', mutation.clientMutationId);
  res.set('X-Idempotent-Replay', 'true');
  return res
    .status(Number(mutation.responseStatus) || 200)
    .json(mutation.responseBody ?? {});
}

async function waitForCompletedMutation(getClientMutation, userId, clientMutationId, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || 5000;
  const pollIntervalMs = Number(options.pollIntervalMs) || 25;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const mutation = await getClientMutation(userId, clientMutationId);
    if (!mutation || mutation.state === 'completed') {
      return mutation;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return getClientMutation(userId, clientMutationId);
}

function supportsAtomicMutation(method, path) {
  // Only database mutations (plus idempotent photo removal on check-in deletion).
  // Uploads, OAuth, payments and external-provider operations have other protocols.
  if (method === 'POST' && ['/entries/bulk', '/quick-add', '/checkins'].includes(path)) return true;
  if (method === 'PUT' && /^\/day-completeness\/[^/]+$/.test(path)) return true;
  if (['PUT', 'DELETE'].includes(method) && /^\/entries\/[^/]+$/.test(path)) return true;
  if (method === 'DELETE' && /^\/checkins\/[^/]+$/.test(path)) return true;
  return (method === 'POST' && /^\/(weights|waist|workouts|sleep|sexual-activity)$/.test(path))
    || (['PUT', 'DELETE'].includes(method) && /^\/(weights|waist|workouts|sleep|sexual-activity)\/[^/]+$/.test(path));
}

function createClientMutationMiddleware({ runClientMutation, userIdFromRequest }) {
  if (typeof runClientMutation !== 'function' || typeof userIdFromRequest !== 'function') {
    throw new TypeError('Client mutation middleware requires a transactional executor and user id function.');
  }
  return async function clientMutationMiddleware(req, res, next) {
    const rawClientMutationId = req.get(CLIENT_MUTATION_HEADER);
    if (!rawClientMutationId) return next();
    const clientMutationId = String(rawClientMutationId).trim().toLowerCase();
    if (!CLIENT_MUTATION_ID_PATTERN.test(clientMutationId)) {
      return res.status(400).json({ error: 'X-Client-Mutation-Id must be a valid UUID.' });
    }
    if (!supportsAtomicMutation(req.method, req.path)) {
      return res.status(400).json({ error: 'X-Client-Mutation-Id is not supported for this operation.' });
    }
    const userId = String(userIdFromRequest(req) || '').trim();
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });
    const descriptor = { method: req.method, path: req.path, requestHash: requestHash(req) };
    const originalJson = res.json;
    let intercepted = false;
    let finished = false;
    let onClose;
    try {
      const result = await runClientMutation(userId, clientMutationId, descriptor, () => new Promise((resolve, reject) => {
        onClose = () => reject(new Error('Client disconnected before mutation committed.'));
        res.once('close', onClose);
        res.json = function captureMutationResponse(body) {
          if (!intercepted && !finished) {
            intercepted = true;
            // Snapshot before committing so serialization failure rolls back too.
            try {
              const normalized = JSON.parse(JSON.stringify(body ?? null));
              resolve({ status: res.statusCode, body: normalized });
            } catch (error) { reject(error); }
          }
          return res;
        };
        next();
      }));
      finished = true;
      res.json = originalJson;
      if (onClose) res.removeListener('close', onClose);
      if (res.destroyed) return;
      res.set('X-Client-Mutation-Id', clientMutationId);
      if (result.disposition === 'conflict') {
        return res.status(409).json({ error: 'This client mutation id was already used for a different request.' });
      }
      if (result.disposition === 'replay') return replayResponse(res, result.mutation);
      if (result.disposition === 'processing') {
        // Pre-atomic receipts have unknown outcomes. Old clients recognize "still
        // processing" as nonterminal and retain their queued health record.
        return res.status(409).json({
          error: 'This mutation is still processing in a legacy receipt with an unknown outcome. Preserve this change and contact support for recovery; do not submit it with a new id.',
          code: 'MUTATION_RECOVERY_REQUIRED', recoveryRequired: true
        });
      }
      return res.status(result.response.status).json(result.response.body);
    } catch (error) {
      finished = true;
      // Leave the capture in place for late route callbacks after rollback. Send
      // this response through the original method; late callbacks cannot send data.
      if (onClose) res.removeListener('close', onClose);
      if (res.destroyed) return;
      res.set('Retry-After', '1');
      res.status(error.code === '55P03' ? 409 : 503);
      return originalJson.call(res, {
        error: error.code === '55P03'
          ? 'This mutation is still processing. Retry with the same client mutation id.'
          : 'Mutation could not be confirmed. Retry with the same client mutation id.',
        code: 'MUTATION_RETRY_REQUIRED'
      });
    }
  };
}

module.exports = {
  CLIENT_MUTATION_HEADER,
  CLIENT_MUTATION_ID_PATTERN,
  createClientMutationMiddleware,
  requestHash,
  stableJson,
  supportsAtomicMutation,
  waitForCompletedMutation
};

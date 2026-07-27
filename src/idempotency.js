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

function createClientMutationMiddleware({
  claimClientMutation,
  getClientMutation,
  completeClientMutation,
  userIdFromRequest,
  onPersistenceError = () => {}
}) {
  if (
    typeof claimClientMutation !== 'function' ||
    typeof getClientMutation !== 'function' ||
    typeof completeClientMutation !== 'function' ||
    typeof userIdFromRequest !== 'function'
  ) {
    throw new TypeError('Client mutation middleware requires database and user id functions.');
  }

  return async function clientMutationMiddleware(req, res, next) {
    const rawClientMutationId = req.get(CLIENT_MUTATION_HEADER);
    if (!rawClientMutationId) {
      return next();
    }

    const clientMutationId = String(rawClientMutationId).trim().toLowerCase();
    if (!CLIENT_MUTATION_ID_PATTERN.test(clientMutationId)) {
      return res.status(400).json({ error: 'X-Client-Mutation-Id must be a valid UUID.' });
    }

    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return res.status(400).json({ error: 'X-Client-Mutation-Id is only valid for mutations.' });
    }

    const userId = String(userIdFromRequest(req) || '').trim();
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const descriptor = {
      method: req.method,
      path: req.path,
      requestHash: requestHash(req)
    };

    try {
      const claim = await claimClientMutation(userId, clientMutationId, descriptor);

      if (claim.disposition === 'conflict') {
        return res.status(409).json({
          error: 'This client mutation id was already used for a different request.'
        });
      }

      if (claim.disposition === 'replay') {
        return replayResponse(res, claim.mutation);
      }

      if (claim.disposition === 'processing') {
        const mutation = await waitForCompletedMutation(
          getClientMutation,
          userId,
          clientMutationId
        );
        if (mutation?.state === 'completed') {
          return replayResponse(res, mutation);
        }
        res.set('Retry-After', '1');
        return res.status(409).json({
          error: 'This mutation is still processing. Retry with the same client mutation id.'
        });
      }

      res.set('X-Client-Mutation-Id', clientMutationId);
      const originalJson = res.json.bind(res);
      let completionStarted = false;

      res.json = function idempotentJson(body) {
        if (!completionStarted) {
          completionStarted = true;
          Promise.resolve(
            completeClientMutation(userId, clientMutationId, {
              responseStatus: res.statusCode,
              responseBody: body ?? null
            })
          ).catch((error) => {
            onPersistenceError(error, {
              userId,
              clientMutationId,
              method: descriptor.method,
              path: descriptor.path
            });
          });
        }
        return originalJson(body);
      };

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  CLIENT_MUTATION_HEADER,
  CLIENT_MUTATION_ID_PATTERN,
  createClientMutationMiddleware,
  requestHash,
  stableJson,
  waitForCompletedMutation
};

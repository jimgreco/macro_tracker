const crypto = require('crypto');

const DEFAULT_BASE_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 15 * 60 * 1_000;
const DEFAULT_LEASE_MS = 2 * 60 * 1_000;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

function toPositiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.floor(numeric);
}

function retryDelayMs(attemptCount, {
  baseBackoffMs = DEFAULT_BASE_BACKOFF_MS,
  maxBackoffMs = DEFAULT_MAX_BACKOFF_MS
} = {}) {
  const base = toPositiveInteger(baseBackoffMs, DEFAULT_BASE_BACKOFF_MS);
  const maximum = Math.max(base, toPositiveInteger(maxBackoffMs, DEFAULT_MAX_BACKOFF_MS));
  const exponent = Math.max(0, Math.min(30, toPositiveInteger(attemptCount, 1) - 1));
  return Math.min(maximum, base * (2 ** exponent));
}

function safeFailureCode(error) {
  const candidate = String(error?.code || '').trim().toLowerCase();
  if (/^[a-z0-9_:-]{1,80}$/.test(candidate)) {
    return candidate;
  }
  return 'processing_error';
}

function canResurrectProviderRecord(event) {
  const eventType = String(event?.eventType || '').trim().toLowerCase();
  return event?.deliveryKind === 'webhook'
    && (eventType === 'create' || eventType === 'update');
}

function createWebhookWorker({
  claimEvents,
  markProcessed,
  markFailed,
  handlers = {},
  workerId = `webhook-${crypto.randomUUID()}`,
  leaseMs = DEFAULT_LEASE_MS,
  batchSize = DEFAULT_BATCH_SIZE,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  baseBackoffMs = DEFAULT_BASE_BACKOFF_MS,
  maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
  logger = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) {
  const normalizedLeaseMs = toPositiveInteger(leaseMs, DEFAULT_LEASE_MS);
  const normalizedBatchSize = toPositiveInteger(batchSize, DEFAULT_BATCH_SIZE);
  const normalizedPollIntervalMs = toPositiveInteger(
    pollIntervalMs,
    DEFAULT_POLL_INTERVAL_MS
  );
  const registeredProviders = Object.keys(handlers).filter(
    (provider) => typeof handlers[provider] === 'function'
  );
  let running = false;
  let timer = null;
  let currentRun = null;

  async function processEvent(event) {
    const handler = handlers[event.provider];
    if (typeof handler !== 'function') {
      const error = new Error(`No webhook handler is registered for ${event.provider}.`);
      error.code = 'unsupported_provider';
      throw error;
    }
    await handler(event);
  }

  async function settleEvent(event) {
    try {
      await processEvent(event);
      await markProcessed(event.id, workerId);
      logger('info', 'webhook_event_processed', {
        eventId: event.id,
        provider: event.provider,
        eventType: event.eventType,
        attemptCount: event.attemptCount
      });
    } catch (error) {
      const failureCode = safeFailureCode(error);
      const delayMs = retryDelayMs(event.attemptCount, {
        baseBackoffMs,
        maxBackoffMs
      });
      try {
        const failed = await markFailed(event.id, workerId, {
          errorCode: failureCode,
          retryDelayMs: delayMs
        });
        logger('warn', 'webhook_event_failed', {
          eventId: event.id,
          provider: event.provider,
          eventType: event.eventType,
          attemptCount: event.attemptCount,
          exhausted: Boolean(failed?.exhausted),
          failureCode
        });
      } catch (markError) {
        // If application succeeded but acknowledgment failed, the lease is left
        // in place. A later worker will recover it and the provider adapter must
        // converge idempotently.
        logger('error', 'webhook_event_settlement_failed', {
          eventId: event.id,
          provider: event.provider,
          eventType: event.eventType,
          failureCode: safeFailureCode(markError)
        });
      }
    }
  }

  async function runOnce() {
    if (!registeredProviders.length) return 0;
    const events = await claimEvents({
      workerId,
      limit: normalizedBatchSize,
      leaseMs: normalizedLeaseMs,
      providers: registeredProviders
    });
    await Promise.all(events.map(settleEvent));
    return events.length;
  }

  function schedule(delayMs = normalizedPollIntervalMs) {
    if (!running || timer) return;
    timer = setTimer(() => {
      timer = null;
      currentRun = runOnce()
        .catch((error) => {
          logger('error', 'webhook_worker_poll_failed', {
            failureCode: safeFailureCode(error)
          });
        })
        .finally(() => {
          currentRun = null;
          schedule();
        });
    }, Math.max(0, delayMs));
    if (typeof timer?.unref === 'function') timer.unref();
  }

  function start() {
    if (running) return;
    running = true;
    schedule(0);
  }

  async function stop({ timeoutMs = null } = {}) {
    running = false;
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
    if (!currentRun) return { drained: true };

    const normalizedTimeoutMs = Number(timeoutMs);
    if (!Number.isFinite(normalizedTimeoutMs) || normalizedTimeoutMs <= 0) {
      await currentRun;
      return { drained: true };
    }

    let drainTimer;
    const drained = await Promise.race([
      currentRun.then(() => true),
      new Promise((resolve) => {
        drainTimer = setTimeout(() => resolve(false), Math.floor(normalizedTimeoutMs));
      })
    ]);
    if (drainTimer) clearTimeout(drainTimer);
    return { drained };
  }

  return {
    start,
    stop,
    runOnce,
    get running() {
      return running;
    },
    workerId
  };
}

module.exports = {
  canResurrectProviderRecord,
  createWebhookWorker,
  retryDelayMs,
  safeFailureCode
};

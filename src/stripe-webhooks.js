const STRIPE_ENTITLEMENT_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed'
]);

function scalarId(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object' && typeof value.id === 'string') {
    return value.id.trim() || null;
  }
  return null;
}

function finiteUnixTimestamp(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return new Date(numeric * 1000).toISOString();
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== null && child !== undefined && child !== '')
  );
}

function invoiceSubscriptionId(invoice) {
  return scalarId(invoice?.subscription)
    || scalarId(invoice?.parent?.subscription_details?.subscription)
    || null;
}

function subscriptionMetadataUserId(subscription) {
  return String(
    subscription?.metadata?.app_user_id
    || subscription?.metadata?.appUserId
    || ''
  ).trim() || null;
}

function buildStripeWebhookReceipt(event, { maxAttempts = 8 } = {}) {
  const providerEventId = String(event?.id || '').trim();
  const eventType = String(event?.type || '').trim();
  const data = event?.data?.object;
  if (!providerEventId || !eventType || !data || typeof data !== 'object') {
    throw new Error('Stripe webhook event is missing required fields.');
  }

  let payload;
  let userId = null;
  switch (eventType) {
    case 'checkout.session.completed':
      userId = String(data.client_reference_id || '').trim() || null;
      payload = compactObject({
        mode: String(data.mode || '').trim() || null,
        userId,
        customerId: scalarId(data.customer),
        subscriptionId: scalarId(data.subscription)
      });
      break;
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      userId = subscriptionMetadataUserId(data);
      payload = compactObject({
        userId,
        customerId: scalarId(data.customer),
        subscriptionId: scalarId(data.id),
        status: String(data.status || '').trim() || null,
        cancelAtPeriodEnd: Boolean(data.cancel_at_period_end),
        currentPeriodStart: finiteUnixTimestamp(data.current_period_start),
        currentPeriodEnd: finiteUnixTimestamp(data.current_period_end)
      });
      break;
    case 'invoice.payment_failed':
      payload = compactObject({
        customerId: scalarId(data.customer),
        subscriptionId: invoiceSubscriptionId(data)
      });
      break;
    default:
      // Unknown verified deliveries are still durably acknowledged, but no
      // provider payload is retained when the app has no use for it.
      payload = {};
      break;
  }

  return {
    provider: 'stripe',
    providerEventId,
    eventType,
    deliveryKind: 'webhook',
    userId,
    occurredAt: finiteUnixTimestamp(event.created),
    payload,
    maxAttempts
  };
}

function subscriptionPlan(subscription) {
  const status = String(subscription?.status || '').trim().toLowerCase();
  if (Boolean(subscription?.cancel_at_period_end)) return 'pro';
  return status === 'active' ? 'pro' : 'free';
}

function normalizeSubscription(subscription, fallback = {}) {
  const status = String(subscription?.status || fallback.status || '').trim() || 'canceled';
  const currentPeriodStart = finiteUnixTimestamp(subscription?.current_period_start)
    || fallback.currentPeriodStart
    || null;
  const currentPeriodEnd = finiteUnixTimestamp(subscription?.current_period_end)
    || fallback.currentPeriodEnd
    || null;
  const cancelAtPeriodEnd = subscription?.cancel_at_period_end == null
    ? Boolean(fallback.cancelAtPeriodEnd)
    : Boolean(subscription.cancel_at_period_end);
  const normalized = {
    stripeCustomerId: scalarId(subscription?.customer) || fallback.customerId || null,
    stripeSubscriptionId: scalarId(subscription?.id) || fallback.subscriptionId || null,
    status,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd
  };
  normalized.plan = subscriptionPlan({
    status: normalized.status,
    cancel_at_period_end: normalized.cancelAtPeriodEnd
  });
  return normalized;
}

function newestSubscription(subscriptions) {
  return [...subscriptions].sort((left, right) => {
    const createdDelta = Number(right?.created || 0) - Number(left?.created || 0);
    if (createdDelta) return createdDelta;
    return String(right?.id || '').localeCompare(String(left?.id || ''));
  })[0] || null;
}

async function fetchCurrentSubscription(stripe, payload, eventType) {
  const customerId = String(payload?.customerId || '').trim();
  const subscriptionId = String(payload?.subscriptionId || '').trim();

  if (customerId && typeof stripe?.subscriptions?.list === 'function') {
    const response = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 10
    });
    const current = newestSubscription(Array.isArray(response?.data) ? response.data : []);
    if (current) return current;
  }

  if (subscriptionId && typeof stripe?.subscriptions?.retrieve === 'function') {
    try {
      return await stripe.subscriptions.retrieve(subscriptionId);
    } catch (error) {
      if (eventType !== 'customer.subscription.deleted' || error?.code !== 'resource_missing') {
        throw error;
      }
    }
  }

  if (eventType === 'customer.subscription.deleted') {
    return {
      id: subscriptionId || null,
      customer: customerId || null,
      status: 'canceled',
      cancel_at_period_end: false
    };
  }
  return null;
}

function createStripeWebhookHandler({
  stripe,
  getSubscriptionByStripeCustomerId,
  getUserAccountControls,
  applyStripeBillingEvent,
  upsertSubscription,
  logAudit = async () => {}
}) {
  return async function handleStripeWebhook(event) {
    const payload = event.payload || {};
    const eventType = String(event.eventType || '');
    if (!STRIPE_ENTITLEMENT_EVENT_TYPES.has(eventType) && eventType !== 'reconcile.subscription') {
      return;
    }
    if (eventType === 'checkout.session.completed' && payload.mode !== 'subscription') {
      return;
    }

    const customerId = String(payload.customerId || '').trim();
    const current = await fetchCurrentSubscription(stripe, payload, eventType);
    if (!current) {
      const error = new Error('Stripe subscription state is temporarily unavailable.');
      error.code = 'stripe_subscription_unavailable';
      throw error;
    }
    const providerObservedAt = new Date().toISOString();

    const receiptUserId = String(event.userId || payload.userId || '').trim();
    const metadataUserId = subscriptionMetadataUserId(current);
    const stored = customerId
      ? await getSubscriptionByStripeCustomerId(customerId)
      : null;
    const storedUserId = String(stored?.user_id || '').trim();
    const userIds = new Set(
      [receiptUserId, metadataUserId, storedUserId].filter(Boolean)
    );
    if (userIds.size > 1) {
      const error = new Error('Stripe customer mapping conflicts with provider metadata.');
      error.code = 'stripe_user_mapping_conflict';
      throw error;
    }
    const userId = [...userIds][0] || '';
    if (!userId) {
      const error = new Error('Stripe event could not be matched to an account.');
      error.code = 'stripe_user_unresolved';
      throw error;
    }
    if (typeof getUserAccountControls === 'function') {
      const account = await getUserAccountControls(userId);
      if (!account) {
        // A provider retry must not recreate local billing state after the user
        // has deleted their account.
        return;
      }
    }

    const subscription = {
      ...normalizeSubscription(current, payload),
      providerObservedAt
    };

    if (eventType === 'reconcile.subscription') {
      await upsertSubscription(userId, subscription);
      return;
    }

    const result = await applyStripeBillingEvent(userId, {
      stripeEventId: event.providerEventId,
      eventType,
      payload,
      subscription
    });
    if (!result?.applied) return;

    if (eventType === 'checkout.session.completed') {
      await logAudit(userId, 'subscribe', 'subscription', null, { plan: subscription.plan });
    } else if (eventType === 'customer.subscription.deleted') {
      await logAudit(userId, 'cancel', 'subscription', null, {
        reason: 'subscription_deleted'
      });
    }
  };
}

module.exports = {
  STRIPE_ENTITLEMENT_EVENT_TYPES,
  buildStripeWebhookReceipt,
  createStripeWebhookHandler,
  fetchCurrentSubscription,
  normalizeSubscription,
  subscriptionMetadataUserId,
  subscriptionPlan
};

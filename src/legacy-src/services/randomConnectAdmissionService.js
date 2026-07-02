const crypto = require('crypto');
const RandomConnectAdmission = require('../models/RandomConnectAdmission');
const RandomConnectGenderQuota = require('../models/RandomConnectGenderQuota');
const RandomConnection = require('../models/RandomConnection');
const log = require('../utils/logger');
const { FREE_DAILY_GENDER_MATCH_LIMIT } = require('./entitlementService');

const configuredLeaseMs = Number(process.env.RANDOM_CONNECT_ADMISSION_LEASE_MS || 60000);
const ADMISSION_LEASE_MS = Math.max(15000, Math.min(5 * 60 * 1000, configuredLeaseMs));

const quotaWindow = (now = new Date()) => {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 2);
  return {
    dayKey: start.toISOString().slice(0, 10),
    start,
    expiresAt: end
  };
};

const admissionBusyError = (retryAfterMs = ADMISSION_LEASE_MS) => {
  const error = new Error('Another Random Connect request is already in progress');
  error.status = 409;
  error.code = 'RANDOM_CONNECT_REQUEST_IN_PROGRESS';
  error.retryAfterMs = retryAfterMs;
  return error;
};

const acquireAdmission = async ({ userId, operation, now = new Date() }) => {
  const leaseToken = crypto.randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + ADMISSION_LEASE_MS);
  try {
    const admission = await RandomConnectAdmission.findOneAndUpdate(
      {
        user: userId,
        $or: [
          { leaseToken: '' },
          { leaseToken: { $exists: false } },
          { leaseExpiresAt: null },
          { leaseExpiresAt: { $lte: now } }
        ]
      },
      {
        $set: { leaseToken, operation, acquiredAt: now, leaseExpiresAt },
        $setOnInsert: { user: userId }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (!admission || admission.leaseToken !== leaseToken) return null;
    return { userId, operation, leaseToken, leaseExpiresAt };
  } catch (error) {
    // An active row does not match the acquisition predicate. With upsert the
    // unique user index turns that race into E11000, which means "busy".
    if (error?.code === 11000) return null;
    throw error;
  }
};

const renewAdmission = async (lease) => {
  const leaseExpiresAt = new Date(Date.now() + ADMISSION_LEASE_MS);
  const result = await RandomConnectAdmission.updateOne(
    { user: lease.userId, leaseToken: lease.leaseToken },
    { $set: { leaseExpiresAt } }
  );
  if (result.modifiedCount !== 1 && result.matchedCount !== 1) return false;
  lease.leaseExpiresAt = leaseExpiresAt;
  return true;
};

const releaseAdmission = async (lease) => {
  if (!lease) return;
  await RandomConnectAdmission.updateOne(
    { user: lease.userId, leaseToken: lease.leaseToken },
    {
      $set: {
        leaseToken: '',
        leaseExpiresAt: new Date(),
        lastCompletedAt: new Date(),
        lastOperation: lease.operation
      }
    }
  );
};

const releaseAdmissionsBestEffort = async (leases, operation) => {
  await Promise.all((leases || []).map(async (lease) => {
    try {
      await releaseAdmission(lease);
    } catch (error) {
      // A committed connection/request result must not be converted to failure
      // because lock cleanup had a transient error. Token+expiry permit safe
      // recovery, and the failure remains observable.
      log.error('Random Connect admission lease release failed', {
        userId: String(lease?.userId || ''),
        operation: operation || lease?.operation,
        error: String(error)
      });
    }
  }));
};

const withRandomConnectAdmissions = async ({
  userIds,
  operation,
  existingLeases = [],
  heartbeatIntervalMs,
  work
}) => {
  const existingByUser = new Map(existingLeases.map((lease) => [String(lease.userId), lease]));
  const uniqueUserIds = Array.from(new Map(
    (userIds || []).map((userId) => [String(userId), userId])
  ).values()).sort((left, right) => String(left).localeCompare(String(right)));
  const leases = [];
  const ownedLeases = [];

  for (const userId of uniqueUserIds) {
    const existing = existingByUser.get(String(userId));
    if (existing) {
      leases.push(existing);
      continue;
    }
    const acquired = await acquireAdmission({ userId, operation });
    if (!acquired) {
      await releaseAdmissionsBestEffort(ownedLeases, operation);
      const error = admissionBusyError();
      error.busyUserId = String(userId);
      throw error;
    }
    leases.push(acquired);
    ownedLeases.push(acquired);
  }

  const lostLeaseUserIds = new Set();
  let heartbeatRun = null;
  const renewAll = async () => {
    await Promise.all(leases.map(async (lease) => {
      if (lostLeaseUserIds.has(String(lease.userId))) return;
      try {
        if (!(await renewAdmission(lease))) lostLeaseUserIds.add(String(lease.userId));
      } catch (error) {
        lostLeaseUserIds.add(String(lease.userId));
        log.error('Random Connect admission lease renewal failed', {
          userId: String(lease.userId),
          operation,
          error: String(error)
        });
      }
    }));
  };
  const intervalMs = heartbeatIntervalMs === undefined
    ? Math.max(5000, Math.floor(ADMISSION_LEASE_MS / 3))
    : Math.max(1, Number(heartbeatIntervalMs) || 1);
  const heartbeat = setInterval(() => {
    if (heartbeatRun) return;
    heartbeatRun = renewAll().finally(() => { heartbeatRun = null; });
  }, intervalMs);
  heartbeat.unref?.();

  const assertLeases = () => {
    if (lostLeaseUserIds.size > 0) {
      const error = new Error('Random Connect admission lease was lost');
      error.status = 409;
      error.code = 'RANDOM_CONNECT_ADMISSION_LOST';
      error.lostUserIds = Array.from(lostLeaseUserIds);
      throw error;
    }
  };

  try {
    return await work({
      leases,
      lease: leases[0] || null,
      assertLeases,
      assertLease: assertLeases
    });
  } finally {
    clearInterval(heartbeat);
    if (heartbeatRun) await heartbeatRun.catch(() => null);
    await releaseAdmissionsBestEffort(ownedLeases, operation);
  }
};

const withRandomConnectAdmission = async ({ userId, operation, heartbeatIntervalMs, work }) => (
  withRandomConnectAdmissions({
    userIds: [userId],
    operation,
    heartbeatIntervalMs,
    work
  })
);

const findQuota = (userId, dayKey) => RandomConnectGenderQuota.findOne({ user: userId, dayKey });

const reserveGenderFilterSlot = async ({
  userId,
  reservationKey,
  now = new Date(),
  limit = FREE_DAILY_GENDER_MATCH_LIMIT
}) => {
  const key = String(reservationKey || '').slice(0, 100);
  if (!key) throw new Error('Random Connect quota reservation key is required');
  const { dayKey, expiresAt } = quotaWindow(now);

  const existing = await findQuota(userId, dayKey).lean();
  if (existing?.reservationKeys?.includes(key)) {
    return { reserved: false, idempotent: true, used: Number(existing.slotCount || 0), dayKey };
  }

  const filter = {
    user: userId,
    dayKey,
    slotCount: { $lt: limit },
    reservationKeys: { $ne: key }
  };
  const update = {
    $inc: { slotCount: 1 },
    $addToSet: { reservationKeys: key },
    $set: { expiresAt },
    $setOnInsert: { user: userId, dayKey }
  };

  let quota;
  try {
    quota = await RandomConnectGenderQuota.findOneAndUpdate(
      filter,
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
    // Either another request created the daily document or it filled the final
    // slot. Retry without upsert so the unique-key race is deterministic.
    quota = await RandomConnectGenderQuota.findOneAndUpdate(filter, update, { new: true });
    if (!quota) {
      const raced = await findQuota(userId, dayKey).lean();
      if (raced?.reservationKeys?.includes(key)) {
        return { reserved: false, idempotent: true, used: Number(raced.slotCount || 0), dayKey };
      }
    }
  }

  if (!quota) {
    const error = new Error(`Daily gender-filter limit reached (${limit})`);
    error.status = 403;
    error.code = 'RANDOM_CONNECT_GENDER_FILTER_LIMIT';
    error.userId = String(userId);
    error.limit = limit;
    throw error;
  }

  return { reserved: true, idempotent: false, used: Number(quota.slotCount || 0), dayKey };
};

const releaseGenderFilterSlot = async ({ userId, reservationKey, now = new Date() }) => {
  const { dayKey } = quotaWindow(now);
  const result = await RandomConnectGenderQuota.updateOne(
    { user: userId, dayKey, reservationKeys: String(reservationKey) },
    { $pull: { reservationKeys: String(reservationKey) }, $inc: { slotCount: -1 } }
  );
  return result.modifiedCount === 1;
};

const syncAttributedUsage = async ({ userId, now = new Date() }) => {
  const { start, dayKey } = quotaWindow(now);
  const connections = await RandomConnection.find({
    genderFilterUserIds: userId,
    participants: { $elemMatch: { userId, isPremium: false } },
    status: { $in: ['active', 'disconnected', 'ended'] },
    startTime: { $gte: start }
  }).select('roomId').lean();

  for (const connection of connections) {
    try {
      await reserveGenderFilterSlot({ userId, reservationKey: connection.roomId, now });
    } catch (error) {
      if (error?.code !== 'RANDOM_CONNECT_GENDER_FILTER_LIMIT') throw error;
      break;
    }
  }

  // Historical rows only stored a global boolean, so exact attribution is
  // impossible. During the bounded rollout day, conservatively seed each
  // participant's counter. This can temporarily under-allow a user matched by
  // somebody else's filter, but it prevents same-day quota overage. UTC daily
  // expiry removes the conservative seed automatically.
  const legacyRows = await RandomConnection.find({
    'participants.userId': userId,
    usedGenderFilter: true,
    $or: [
      { genderFilterUserIds: { $exists: false } },
      { genderFilterUserIds: { $size: 0 } }
    ],
    status: { $in: ['active', 'disconnected', 'ended'] },
    startTime: { $gte: start }
  }).select('roomId').lean();
  for (const connection of legacyRows) {
    try {
      await reserveGenderFilterSlot({
        userId,
        reservationKey: `legacy:${connection.roomId}`,
        now
      });
    } catch (error) {
      if (error?.code !== 'RANDOM_CONNECT_GENDER_FILTER_LIMIT') throw error;
      break;
    }
  }
  const legacyUsageConservativelyCharged = legacyRows.length;
  if (legacyUsageConservativelyCharged > 0 && process.env.RANDOM_CONNECT_ENTITLEMENT_DEBUG === 'true') {
    log.warn('Conservatively charged ambiguous legacy Random Connect gender-filter usage', {
      userId: String(userId),
      dayKey,
      legacyUsageConservativelyCharged
    });
  }

  return { legacyUsageConservativelyCharged, dayKey };
};

const getGenderFilterUsage = async ({ userId, now = new Date(), synchronize = true }) => {
  const sync = synchronize ? await syncAttributedUsage({ userId, now }) : { legacyUsageConservativelyCharged: 0 };
  const { dayKey } = quotaWindow(now);
  const quota = await findQuota(userId, dayKey).lean();
  return {
    used: Math.max(0, Number(quota?.slotCount || 0)),
    legacyUsageConservativelyCharged: sync.legacyUsageConservativelyCharged || 0,
    dayKey
  };
};

module.exports = {
  ADMISSION_LEASE_MS,
  quotaWindow,
  acquireAdmission,
  renewAdmission,
  releaseAdmission,
  releaseAdmissionsBestEffort,
  withRandomConnectAdmissions,
  withRandomConnectAdmission,
  reserveGenderFilterSlot,
  releaseGenderFilterSlot,
  syncAttributedUsage,
  getGenderFilterUsage
};

#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is required');
  process.exit(1);
}

const loadModels = () => [
  'RandomConnection',
  'ConnectionQueue',
  'RandomConnectAdmission',
  'RandomConnectGenderQuota',
  'CallSession',
  'CallVoipPushAttempt'
].map((name) => require(
  path.resolve(__dirname, '..', 'src', 'legacy-src', 'models', `${name}.js`)
));

const randomConnectNotificationFilter = {
  $or: [
    { type: /^random_connect(?:_|$)/i },
    { 'data.customData.eventType': /^random_connect(?:_|$)/i },
    { 'data.customData.deepLinkType': 'random_connect' },
    { 'data.customData.randomConnectionRoomId': { $exists: true } },
    { 'data.customData.randomRoomId': { $exists: true } }
  ]
};

const randomConnectPushFilter = {
  $or: [
    { requestKey: /^random-connect-match:/i },
    { notificationType: /^random_connect(?:_|$)/i },
    { 'payload.type': /^random_connect(?:_|$)/i },
    { 'payload.data.customData.eventType': /^random_connect(?:_|$)/i },
    { 'payload.data.customData.randomConnectionRoomId': { $exists: true } },
    { 'payload.data.customData.randomRoomId': { $exists: true } },
    { 'payload.notification.data.customData.eventType': /^random_connect(?:_|$)/i },
    { 'payload.notification.data.customData.randomRoomId': { $exists: true } }
  ]
};

const auditAndCleanLegacyState = async ({ verify }) => {
  const [RandomConnection, ConnectionQueue] = [
    mongoose.model('RandomConnection'),
    mongoose.model('ConnectionQueue')
  ];
  const Notification = require(path.resolve(__dirname, '..', 'src', 'legacy-src', 'models', 'Notification.js'));
  const PushDeliveryAttempt = require(path.resolve(__dirname, '..', 'src', 'legacy-src', 'models', 'PushDeliveryAttempt.js'));
  const PushDeliveryRequest = require(path.resolve(__dirname, '..', 'src', 'legacy-src', 'models', 'PushDeliveryRequest.js'));
  const CallSession = mongoose.model('CallSession');
  const CallVoipPushAttempt = mongoose.model('CallVoipPushAttempt');
  const heartbeatTtlMs = Math.max(15000, Math.min(180000, Number(process.env.RANDOM_CONNECT_HEARTBEAT_TTL_MS || 60000)));
  const now = new Date();
  const cutoff = new Date(now.getTime() - heartbeatTtlMs);
  const staleQueueFilter = {
    status: { $in: ['waiting', 'matched'] },
    $or: [
      { clientSessionId: { $in: ['', null] } },
      { lastHeartbeatAt: null },
      { lastHeartbeatAt: { $lt: cutoff } },
      { expiresAt: { $lte: now } }
    ]
  };
  const staleConnectionFilter = {
    status: { $in: ['waiting', 'active'] },
    $or: [
      { participants: { $elemMatch: { clientSessionId: { $in: ['', null] } } } },
      { participants: { $elemMatch: { lastHeartbeatAt: null } } },
      { participants: { $elemMatch: { lastHeartbeatAt: { $lt: cutoff } } } }
    ]
  };

  const randomCallSessions = await CallSession.find({
    $or: [{ source: 'random_connect' }, { randomRoomId: { $type: 'string', $ne: '' } }]
  }).select('_id callId').lean();
  const randomCallSessionIds = randomCallSessions.map((session) => session._id);
  const randomCallIds = randomCallSessions.map((session) => session.callId).filter(Boolean);
  const historicalRandomPushFilter = {
    $or: [
      ...randomConnectPushFilter.$or,
      { 'payload.callId': { $in: randomCallIds } },
      { 'payload.data.customData.callId': { $in: randomCallIds } },
      { 'payload.notification.data.customData.callId': { $in: randomCallIds } }
    ]
  };
  const randomVoipAttemptFilter = {
    $or: [
      { callSession: { $in: randomCallSessionIds } },
      { callId: { $in: randomCallIds } },
      { 'payload.randomRoomId': { $exists: true } }
    ]
  };

  const counts = {
    staleQueueEntries: await ConnectionQueue.countDocuments(staleQueueFilter),
    staleConnections: await RandomConnection.countDocuments(staleConnectionFilter),
    randomConnectNotifications: await Notification.countDocuments({
      ...randomConnectNotificationFilter,
      $or: randomConnectNotificationFilter.$or,
      $and: [{ $or: [{ archivedAt: null }, { pushDeliveryState: { $in: ['pending', 'processing'] } }] }]
    }),
    pendingPushAttempts: await PushDeliveryAttempt.countDocuments({
      $and: [historicalRandomPushFilter, { deliveryStatus: { $nin: ['skipped', 'failed'] } }]
    }),
    pendingPushRequests: await PushDeliveryRequest.countDocuments({
      $and: [historicalRandomPushFilter, { status: { $nin: ['skipped', 'failed'] } }]
    }),
    pendingVoipAttempts: await CallVoipPushAttempt.countDocuments({
      $and: [randomVoipAttemptFilter, { $or: [{ retryable: true }, { status: { $in: ['queued', 'sending'] } }] }]
    }),
    pendingCallPushOutboxes: await CallSession.countDocuments({
      _id: { $in: randomCallSessionIds },
      $or: [
        { initialVoipPushStatus: { $in: ['pending', 'processing'] } },
        { statePushStatus: { $in: ['pending', 'processing'] } }
      ]
    })
  };
  console.log(`Random Connect stale-state audit: ${JSON.stringify(counts)}`);

  if (verify) {
    if (Object.values(counts).some((count) => count > 0)) {
      throw new Error('Random Connect stale sessions or deliverable push records remain; run the migration without --verify first');
    }
    return;
  }

  await ConnectionQueue.deleteMany(staleQueueFilter);
  await RandomConnection.updateMany(staleConnectionFilter, {
    $set: { status: 'expired', endTime: now, endReason: 'heartbeat_timeout' }
  });
  await Notification.updateMany(randomConnectNotificationFilter, {
    $set: {
      isRead: true,
      readAt: now,
      archivedAt: now,
      pushDeliveryState: 'not_requested',
      pushDeliveryCompletedAt: now,
      pushDeliveryLastError: 'Random Connect notifications are disabled'
    },
    $unset: { pushDeliveryNextAttemptAt: 1, pushDeliveryLeaseAt: 1, pushDeliveryLeaseKey: 1 }
  });
  await PushDeliveryAttempt.updateMany(historicalRandomPushFilter, {
    $set: {
      ticketStatus: 'skipped',
      receiptStatus: 'skipped',
      deliveryStatus: 'skipped',
      retryable: false,
      providerErrorCode: 'RANDOM_CONNECT_PUSH_DISABLED',
      providerErrorMessage: 'Random Connect does not generate push notifications',
      nextSendAt: null,
      nextReceiptAt: null
    },
    $unset: { sendLeaseAt: 1, sendLeaseKey: 1, receiptLeaseAt: 1, receiptLeaseKey: 1 }
  });
  await PushDeliveryRequest.updateMany(historicalRandomPushFilter, {
    $set: {
      status: 'skipped',
      reasonCode: 'RANDOM_CONNECT_PUSH_DISABLED',
      reasonMessage: 'Random Connect does not generate push notifications',
      completedAt: now,
      pendingReceipts: 0
    }
  });
  await CallVoipPushAttempt.updateMany(randomVoipAttemptFilter, {
    $set: {
      status: 'failed',
      retryable: false,
      failedAt: now,
      errorCode: 'RANDOM_CONNECT_PUSH_DISABLED',
      errorMessage: 'Random Connect does not generate PushKit notifications'
    },
    $unset: { nextAttemptAt: 1, leaseAt: 1, leaseKey: 1 }
  });
  await CallSession.updateMany(
    { _id: { $in: randomCallSessionIds } },
    {
      $set: {
        initialVoipPushStatus: 'completed',
        initialVoipPushNextAttemptAt: null,
        initialVoipPushLeaseAt: null,
        initialVoipPushLeaseKey: '',
        initialVoipPushCompletedAt: now,
        initialVoipPushLastError: 'Random Connect is realtime-only',
        statePushStatus: 'completed',
        statePushNextAttemptAt: null,
        statePushLeaseAt: null,
        statePushLeaseKey: '',
        statePushCompletedAt: now,
        statePushLastError: 'Random Connect is realtime-only'
      }
    }
  );
  console.log('expired stale Random Connect ownership and suppressed historical Random Connect push work');
};

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
};

const normalizeKey = (key) => JSON.stringify(Object.entries(key || {}));
const normalizeIndexOptions = (options = {}) => ({
  unique: options.unique === true,
  sparse: options.sparse === true,
  expireAfterSeconds: Object.prototype.hasOwnProperty.call(options, 'expireAfterSeconds')
    ? Number(options.expireAfterSeconds)
    : null,
  partialFilterExpression: options.partialFilterExpression
    ? canonicalize(options.partialFilterExpression)
    : null
});

const indexesMatch = (expectedKey, expectedOptions, actualIndex) => (
  normalizeKey(actualIndex.key) === normalizeKey(expectedKey) &&
  JSON.stringify(normalizeIndexOptions(actualIndex)) ===
    JSON.stringify(normalizeIndexOptions(expectedOptions))
);

const verifyModelIndexes = async (Model) => {
  const expected = Model.schema.indexes();
  const actual = await Model.collection.indexes();
  const missing = expected.filter(([expectedKey, expectedOptions]) => !actual.some((index) => (
    indexesMatch(expectedKey, expectedOptions, index)
  )));
  if (missing.length) {
    throw new Error(`${Model.modelName} is missing or has incompatible indexes: ${missing
      .map(([key, options]) => `${normalizeKey(key)} ${JSON.stringify(normalizeIndexOptions(options))}`)
      .join(', ')}`);
  }
  console.log(`verified ${Model.modelName}: ${expected.length} declared indexes`);
};

const verifyTransactionSupport = async (AdmissionModel) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // Force a real database command; an empty transaction would not prove
      // that the deployment topology supports the atomic match commit.
      await AdmissionModel.findOne({}, { _id: 1 }, { session }).lean();
    }, {
      readPreference: 'primary',
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' }
    });
    console.log('verified MongoDB transaction support for Random Connect');
  } catch (error) {
    throw new Error(`Random Connect requires MongoDB transaction support: ${String(error?.message || error)}`);
  } finally {
    await session.endSession().catch(() => {});
  }
};

const main = async () => {
  await mongoose.connect(uri, {
    autoIndex: false,
    autoCreate: false,
    retryWrites: process.env.MONGODB_TLS === 'true' ? false : true,
    serverSelectionTimeoutMS: 15000,
    ...(process.env.MONGODB_TLS === 'true' ? {
      tls: true,
      ...(process.env.MONGODB_TLS_CA_FILE && fs.existsSync(process.env.MONGODB_TLS_CA_FILE)
        ? { tlsCAFile: process.env.MONGODB_TLS_CA_FILE }
        : {})
    } : {})
  });

  const models = loadModels();
  if (!process.argv.includes('--verify')) {
    for (const Model of models) {
      await Model.createIndexes();
      console.log(`created/confirmed indexes for ${Model.modelName}`);
    }
  }
  for (const Model of models) await verifyModelIndexes(Model);
  await auditAndCleanLegacyState({ verify: process.argv.includes('--verify') });
  if (process.argv.includes('--verify')) {
    const AdmissionModel = models.find((Model) => Model.modelName === 'RandomConnectAdmission');
    if (!AdmissionModel) throw new Error('RandomConnectAdmission model was not loaded');
    await verifyTransactionSupport(AdmissionModel);
  }
  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

const assert = require('node:assert/strict');
const { test } = require('node:test');
const AutomatedEmailEvent = require('../models/AutomatedEmailEvent');
const jobQueue = require('../utils/jobQueue');
const service = require('./automatedEmailService');

test('repeat event keys reuse one durable row and the worker claims it only once', async () => {
  const originalFindOneAndUpdate = AutomatedEmailEvent.findOneAndUpdate;
  const originalEnqueue = jobQueue.enqueueAutomatedEmail;
  const events = new Map();
  const queued = [];
  AutomatedEmailEvent.findOneAndUpdate = async (filter, update) => {
    if (filter.eventKey) {
      if (!events.has(filter.eventKey)) events.set(filter.eventKey, {
        _id: '507f1f77bcf86cd799439020', status: 'pending', ...update.$setOnInsert
      });
      return events.get(filter.eventKey);
    }
    const event = [...events.values()].find((item) => String(item._id) === String(filter._id));
    if (!event || !filter.status.$in.includes(event.status)) return null;
    event.status = 'sending';
    return event;
  };
  jobQueue.enqueueAutomatedEmail = async (id) => queued.push(id);
  try {
    const input = { userId: '507f1f77bcf86cd799439011', eventKey: 'signup:507f1f77bcf86cd799439011', templateId: 'signup_confirmation' };
    await service.queueAutomatedEmail(input);
    await service.queueAutomatedEmail(input);
    assert.equal(events.size, 1);
    assert.deepEqual(queued, ['507f1f77bcf86cd799439020', '507f1f77bcf86cd799439020']);
    const firstClaim = await AutomatedEmailEvent.findOneAndUpdate({ _id: queued[0], status: { $in: ['pending', 'failed'] } }, { $set: { status: 'sending' } });
    const secondClaim = await AutomatedEmailEvent.findOneAndUpdate({ _id: queued[1], status: { $in: ['pending', 'failed'] } }, { $set: { status: 'sending' } });
    assert.ok(firstClaim);
    assert.equal(secondClaim, null);
  } finally {
    AutomatedEmailEvent.findOneAndUpdate = originalFindOneAndUpdate;
    jobQueue.enqueueAutomatedEmail = originalEnqueue;
  }
});

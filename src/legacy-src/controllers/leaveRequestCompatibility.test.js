const assert = require('assert');
const LeaveRequest = require('../models/LeaveRequest');
const User = require('../models/User');
const canonical = require('./userController');
const compatibility = require('./leaveRequestController');

const responseRecorder = () => ({
  statusCode: 200,
  body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; }
});

const originals = {
  sendLeaveRequest: canonical.sendLeaveRequest,
  approveLeaveRequest: canonical.approveLeaveRequest,
  rejectLeaveRequest: canonical.rejectLeaveRequest,
  findOne: LeaveRequest.findOne,
  find: LeaveRequest.find,
  deleteOne: LeaveRequest.deleteOne,
  userUpdateOne: User.updateOne
};

const restore = () => {
  Object.assign(canonical, {
    sendLeaveRequest: originals.sendLeaveRequest,
    approveLeaveRequest: originals.approveLeaveRequest,
    rejectLeaveRequest: originals.rejectLeaveRequest
  });
  LeaveRequest.findOne = originals.findOne;
  LeaveRequest.find = originals.find;
  LeaveRequest.deleteOne = originals.deleteOne;
  User.updateOne = originals.userUpdateOne;
};

const run = async () => {
  try {
    let delegated = false;
    canonical.sendLeaveRequest = async (req, res) => {
      delegated = true;
      assert.strictEqual(req.body.game, 'General');
      return res.status(201).json({ success: true });
    };
    let res = responseRecorder();
    await compatibility.createLeaveRequest({ body: { reason: 'Moving on' } }, res);
    assert.strictEqual(delegated, true);
    assert.strictEqual(res.statusCode, 201);

    res = responseRecorder();
    await compatibility.respondToLeaveRequest({ body: { action: 'anything' }, params: {} }, res);
    assert.strictEqual(res.statusCode, 400);

    LeaveRequest.findOne = () => ({
      select() { return this; },
      async lean() { return { _id: '507f1f77bcf86cd799439013' }; }
    });
    canonical.approveLeaveRequest = async (req, response) => {
      assert.strictEqual(req.body.reviewNotes, 'Approved after review');
      return response.status(200).json({ success: true });
    };
    res = responseRecorder();
    await compatibility.respondToLeaveRequest({
      body: { action: 'approve', adminResponse: 'Approved after review' },
      params: { teamId: '507f1f77bcf86cd799439011', requestId: '507f1f77bcf86cd799439013' }
    }, res);
    assert.strictEqual(res.statusCode, 200);

    let userQuery;
    LeaveRequest.find = (query) => {
      userQuery = query;
      return {
        populate() { return this; },
        async sort() { return []; }
      };
    };
    res = responseRecorder();
    await compatibility.getUserLeaveRequests({ user: { _id: '507f1f77bcf86cd799439011' } }, res);
    assert.deepStrictEqual(userQuery, { player: '507f1f77bcf86cd799439011' });
    assert.strictEqual(res.statusCode, 200);

    console.log('Legacy leave-request compatibility contracts passed');
  } finally {
    restore();
  }
};

run().catch((error) => {
  restore();
  console.error(error);
  process.exitCode = 1;
});

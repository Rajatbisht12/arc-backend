const assert = require('assert');

const Report = require('../models/Report');
const Post = require('../models/Post');
const reportController = require('./reportController');

const responseRecorder = () => ({
  statusCode: 200,
  body: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  }
});

const originals = {
  reportFindOne: Report.findOne,
  reportCreate: Report.create,
  reportFindById: Report.findById,
  postExists: Post.exists,
  postFindByIdAndUpdate: Post.findByIdAndUpdate
};

const restore = () => {
  Report.findOne = originals.reportFindOne;
  Report.create = originals.reportCreate;
  Report.findById = originals.reportFindById;
  Post.exists = originals.postExists;
  Post.findByIdAndUpdate = originals.postFindByIdAndUpdate;
};

const baseRequest = (body) => ({
  user: { _id: '507f1f77bcf86cd799439011' },
  body
});

const run = async () => {
  try {
    Post.exists = async () => null;
    let res = responseRecorder();
    await reportController.createReport(baseRequest({
      targetType: 'post',
      targetId: '507f1f77bcf86cd799439012',
      reason: 'spam'
    }), res);
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.message, 'Report target not found');

    Post.exists = async () => ({ _id: '507f1f77bcf86cd799439012' });
    Report.findOne = async () => ({ _id: '507f1f77bcf86cd799439013' });
    res = responseRecorder();
    await reportController.createReport(baseRequest({
      targetType: 'post',
      targetId: '507f1f77bcf86cd799439012',
      reason: 'spam'
    }), res);
    assert.strictEqual(res.statusCode, 409);

    let persistedDetails;
    Report.findOne = async () => null;
    Report.create = async (payload) => {
      persistedDetails = payload.details;
      return { _id: '507f1f77bcf86cd799439013', ...payload };
    };
    Post.findByIdAndUpdate = async () => ({ acknowledged: true });
    Report.findById = () => ({
      populate: async () => ({ _id: '507f1f77bcf86cd799439013' })
    });
    res = responseRecorder();
    await reportController.createReport(baseRequest({
      targetType: 'post',
      targetId: '507f1f77bcf86cd799439012',
      reason: 'spam',
      details: { $ne: null }
    }), res);
    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(persistedDetails, '', 'non-string details must never reach string operations or persistence');

    console.log('Report controller validation and target-integrity contracts passed');
  } finally {
    restore();
  }
};

run().catch((error) => {
  restore();
  console.error(error);
  process.exitCode = 1;
});

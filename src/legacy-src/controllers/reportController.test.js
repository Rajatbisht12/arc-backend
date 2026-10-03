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
  postFindOne: Post.findOne,
  postFindByIdAndUpdate: Post.findByIdAndUpdate,
  postFindOneAndUpdate: Post.findOneAndUpdate
};

const restore = () => {
  Report.findOne = originals.reportFindOne;
  Report.create = originals.reportCreate;
  Report.findById = originals.reportFindById;
  Post.exists = originals.postExists;
  Post.findOne = originals.postFindOne;
  Post.findByIdAndUpdate = originals.postFindByIdAndUpdate;
  Post.findOneAndUpdate = originals.postFindOneAndUpdate;
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
    let guardedPostUpdateFilter;
    Report.findOne = async () => null;
    Report.create = async (payload) => {
      persistedDetails = payload.details;
      return { _id: '507f1f77bcf86cd799439013', ...payload };
    };
    // The embedded post-report push is now guarded against duplicates via
    // findOneAndUpdate({ _id, 'reports.user': { $ne: reporter } }).
    Post.findOneAndUpdate = async (filter) => {
      guardedPostUpdateFilter = filter;
      return { acknowledged: true };
    };
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
    assert.deepStrictEqual(
      guardedPostUpdateFilter?.['reports.user'],
      { $ne: '507f1f77bcf86cd799439011' },
      'post report push must be guarded against duplicate entries from the same reporter'
    );

    // A concurrent/retried request that races past the findOne check must be
    // absorbed by the unique index: a duplicate-key error becomes 409, never 500.
    Report.findOne = async () => null;
    Report.create = async () => {
      const duplicateKeyError = new Error('E11000 duplicate key');
      duplicateKeyError.code = 11000;
      throw duplicateKeyError;
    };
    res = responseRecorder();
    await reportController.createReport(baseRequest({
      targetType: 'post',
      targetId: '507f1f77bcf86cd799439012',
      reason: 'spam'
    }), res);
    assert.strictEqual(res.statusCode, 409, 'duplicate-key race must resolve to already-reported, not a server error');

    // Comment reports resolve their real author and reject self-reporting before
    // persistence; opening the comment from another profile does not affect it.
    const commentId = '507f1f77bcf86cd799439020';
    Post.findOne = () => ({
      select: async () => ({
        _id: '507f1f77bcf86cd799439021',
        author: '507f1f77bcf86cd799439099',
        postType: 'general',
        content: { media: [] },
        comments: [{
          _id: commentId,
          user: '507f1f77bcf86cd799439011',
          text: 'own comment',
          parentComment: null,
          rootComment: null
        }]
      })
    });
    res = responseRecorder();
    await reportController.createReport(baseRequest({
      targetType: 'comment',
      targetId: commentId,
      reason: 'spam'
    }), res);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.code, 'SELF_REPORT_NOT_ALLOWED');

    // A report by another user persists the immutable moderation context needed
    // by the Admin Panel even if the comment is deleted before review.
    const reportedAuthorId = '507f1f77bcf86cd799439022';
    const parentPostId = '507f1f77bcf86cd799439021';
    Post.findOne = () => ({
      select: async () => ({
        _id: parentPostId,
        author: '507f1f77bcf86cd799439099',
        postType: 'general',
        content: { media: [] },
        comments: [{
          _id: commentId,
          user: reportedAuthorId,
          text: 'reported comment',
          parentComment: null,
          rootComment: null
        }]
      })
    });
    let persistedCommentReport;
    Report.findOne = async () => null;
    Report.create = async (payload) => {
      persistedCommentReport = payload;
      return { _id: '507f1f77bcf86cd799439023', ...payload };
    };
    Report.findById = () => ({ populate: async () => ({ _id: '507f1f77bcf86cd799439023' }) });
    res = responseRecorder();
    await reportController.createReport(baseRequest({
      targetType: 'comment',
      targetId: commentId,
      reason: 'harassment',
      details: 'context preserved'
    }), res);
    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(String(persistedCommentReport.targetContext.parentContentId), parentPostId);
    assert.strictEqual(String(persistedCommentReport.targetContext.targetAuthor), reportedAuthorId);
    assert.strictEqual(persistedCommentReport.targetContext.textSnapshot, 'reported comment');

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

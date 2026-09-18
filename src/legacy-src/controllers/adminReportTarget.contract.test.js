const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Report = require('../models/Report');
const Post = require('../models/Post');
const adminController = require('./adminController');

const controllerSource = fs.readFileSync(path.join(__dirname, 'adminController.js'), 'utf8');
const routesSource = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'modules', 'admin', 'admin.routes.ts'),
  'utf8'
);

assert.match(controllerSource, /const getReportTarget = async \(req, res\)/);
assert.match(controllerSource, /Report\.findById\(reportId\)[\s\S]*\.select\('targetType targetId'\)/);
assert.match(controllerSource, /if \(report\.targetType !== 'post'\)/);
assert.match(controllerSource, /Post\.findById\(report\.targetId\)/);
assert.match(controllerSource, /populate\('author', 'username profile\.displayName profile\.avatar userType'\)/);
assert.match(controllerSource, /availability: post \? 'available' : 'unavailable'/);
assert.match(controllerSource, /post: post \|\| null/);
assert.match(controllerSource, /hiddenByAdmin author/);
assert.doesNotMatch(controllerSource, /const getReports[\s\S]*?populate\('targetId'/);

assert.match(
  routesSource,
  /router\.get\("\/reports\/:reportId\/target", auditLog\("VIEW_REPORT_TARGET"\), requireAdminPermission\("reports:manage"\), adminController\.getReportTarget\)/
);

console.log('Admin reported-post lazy target contract passed');

const originalReportFindById = Report.findById;
const originalPostFindById = Post.findById;

const responseRecorder = () => ({
  statusCode: 200,
  body: null,
  headers: {},
  status(code) { this.statusCode = code; return this; },
  setHeader(name, value) { this.headers[name] = value; },
  json(body) { this.body = body; return this; }
});

const reportQuery = (report) => ({
  select() {
    return { lean: async () => report };
  }
});

const postQuery = (post) => ({
  populate() {
    return {
      select() {
        return { lean: async () => post };
      }
    };
  }
});

const runControllerCases = async () => {
  try {
    const targetId = '507f1f77bcf86cd799439012';
    Report.findById = () => reportQuery({ targetType: 'post', targetId });
    Post.findById = () => postQuery({
      _id: targetId,
      author: { username: 'owner' },
      content: { text: 'reported post', media: [] },
      createdAt: new Date('2026-09-10T00:00:00.000Z'),
      isActive: false,
      hiddenByAdmin: true
    });

    let response = responseRecorder();
    await adminController.getReportTarget({ params: { reportId: '507f1f77bcf86cd799439011' } }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.data.availability, 'available');
    assert.equal(response.body.data.post.author.username, 'owner');
    assert.equal(response.body.data.post.hiddenByAdmin, true);
    assert.equal(response.headers['Cache-Control'], 'private, no-store, max-age=0');

    Post.findById = () => postQuery(null);
    response = responseRecorder();
    await adminController.getReportTarget({ params: { reportId: '507f1f77bcf86cd799439011' } }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.data.availability, 'unavailable');
    assert.equal(response.body.data.post, null);

    Report.findById = () => reportQuery({ targetType: 'user', targetId });
    response = responseRecorder();
    await adminController.getReportTarget({ params: { reportId: '507f1f77bcf86cd799439011' } }, response);
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.code, 'UNSUPPORTED_REPORT_TARGET');

    console.log('Admin reported-post target controller cases passed');
  } finally {
    Report.findById = originalReportFindById;
    Post.findById = originalPostFindById;
  }
};

runControllerCases().catch((error) => {
  Report.findById = originalReportFindById;
  Post.findById = originalPostFindById;
  console.error(error);
  process.exitCode = 1;
});

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { formatPostDTO } = require('./utils/dto');
const read = (rel) => readFileSync(path.join(__dirname, rel), 'utf8');

test('formatPostDTO reports whether THIS viewer reported the post, then strips reports', () => {
  const viewer = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const other = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const basePost = { _id: 'p1', author: 'x', likes: [], comments: [] };

  const reportedByViewer = formatPostDTO(
    { ...basePost, reports: [{ user: viewer, reason: 'spam' }] },
    false, false, viewer
  );
  assert.equal(reportedByViewer.viewerHasReported, true);
  // The reports array is never leaked to clients.
  assert.equal(reportedByViewer.reports, undefined);

  const reportedByOther = formatPostDTO(
    { ...basePost, reports: [{ user: other, reason: 'spam' }] },
    false, false, viewer
  );
  assert.equal(reportedByOther.viewerHasReported, false);

  // Without a viewer id the flag defaults to false (backward compatible).
  const noViewer = formatPostDTO({ ...basePost, reports: [{ user: viewer }] }, false, false);
  assert.equal(noViewer.viewerHasReported, false);
});

test('Report model enforces one report per user per content with a unique index', () => {
  const source = read('models/Report.js');
  assert.match(
    source,
    /reportSchema\.index\(\s*\{\s*reporter:\s*1,\s*targetType:\s*1,\s*targetId:\s*1\s*\},\s*\{\s*unique:\s*true\s*\}\s*\)/
  );
});

test('report controller de-dupes across ALL statuses and survives races', () => {
  const source = read('controllers/reportController.js');
  // The dedup lookup is no longer scoped to pending only.
  const findOne = source.slice(source.indexOf('Report.findOne('));
  assert.doesNotMatch(findOne.slice(0, 160), /status:\s*'pending'/);
  // Duplicate-key errors from the unique index are treated as already-reported.
  assert.match(source, /err\.code === 11000/);
  assert.match(source, /already reported this content/i);
  // The embedded post reports array is guarded against duplicate pushes.
  assert.match(source, /'reports\.user':\s*\{\s*\$ne:\s*reporterId\s*\}/);
});

test('feed audience filter hides posts the viewer reported (per-viewer, not global)', () => {
  const source = read('services/recommendationService.js');
  assert.match(source, /filter\['reports\.user'\]\s*=\s*\{\s*\$ne:\s*relationship\.currentUserId\s*\}/);
  // The viewer id is threaded into the DTO so already-reported state is known.
  assert.match(source, /formatPostDTO\([\s\S]{0,200}relationship\.currentUserId\s*\)/);
});

test('profile, saved, and liked post lists all exclude viewer-reported posts', () => {
  const postController = read('controllers/postController.js');
  const userController = read('controllers/userController.js');
  // Saved + Liked.
  assert.match(postController, /_id:\s*\{\s*\$in:\s*savedIds\s*\},\s*isActive:\s*true,\s*'reports\.user':\s*\{\s*\$ne:\s*userId\s*\}/);
  assert.match(postController, /'likes\.user':\s*userId,\s*'reports\.user':\s*\{\s*\$ne:\s*userId\s*\}/);
  // Single-post fetch passes the viewer id for the already-reported flag.
  assert.match(postController, /formatPostDTO\(post,\s*isGuest,\s*isAuthor,\s*viewerId\)/);
  // Profile feed (find + count) and recent-posts preview.
  assert.match(userController, /reportExclusion\s*=\s*viewerId\s*\?\s*\{\s*'reports\.user':\s*\{\s*\$ne:\s*viewerId\s*\}\s*\}/);
  assert.match(userController, /recentPostsViewerId\s*\?\s*\{\s*'reports\.user':\s*\{\s*\$ne:\s*recentPostsViewerId\s*\}\s*\}/);
});

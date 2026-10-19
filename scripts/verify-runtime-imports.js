#!/usr/bin/env node

// Import the actual built HTTP application without starting listeners, workers,
// secrets hydration or database connections. Source-only/tsc tests cannot catch
// accidentally mixing dist/legacy-src models with the canonical source models.
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

if (!process.argv.includes('--child')) {
  try {
    const output = execFileSync(process.execPath, [__filename, '--child'], {
      cwd: root,
      timeout: 20_000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      // Do not load developer/production credentials into this build check.
      env: {
        PATH: process.env.PATH || '',
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        NODE_ENV: 'test',
        MONGODB_URI: 'mongodb://127.0.0.1:1/runtime-import-check',
        REDIS_HOST: '127.0.0.1',
        REDIS_PORT: '1',
        JWT_SECRET: 'runtime-import-fixture-not-a-real-secret-123',
        JWT_REFRESH_SECRET: 'runtime-import-fixture-not-a-real-refresh-secret-123',
        GOOGLE_CLIENT_ID: 'runtime-import-fixture.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'runtime-import-fixture-not-a-real-oauth-secret',
        GOOGLE_CALLBACK_URL: 'https://example.invalid/api/auth/google/callback',
        POST_VIDEO_UPLOADS_ENABLED: 'false',
      },
    });
    process.stdout.write(output);
  } catch (error) {
    process.stderr.write('Compiled runtime import verification failed.\n');
    if (error.stdout) process.stderr.write(String(error.stdout));
    if (error.stderr) process.stderr.write(String(error.stderr));
    process.exitCode = 1;
  }
} else {
  require('dotenv').config = () => ({ parsed: {} });
  let connectionAttempts = 0;
  require('node:net').Socket.prototype.connect = function () {
    connectionAttempts++;
    throw new Error('Runtime import verification must not open network connections');
  };

  const { createApp } = require(path.join(root, 'dist', 'app.js'));
  assert.equal(typeof createApp, 'function');
  const adapters = require(path.join(root, 'dist', 'modules', 'posts', 'posts.legacy-adapters.js'));
  const controller = require(path.join(root, 'src', 'legacy-src', 'controllers', 'videoUploadController.js'));
  assert.equal(adapters.videoUploadController, controller, 'Upload routes must use the canonical legacy adapter');
  const mongoose = require('mongoose');
  assert.equal(mongoose.models.Post, require(path.join(root, 'src', 'legacy-src', 'models', 'Post.js')));
  const builtModels = `${path.join(root, 'dist', 'legacy-src', 'models')}${path.sep}`;
  assert.deepEqual(Object.keys(require.cache).filter(file => file.startsWith(builtModels)), [],
    'HTTP runtime must never compile a second legacy model tree');
  assert.equal(mongoose.connection.readyState, 0, 'Build verification must not connect to a database');
  setImmediate(() => {
    assert.equal(connectionAttempts, 0, 'Build verification must not attempt network access');
    console.log('Compiled HTTP runtime imports passed: one canonical legacy model tree, no network access.');
    process.exit(0);
  });
}

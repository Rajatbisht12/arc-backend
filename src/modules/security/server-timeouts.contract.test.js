const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../../server.ts'), 'utf8');
for (const setting of [
  'httpServer.requestTimeout',
  'httpServer.headersTimeout',
  'httpServer.keepAliveTimeout',
  'httpServer.maxHeadersCount',
  'httpServer.maxRequestsPerSocket'
]) {
  assert.match(source, new RegExp(setting.replace('.', '\\.')));
}

console.log('HTTP server timeout and connection-bound contracts passed');

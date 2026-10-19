const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const test = require('node:test');
const express = require('express');
const { uploadSingle, uploadMultiple, uploadFields } = require('./upload');
const { MESSAGE_MEDIA_POLICY } = require('../config/messageMediaPolicy');

test('legacy single/array/fields HTTP uploads accept exactly 50 MiB, reject the extra byte', async () => {
  const app = express(); let accepted = 0;
  for (const [path, middleware] of [['single', uploadSingle('media')], ['array', uploadMultiple('media', 5)], ['fields', uploadFields([{ name: 'media', maxCount: 5 }])]]) {
    app.post('/' + path, middleware, (req, res) => {
      accepted++;
      const file = req.file || (Array.isArray(req.files) ? req.files[0] : req.files.media[0]);
      res.json({ size: file.size });
    });
  }
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    for (const surface of ['single', 'array', 'fields']) {
      for (const size of [MESSAGE_MEDIA_POLICY.maxFileBytes - 1, MESSAGE_MEDIA_POLICY.maxFileBytes, MESSAGE_MEDIA_POLICY.maxFileBytes + 1]) {
        const boundary = 'squadhunt-inclusive-audit';
        const body = Readable.from((async function* () {
          yield Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="boundary.mp4"\r\nContent-Type: video/mp4\r\n\r\n`);
          const chunk = Buffer.alloc(65536);
          for (let left = size; left > 0; left -= chunk.length) yield chunk.subarray(0, Math.min(left, chunk.length));
          yield Buffer.from(`\r\n--${boundary}--\r\n`);
        })());
        const response = await fetch(`http://127.0.0.1:${server.address().port}/${surface}`, {
          method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body, duplex: 'half',
        });
        const payload = await response.json();
        assert.equal(response.status, size <= MESSAGE_MEDIA_POLICY.maxFileBytes ? 200 : 413, `${surface}, ${size}`);
        if (response.status === 200) assert.equal(payload.size, size); else assert.equal(payload.code, 'FILE_TOO_LARGE');
      }
    }
    assert.equal(accepted, 6);
    assert.equal(MESSAGE_MEDIA_POLICY.maxFileBytes, 52428800);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setS3ClientForTests, uploadMediaFile, uploadVideo } from './s3';

type Sent = { name: string; input: Record<string, unknown> };

const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest();

const storageMock = ({ headLength, headChecksum, putError }: {
  headLength?: number;
  headChecksum?: string;
  putError?: Error;
} = {}) => {
  const sent: Sent[] = [];
  const client = {
    send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const name = command.constructor.name;
      sent.push({ name, input: command.input });
      if (name === 'PutObjectCommand') {
        if (putError) throw putError;
        return { ETag: '"etag-value"', ChecksumSHA256: command.input.ChecksumSHA256 };
      }
      if (name === 'HeadObjectCommand') {
        const put = sent.find(item => item.name === 'PutObjectCommand')!;
        return {
          ContentLength: headLength ?? put.input.ContentLength,
          ContentType: put.input.ContentType,
          ETag: '"etag-value"',
          ChecksumSHA256: headChecksum ?? put.input.ChecksumSHA256,
          Metadata: put.input.Metadata,
        };
      }
      if (name === 'DeleteObjectCommand') return {};
      throw new Error(`Unexpected command ${name}`);
    },
  };
  return { client, sent };
};

test.afterEach(() => setS3ClientForTests());

test('video upload is an atomic checksummed PUT followed by HEAD verification', async () => {
  const { client, sent } = storageMock();
  setS3ClientForTests(client as never);
  const buffer = Buffer.from('valid media bytes');
  const outputSha256 = sha256(buffer).toString('hex');
  const result = await uploadVideo({
    buffer,
    mimetype: 'video/mp4',
    originalname: 'source.mp4',
    integrity: { jobId: 'job-1', outputSha256 },
  });
  assert.deepEqual(sent.map(item => item.name), ['PutObjectCommand', 'HeadObjectCommand']);
  assert.equal(sent[0].input.ContentLength, buffer.length);
  assert.equal(sent[0].input.ChecksumSHA256, sha256(buffer).toString('base64'));
  assert.match(result.publicId, /\.mp4$/);
  assert.equal(result.bytes, buffer.length);
  assert.equal(result.checksumSha256, outputSha256);
  assert.equal(result.etag, 'etag-value');
});

test('real container type and extension are retained for validated WebM', async () => {
  const { client, sent } = storageMock();
  setS3ClientForTests(client as never);
  const result = await uploadVideo({ buffer: Buffer.from('webm bytes'), mimetype: 'video/webm', originalname: 'clip.webm' });
  assert.match(result.publicId, /\.webm$/);
  assert.equal(result.contentType, 'video/webm');
  assert.equal(sent[0].input.ContentType, 'video/webm');
});

test('repeated uploads use collision-resistant immutable object keys', async () => {
  const { client } = storageMock();
  setS3ClientForTests(client as never);
  const file = { buffer: Buffer.from('same bytes'), mimetype: 'video/mp4', originalname: 'same.mp4' };
  const first = await uploadVideo(file);
  const second = await uploadVideo(file);
  assert.notEqual(first.publicId, second.publicId);
});

test('large video bodies retain their exact byte length and checksum', async () => {
  const { client, sent } = storageMock();
  setS3ClientForTests(client as never);
  const buffer = Buffer.alloc(12 * 1024 * 1024, 0xa5);
  const result = await uploadVideo({ buffer, mimetype: 'video/mp4', originalname: 'large.mp4' });
  assert.equal(sent[0].input.ContentLength, buffer.length);
  assert.equal(sent[0].input.ChecksumSHA256, sha256(buffer).toString('base64'));
  assert.equal(result.bytes, buffer.length);
  assert.equal(result.checksumSha256, sha256(buffer).toString('hex'));
});

test('storage interruption cannot return or publish a media result', async () => {
  const { client, sent } = storageMock({ putError: new Error('connection interrupted') });
  setS3ClientForTests(client as never);
  await assert.rejects(uploadVideo({ buffer: Buffer.from('bytes'), mimetype: 'video/mp4' }), /Storage upload or verification failed/);
  assert.deepEqual(sent.map(item => item.name), ['PutObjectCommand']);
});

test('length or checksum verification failure deletes the untrusted object', async () => {
  for (const options of [{ headLength: 1 }, { headChecksum: Buffer.alloc(32, 7).toString('base64') }]) {
    const { client, sent } = storageMock(options);
    setS3ClientForTests(client as never);
    await assert.rejects(uploadVideo({ buffer: Buffer.from('verified bytes'), mimetype: 'video/mp4' }), /mismatch/);
    assert.equal(sent.at(-1)?.name, 'DeleteObjectCommand');
  }
});

test('generated HLS/fallback files are also checksummed and verified before manifest publication', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-s3-integrity-test-'));
  const file = path.join(directory, 'fallback.mp4');
  await fs.writeFile(file, Buffer.from('generated media'));
  try {
    const { client, sent } = storageMock();
    setS3ClientForTests(client as never);
    const result = await uploadMediaFile(file, 'gaming-social/clips/post/media/version/fallback.mp4');
    assert.deepEqual(sent.map(item => item.name), ['PutObjectCommand', 'HeadObjectCommand']);
    assert.equal(result.bytes, 15);
    assert.equal(result.contentType, 'video/mp4');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

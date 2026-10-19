import assert from 'node:assert/strict';
import test from 'node:test';
import { S3Client } from '@aws-sdk/client-s3';
import { setS3ClientForTests, createVideoMultipart, presignVideoPart, listVideoParts, completeVideoMultipart, abortVideoMultipart, headVideoSource } from './s3';
const owner = 'a'.repeat(24), id = 'b'.repeat(24);
const key = `post-video-sources/${owner}/${id}/source.mp4`;
test.afterEach(() => setS3ClientForTests());
test('source upload creation uses server metadata, encryption and private cache headers', async () => {
  const sent: Record<string, unknown>[] = [];
  setS3ClientForTests({ send: async (command: { input: Record<string, unknown> }) => { sent.push(command.input); return { UploadId: 's3-upload' }; } } as never);
  assert.equal(await createVideoMultipart(key, 'video/mp4', id), 's3-upload');
  assert.equal(sent[0].Key, key); assert.equal(sent[0].ServerSideEncryption, 'AES256'); assert.equal(sent[0].CacheControl, 'private, no-store');
  assert.deepEqual(sent[0].Metadata, { 'upload-session': id });
  await assert.rejects(createVideoMultipart('gaming-social/posts/attacker.mp4', 'video/mp4', id), /Invalid post video source key/);
});
test('signed part authorization binds exact content length and server-keyed upload ID', async () => {
  setS3ClientForTests(new S3Client({ region: 'us-east-1', requestChecksumCalculation: 'WHEN_REQUIRED', credentials: { accessKeyId: 'unit-test', secretAccessKey: 'unit-test-secret' } }));
  const url = new URL(await presignVideoPart(key, 's3-upload', 2, 12));
  assert.equal(url.searchParams.get('partNumber'), '2'); assert.equal(url.searchParams.get('uploadId'), 's3-upload');
  assert.match(url.searchParams.get('X-Amz-SignedHeaders') || '', /content-length/);
  assert.equal(url.searchParams.get('X-Amz-Expires'), '900');
  assert.equal(url.searchParams.has('x-amz-checksum-crc32'), false);
});
test('S3 part listing paginates, completion uses server-listed ETags, and source HEAD is bounded metadata only', async () => {
  const sent: { name: string; input: Record<string, unknown> }[] = [];
  setS3ClientForTests({ send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    sent.push({ name: command.constructor.name, input: command.input });
    if (command.constructor.name === 'ListPartsCommand') return command.input.PartNumberMarker ? { Parts: [{ PartNumber: 2, ETag: 'second', Size: 4 }] } : { IsTruncated: true, NextPartNumberMarker: '1', Parts: [{ PartNumber: 1, ETag: 'first', Size: 8388608 }] };
    if (command.constructor.name === 'HeadObjectCommand') return { ContentLength: 8388612, ContentType: 'video/mp4', Metadata: { 'upload-session': id } };
    if (command.constructor.name === 'AbortMultipartUploadCommand') throw Object.assign(new Error('already absent'), { name: 'NoSuchUpload' });
    return {};
  } } as never);
  const parts = await listVideoParts(key, 's3-upload');
  assert.equal(parts.length, 2);
  await completeVideoMultipart(key, 's3-upload', parts);
  assert.deepEqual(sent.at(-1)?.input.MultipartUpload, { Parts: [{ PartNumber: 1, ETag: 'first' }, { PartNumber: 2, ETag: 'second' }] });
  assert.deepEqual(await headVideoSource(key), { size: 8388612, sessionId: id, contentType: 'video/mp4' });
  await abortVideoMultipart(key, 's3-upload');
});

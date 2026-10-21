import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readContainerResources, videoScratchBytes, startVideoWorkerObservation } from './videoWorkerResourceSample';
test('cgroup v2/v1 CPU includes child usage and missing counters remain unavailable, not fabricated', async () => {
  const fake = (rows: Record<string, string>) => async (file: string) => { if (!(file in rows)) throw Error('absent'); return rows[file]; };
  assert.deepEqual(await readContainerResources(fake({ '/sys/fs/cgroup/cpu.stat': 'usage_usec 123456\nuser_usec 100\n', '/sys/fs/cgroup/memory.current': '4096\n' })), { cpuUsec: 123456, memoryBytes: 4096, scope: 'container-cgroup-v2' });
  assert.deepEqual(await readContainerResources(fake({ '/sys/fs/cgroup/cpuacct/cpuacct.usage': '123456000\n', '/sys/fs/cgroup/memory/memory.usage_in_bytes': '8192\n' })), { cpuUsec: 123456, memoryBytes: 8192, scope: 'container-cgroup-v1' });
  assert.deepEqual(await readContainerResources(fake({})), { cpuUsec: null, memoryBytes: null, scope: 'unavailable' });
  await (await startVideoWorkerObservation(false, 'disabled', 'process-upload'))();
});
test('scratch sampling counts only encoder-owned directories and ignores symlinks/unrelated files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'squadhunt-resource-test-'));
  try {
    await fs.mkdir(path.join(root, 'arc-video-upload-fixture'));
    await fs.mkdir(path.join(root, 'unrelated'));
    await fs.writeFile(path.join(root, 'arc-video-upload-fixture', 'source.mp4'), Buffer.alloc(12));
    await fs.writeFile(path.join(root, 'unrelated', 'private'), Buffer.alloc(100));
    await fs.symlink(path.join(root, 'unrelated'), path.join(root, 'arc-video-upload-fixture', 'skip'));
    assert.equal(await videoScratchBytes(root), 12);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

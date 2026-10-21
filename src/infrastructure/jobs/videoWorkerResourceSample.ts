import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type ReadText = (file: string) => Promise<string>;
export async function readContainerResources(read: ReadText = file => fs.readFile(file, 'utf8')) {
  const optional = async (file: string) => { try { return await read(file); } catch { return ''; } };
  const v2Cpu = await optional('/sys/fs/cgroup/cpu.stat');
  const cpuMatch = /^usage_usec\s+(\d+)$/m.exec(v2Cpu);
  const v1Cpu = cpuMatch ? '' : await optional('/sys/fs/cgroup/cpuacct/cpuacct.usage');
  const v2Memory = await optional('/sys/fs/cgroup/memory.current');
  const memory = v2Memory || await optional('/sys/fs/cgroup/memory/memory.usage_in_bytes');
  return {
    cpuUsec: cpuMatch ? Number(cpuMatch[1]) : /^\d+\s*$/.test(v1Cpu) ? Number(v1Cpu) / 1000 : null,
    memoryBytes: /^\d+\s*$/.test(memory) ? Number(memory) : null,
    scope: cpuMatch ? 'container-cgroup-v2' : v1Cpu ? 'container-cgroup-v1' : 'unavailable',
  };
}
export async function videoScratchBytes(root = os.tmpdir()): Promise<number> {
  const size = async (directory: string): Promise<number> => {
    let total = 0;
    for (const row of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, row.name);
      // Never follow symlinks or scan unrelated temporary files/secrets.
      if (row.isDirectory()) total += await size(file).catch(() => 0);
      else if (row.isFile()) total += (await fs.stat(file).catch(() => ({ size: 0 }))).size;
    }
    return total;
  };
  let total = 0;
  for (const row of await fs.readdir(root, { withFileTypes: true })) {
    if (row.isDirectory() && /^(arc-video-upload-|arc-clip-hls-)/.test(row.name)) total += await size(path.join(root, row.name)).catch(() => 0);
  }
  return total;
}

/** Optional worker measurements. Never adds a worker, changes its queue,
 * alters job results or makes telemetry failure fail a media job. CPU includes
 * FFmpeg children; memory/disk peaks are 1-second sampled, not exact HWMs. */
export async function startVideoWorkerObservation(enabled: boolean, jobId: string, jobName: string) {
  if (!enabled) return async () => {};
  const started = performance.now();
  const first = await readContainerResources();
  let previous = first, previousAt = started, sampling = false;
  let peakMemoryBytes: number | null = first.memoryBytes, peakCpuCorePercent: number | null = null;
  let peakScratchBytes = 0, samples = 0;
  const sample = async () => {
    if (sampling) return; sampling = true;
    try {
      const now = performance.now(), current = await readContainerResources();
      if (current.memoryBytes !== null) peakMemoryBytes = Math.max(peakMemoryBytes || 0, current.memoryBytes);
      if (current.cpuUsec !== null && previous.cpuUsec !== null && now > previousAt) {
        peakCpuCorePercent = Math.max(peakCpuCorePercent || 0, (current.cpuUsec - previous.cpuUsec) / ((now - previousAt) * 10));
      }
      peakScratchBytes = Math.max(peakScratchBytes, await videoScratchBytes());
      previous = current; previousAt = now; samples++;
    } catch { /* observation must never change success/failure/publication */ }
    finally { sampling = false; }
  };
  const timer = setInterval(() => { void sample(); }, 1000); timer.unref();
  return async () => {
    clearInterval(timer);
    await sample();
    const end = await readContainerResources();
    console.info(JSON.stringify({ event: 'video_worker_resource_sample', jobId, jobName,
      scope: end.scope, intervalMs: 1000, samples, jobWallSeconds: (performance.now() - started) / 1000,
      cpuSeconds: end.cpuUsec !== null && first.cpuUsec !== null ? (end.cpuUsec - first.cpuUsec) / 1e6 : null,
      peakSampledCpuCorePercent: peakCpuCorePercent, peakSampledContainerMemoryBytes: peakMemoryBytes,
      peakSampledVideoScratchBytes: peakScratchBytes }));
  };
}

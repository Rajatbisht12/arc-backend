import { Queue, Worker, DelayedError, type Job } from "bullmq";
import mongoose from "mongoose";
import path from "path";
import { createServer } from 'http';
import { env } from "./config/env";
import { logger } from "./config/logger";
import { connectMongo } from "./infrastructure/database/mongodb";
import { backendRootPath } from "./modules/legacy/legacy.paths";
import { startVideoWorkerObservation } from './infrastructure/jobs/videoWorkerResourceSample';
import { createVideoProtectionLease } from './infrastructure/jobs/videoTaskProtection';
import { createVideoWorkerIntake, videoWorkerHealth, watchVideoWorkerErrors } from './infrastructure/jobs/videoWorkerIntake';
import { randomUUID } from 'crypto';

const connection = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  username: env.REDIS_USERNAME,
  password: env.REDIS_PASSWORD,
  maxRetriesPerRequest: null,
  ...(env.REDIS_TLS ? { tls: {} } : {})
};

type ClipTranscodingService = {
  processClipTranscodeJob: (data: Record<string, unknown>) => Promise<unknown>;
};
type VideoUploadService = { processVideoUploadJob: (data: Record<string, unknown>) => Promise<unknown> };

let worker: Worker | null = null;
let protectionHealthy = true;
let activeJobs = 0;
const intake = createVideoWorkerIntake();
let taskProtection: Awaited<ReturnType<typeof createVideoProtectionLease>> | null = null;
// Load the same source module used by legacy services: one ALS context even in dist.
const completionTrace = require(path.join(backendRootPath, 'utils', 'videoCompletionTrace.js')) as {
  withTrace: <T>(identity: Record<string, unknown>, fn: () => Promise<T>) => Promise<T>;
  span: <T>(name: string, fn: () => Promise<T>, details?: Record<string, unknown>) => Promise<T>;
  queueAcknowledged: (jobId: string) => void;
};
const witness = require(path.join(backendRootPath, 'utils', 'videoWorkerWitness.js'));
const Control = require(path.join(backendRootPath, 'utils', 'videoWorkerControl.js'));
let control: any = null;
let currentClaim: {jobId:string;sessionId:string;token:string} | null = null;
const claimReadback = require(path.join(backendRootPath,'utils','videoWorkerClaim.js')).create({getClaim:()=>currentClaim,consumer:()=>worker});
const processJob = async (job: Job, token?: string) => witness.withJob({jobId: String(job.id || ''), sessionId: job.data?.sessionId}, () => completionTrace.withTrace(
  { sessionId: job.data?.sessionId, jobId: job.id }, () => processJobInner(job, token)));
const processJobInner = async (job: Job, token?: string) => {
  const localJobId = String(job.id || '');
  try {
    if (taskProtection) taskProtection.assertClaimsAllowed();
    intake.begin(localJobId);
  } catch {
    await worker?.pause(true);
    await job.moveToDelayed(Date.now() + 30000, token);
    throw new DelayedError();
  }
  activeJobs++;
  currentClaim=token?{jobId:localJobId,sessionId:String(job.data?.sessionId||''),token}:null;
  const stopObservation = await completionTrace.span('worker.observation_start', () => startVideoWorkerObservation(
    process.env.VIDEO_WORKER_RESOURCE_METRICS_ENABLED === 'true',
    String(job.id || ''), job.name,
  )).catch(() => async () => {});
  try {
    if (job.name === 'process-upload') {
      const service = require(path.join(backendRootPath, 'services', 'videoUploadService.js')) as VideoUploadService;
      return await service.processVideoUploadJob({ ...job.data, workerJobId: String(job.id || '') });
    }
    if (job.name !== "transcode-hls") throw new Error(`Unknown clip video job: ${job.name}`);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const service = require(path.join(backendRootPath, "services", "clipTranscodingService.js")) as ClipTranscodingService;
    return await service.processClipTranscodeJob({ ...job.data, workerJobId: String(job.id || "") });
  } finally {
    // Telemetry is optional: a logging failure must not fail a completed job.
    await completionTrace.span('worker.observation_stop', stopObservation).catch(() => {});
    // Retain task protection while the consumer can claim another job.
    // Only the shutdown/drain fence may positively release it.
    intake.finish(localJobId);
    activeJobs--;currentClaim=null;
  }
};

const bootstrap = async () => {
  if (!env.CLIP_HLS_ENABLED) throw new Error("CLIP_HLS_ENABLED must be true for the Clip worker");
  const r4 = process.env.VIDEO_WORKER_R4_CONTROL_ENABLED === 'true';
  if (r4) {
    if (process.env.POST_VIDEO_FAIR_SCHEDULING_ENABLED !== 'false' || process.env.POST_VIDEO_PRIVATE_DELIVERY_ENABLED !== 'true') throw Error('R4_REQUIRES_CURRENT_PRIVATE_NONFAIR_TOPOLOGY');
    if (process.env.VIDEO_TASK_SCALE_IN_PROTECTION_ENABLED !== 'true') throw Error('R4_REQUIRES_PROTECTION');
    Control.validateConfig({owner:process.env.VIDEO_WORKER_CONTROL_OWNER,runId:process.env.VIDEO_WORKER_CONTROL_RUN_ID,publicKeyPem:process.env.VIDEO_WORKER_CONTROL_PUBLIC_KEY_PEM});
    if (!process.env.VIDEO_WORKER_EXPECTED_SERVICE || !process.env.VIDEO_WORKER_EXPECTED_FAMILY) throw Error('R4_SERVICE_BINDING_REQUIRED');
  }
  await connectMongo();
  if (env.CLIP_HLS_WORKER_CONCURRENCY !== 1) throw new Error('Video workers require one active job per task');
  if (process.env.VIDEO_TASK_SCALE_IN_PROTECTION_ENABLED === 'true') {
    taskProtection = await createVideoProtectionLease({ onUnsafe: async code => {
      protectionHealthy = false; intake.hold(code);
      console.error(JSON.stringify({ event: 'video_task_protection_unsafe', code, taskArn: taskProtection?.taskArn }));
      await worker?.pause(true);
    } });
  }
  // autorun=false closes the claim-before-initial-protection race.
  worker = new Worker("clip-video", processJob, {
    autorun: false,
    connection,
    concurrency: env.CLIP_HLS_WORKER_CONCURRENCY,
    lockDuration: 120000,
    maxStalledCount: 2,
  });
  if (r4 && taskProtection) {
    const containers = taskProtection.metadata.Containers.filter((c: any) => c.Name === 'video-worker');
    const identity = witness.configure({taskArn:taskProtection.taskArn,containerName:'video-worker',containerId:containers[0].DockerId});
    control = Control.create({owner:process.env.VIDEO_WORKER_CONTROL_OWNER,runId:process.env.VIDEO_WORKER_CONTROL_RUN_ID,publicKeyPem:process.env.VIDEO_WORKER_CONTROL_PUBLIC_KEY_PEM,identity,intake,consumer:worker,protection:taskProtection,witness,claims:claimReadback});
  }
  watchVideoWorkerErrors(worker, intake, () => logger.warn('Video consumer dependency unavailable; intake fenced'));
  const queue = new Queue('clip-video', { connection });
  const client = await worker.client;
  client.on('close', () => { intake.redis(false); void worker?.pause(true).catch(() => {}); });
  client.on('error', () => { intake.redis(false); void worker?.pause(true).catch(() => {}); });
  await client.ping(); intake.redis(true); intake.start();
  void worker.run().then(() => { if (!intake.snapshot().closing) intake.fatal(); }).catch(() => {
    intake.fatal(); logger.error('Video consumer loop failed');
  });
  let probing = false;
  const readinessTimer = setInterval(() => {
    if (probing || intake.snapshot().closing) return; probing = true;
    void (async () => {
      let deadline: NodeJS.Timeout | undefined;
      let redisVerified = false;
      try {
        await Promise.race([client.ping(), new Promise((_, reject) => { deadline = setTimeout(() => reject(Error('REDIS_INTAKE_DEADLINE')), 2000); })]);
        intake.redis(true); redisVerified = true;
        if (taskProtection) taskProtection.assertClaimsAllowed();
        if (!intake.snapshot().held && worker?.isPaused()) await worker.resume();
      } catch {
        if (!redisVerified) intake.redis(false);
        else intake.hold('INTAKE_OR_PROTECTION_NOT_CURRENT');
        await worker?.pause(true);
      }
      finally { if (deadline) clearTimeout(deadline); probing = false; }
    })().catch(() => intake.hold('INTAKE_PROBE_EXCEPTION'));
  }, 3000);
  readinessTimer.unref();
  const presenceId = taskProtection?.taskArn || randomUUID();
  const presence = async () => {
    if (r4) return; // Fair scheduling remains off; no new scheduler-presence writes for this experiment.
    if (process.env.VIDEO_TASK_SCALE_IN_PROTECTION_ENABLED !== 'true') return;
    const client = await queue.client;
    if (!protectionHealthy && activeJobs === 0) {
      await client.zrem('video-scheduler:worker-presence:v1', presenceId);
      return;
    }
    await client.zadd('video-scheduler:worker-presence:v1', Date.now(), presenceId);
  };
  const presenceTimer = setInterval(() => { void presence().catch(() => logger.warn('Video worker presence unavailable')); }, 15000);
  presenceTimer.unref();
  await presence();
  const metricsTimer = setInterval(() => {
    void queue.getJobCounts('waiting', 'active', 'delayed', 'failed').then(counts => {
      console.info(JSON.stringify({ event: 'video_queue', ...counts }));
    }).catch(() => logger.warn('Video queue metrics unavailable'));
  }, 30000);
  metricsTimer.unref();
  worker.on('stalled', jobId => logger.warn('Video processing job stalled', { jobId }));
  // ECS probes '/' (liveness); dependency and intake readiness are separate.
  // A blocked event loop cannot serve this probe; failed/ended consumer loops
  // explicitly mark fatal. Redis loss alone never kills an owned active encode.
  const healthState = videoWorkerHealth(intake, () => taskProtection?.snapshot() || null);
  const health = createServer((req, res) => {
    if (req.url?.startsWith('/control')) {
      if (!control) { res.statusCode=404;res.end();return; }
      void control.http(req,res).catch(()=>{res.statusCode=503;res.end();});return;
    }
    if (!['/','/ready'].includes(req.url || '')) {res.statusCode=404;res.end();return;}
    const result = healthState(req.url); res.statusCode = result.status;
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result.body));
  });
  health.listen(env.VIDEO_WORKER_HEALTH_PORT, '0.0.0.0');
  worker.on("ready", () => logger.info("Clip HLS worker ready", { concurrency: env.CLIP_HLS_WORKER_CONCURRENCY }));
  worker.on("completed", job => {
    completionTrace.queueAcknowledged(String(job.id || ''));
    logger.info("Clip HLS job completed", { jobId: job.id });
  });
  worker.on("failed", (job, error) => logger.error("Clip HLS job failed", {
    jobId: job?.id,
    postId: job?.data?.postId,
    mediaId: job?.data?.mediaId,
    attemptsMade: job?.attemptsMade,
    error: String(error)
  }));

  let shutdownStarted = false;
  const shutdown = async (signal: string) => {
    if (shutdownStarted) return; shutdownStarted = true; intake.drain();
    logger.info(`${signal} received, stopping Clip HLS worker`);
    clearInterval(metricsTimer);
    clearInterval(readinessTimer);
    clearInterval(presenceTimer);
    await worker!.close();
    if (taskProtection && !taskProtection.snapshot().released) await taskProtection.release({ intakeFenced: true, activeJobs, consumerClosed: true });
    intake.stopped();
    if (!r4 && process.env.VIDEO_TASK_SCALE_IN_PROTECTION_ENABLED === 'true') {
      const client = await queue.client;
      await client.zrem('video-scheduler:worker-presence:v1', presenceId).catch(() => {});
    }
    await queue.close();
    await new Promise<void>(resolve => health.close(() => resolve()));
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM").catch(() => { intake.hold('SHUTDOWN_PROTECTION_UNRESOLVED'); logger.error('Video shutdown held for operator review'); }));
  process.on("SIGINT", () => void shutdown("SIGINT").catch(() => { intake.hold('SHUTDOWN_PROTECTION_UNRESOLVED'); logger.error('Video shutdown held for operator review'); }));
};

bootstrap().catch(error => {
  logger.error("Clip HLS worker startup failed", { error: String(error) });
  process.exit(1);
});

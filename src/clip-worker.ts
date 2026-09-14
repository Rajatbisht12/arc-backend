import { Worker, type Job } from "bullmq";
import mongoose from "mongoose";
import path from "path";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { connectMongo } from "./infrastructure/database/mongodb";
import { backendRootPath } from "./modules/legacy/legacy.paths";

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

const processJob = async (job: Job) => {
  if (job.name !== "transcode-hls") throw new Error(`Unknown clip video job: ${job.name}`);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const service = require(path.join(backendRootPath, "services", "clipTranscodingService.js")) as ClipTranscodingService;
  return service.processClipTranscodeJob({ ...job.data, workerJobId: String(job.id || "") });
};

const bootstrap = async () => {
  if (!env.CLIP_HLS_ENABLED) throw new Error("CLIP_HLS_ENABLED must be true for the Clip worker");
  await connectMongo();
  const worker = new Worker("clip-video", processJob, {
    connection,
    concurrency: env.CLIP_HLS_WORKER_CONCURRENCY,
    lockDuration: 120000
  });
  worker.on("ready", () => logger.info("Clip HLS worker ready", { concurrency: env.CLIP_HLS_WORKER_CONCURRENCY }));
  worker.on("completed", job => logger.info("Clip HLS job completed", { jobId: job.id }));
  worker.on("failed", (job, error) => logger.error("Clip HLS job failed", {
    jobId: job?.id,
    postId: job?.data?.postId,
    mediaId: job?.data?.mediaId,
    attemptsMade: job?.attemptsMade,
    error: String(error)
  }));

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — stopping Clip HLS worker`);
    await worker.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
};

bootstrap().catch(error => {
  logger.error("Clip HLS worker startup failed", { error: String(error) });
  process.exit(1);
});

import { createClient } from "redis";
import { env } from "../../config/env";
import { logger } from "../../config/logger";

export const redisPubClient = createClient({ url: env.REDIS_URL });
export const redisSubClient = redisPubClient.duplicate();
export const redisCacheClient = redisPubClient.duplicate();

const registerRedisLogging = (name: string, client: ReturnType<typeof createClient>) => {
  client.on("error", (error) => logger.error(`${name} redis error`, { error: String(error) }));
  client.on("connect", () => logger.info(`${name} redis connected`));
};

registerRedisLogging("pub", redisPubClient);
registerRedisLogging("sub", redisSubClient);
registerRedisLogging("cache", redisCacheClient);

export const connectRedis = async (): Promise<void> => {
  await Promise.all([redisPubClient.connect(), redisSubClient.connect(), redisCacheClient.connect()]);
};

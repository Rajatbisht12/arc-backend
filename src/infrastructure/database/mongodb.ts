import mongoose from "mongoose";
import fs from "fs";
import { env } from "../../config/env";
import { logger } from "../../config/logger";

const MONGO_OPTS: mongoose.ConnectOptions = {
  autoIndex: false,
  autoCreate: false,
  readPreference: "primaryPreferred",
  maxPoolSize: 30,
  minPoolSize: 5,
  serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 10000,
  // DocumentDB: disable retryWrites (unsupported) and enable TLS when configured
  retryWrites: env.MONGODB_TLS ? false : true,
  ...(env.MONGODB_TLS && {
    tls: true,
    ...(env.MONGODB_TLS_CA_FILE &&
      fs.existsSync(env.MONGODB_TLS_CA_FILE) && {
        tlsCAFile: env.MONGODB_TLS_CA_FILE,
      }),
  }),
};

export const connectMongo = async (attempt = 1): Promise<void> => {
  try {
    await mongoose.connect(env.MONGODB_URI, MONGO_OPTS);
    logger.info("MongoDB connected");
  } catch (err) {
    const isTransientDns =
      err instanceof Error &&
      (err.message.includes("ENOTFOUND") || err.message.includes("ETIMEDOUT"));

    if (isTransientDns && attempt <= 5) {
      const delay = attempt * 2000;
      logger.warn(`MongoDB DNS lookup failed (attempt ${attempt}/5), retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
      return connectMongo(attempt + 1);
    }
    throw err;
  }
};

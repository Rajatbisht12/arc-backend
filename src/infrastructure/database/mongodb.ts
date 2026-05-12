import mongoose from "mongoose";
import { env } from "../../config/env";
import { logger } from "../../config/logger";

export const connectMongo = async (): Promise<void> => {
  await mongoose.connect(env.MONGODB_URI, {
    autoIndex: env.NODE_ENV !== "production",
    maxPoolSize: 30,
    minPoolSize: 5
  });

  logger.info("MongoDB connected");
};

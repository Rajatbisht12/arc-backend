import cors from "cors";
import compression from "compression";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import mongoose from "mongoose";
import passport from "passport";
import { env } from "./config/env";
import { isAllowedOrigin } from "./config/cors";
import { registerModules } from "./modules";
import { registerLegacyErrorHandlers } from "./modules/legacy/legacy.middleware";
import { createCloudflareOriginAuthMiddleware } from "./infrastructure/security/cloudflareOrigin";
import { logger } from "./config/logger";
import { publicMediaJsonReplacer } from "./legacy-src/utils/mediaDelivery";

export const createApp = () => {
  const app = express();
  app.set("trust proxy", env.TRUST_PROXY_HOPS);
  // Convert legacy unsigned S3 display URLs to the configured CloudFront URL
  // at the final JSON boundary. The resolver uses an explicit public-prefix
  // allowlist and never rewrites signed URLs or private/mixed media prefixes.
  app.set("json replacer", publicMediaJsonReplacer);
  app.use(createCloudflareOriginAuthMiddleware({
    mode: env.CLOUDFLARE_ORIGIN_AUTH_MODE,
    secret: env.CLOUDFLARE_ORIGIN_AUTH_SECRET,
    logger
  }));
  app.use(helmet({
    crossOriginOpenerPolicy: { policy: "unsafe-none" }
  }));
  app.use(compression());
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow server-to-server and same-origin requests with no Origin header.
        if (!origin) return callback(null, true);
        if (isAllowedOrigin(origin)) return callback(null, true);
        const error = new Error("Origin not allowed by CORS") as Error & { statusCode?: number; code?: string };
        error.statusCode = 403;
        error.code = "CORS_ORIGIN_DENIED";
        return callback(error);
      },
      credentials: true,
      // Search sends authenticated cross-origin GETs. Reuse successful
      // allowlisted preflights without weakening the origin/auth checks.
      maxAge: 600
    })
  );
  app.use(express.json({
    limit: "1mb",
    verify: (req, _res, buffer) => {
      // Razorpay signatures cover the exact bytes received. Capture them at
      // the global parser boundary so the webhook route can verify before it
      // trusts the parsed object.
      const path = (req.url || "").split("?")[0];
      if (path === "/api/payments/razorpay/webhook") {
        (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
      }
    }
  }));
  app.use(express.urlencoded({ extended: true, limit: "2mb" }));
  app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));
  app.use(passport.initialize());

  app.use((req, res, next) => {
    if (req.path === "/health" || req.path === "/api/health" || req.path === "/api/simple-health" || req.path === "/api/test-connection") {
      return next();
    }
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        message: "Database connection not ready. Please try again in a moment."
      });
    }
    return next();
  });

  app.get("/", (_req, res) => res.json({ success: true, message: "ARC Backend running" }));
  app.get("/health", (_req, res) => res.json({
    success: true,
    service: "arc-modular-backend",
    status: "ok",
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  }));

  registerModules(app);
  registerLegacyErrorHandlers(app);

  app.use((_req, res) => {
    res.status(404).json({ success: false, message: "Route not found" });
  });

  return app;
};

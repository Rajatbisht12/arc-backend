import { timingSafeEqual } from "crypto";
import type { NextFunction, Request, Response } from "express";

export const CLOUDFLARE_ORIGIN_AUTH_HEADER = "x-squadhunt-origin-auth";

export type CloudflareOriginAuthMode = "off" | "observe" | "enforce";

type OriginAuthLogger = {
  warn: (message: string, meta?: Record<string, unknown>) => void;
};

type OriginAuthOptions = {
  mode: CloudflareOriginAuthMode;
  secret?: string;
  logger: OriginAuthLogger;
};

const HEALTH_PATHS = new Set([
  "/health",
  "/api/health",
  "/api/simple-health",
  "/api/test-connection"
]);

const constantTimeMatches = (expected: string, actual: string): boolean => {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
};

export const hasValidCloudflareOriginAuth = (
  expectedSecret: string | undefined,
  providedSecret: string | string[] | undefined
): boolean => {
  if (!expectedSecret || expectedSecret.length < 32 || typeof providedSecret !== "string") return false;
  return constantTimeMatches(expectedSecret, providedSecret);
};

export const isOriginAuthHealthPath = (path: string): boolean => HEALTH_PATHS.has(path);

export const createCloudflareOriginAuthMiddleware = ({ mode, secret, logger }: OriginAuthOptions) => {
  let lastWarningAt = 0;
  let suppressedWarnings = 0;

  return (req: Request, res: Response, next: NextFunction): void => {
    if (mode === "off" || isOriginAuthHealthPath(req.path)) {
      next();
      return;
    }

    const providedSecret = req.headers[CLOUDFLARE_ORIGIN_AUTH_HEADER];
    const valid = hasValidCloudflareOriginAuth(secret, providedSecret);

    // This credential is only meaningful at the edge/origin boundary and must
    // never be exposed to application handlers, logs, or error reporting.
    delete req.headers[CLOUDFLARE_ORIGIN_AUTH_HEADER];

    if (valid) {
      res.locals.cloudflareOriginAuthenticated = true;
      next();
      return;
    }

    const now = Date.now();
    if (now - lastWarningAt >= 60_000) {
      logger.warn("Cloudflare origin authentication missing or invalid", {
        mode,
        method: req.method,
        path: req.path,
        suppressedSinceLastWarning: suppressedWarnings
      });
      lastWarningAt = now;
      suppressedWarnings = 0;
    } else {
      suppressedWarnings += 1;
    }

    if (mode === "enforce") {
      res.status(403).json({ success: false, message: "Forbidden" });
      return;
    }

    next();
  };
};

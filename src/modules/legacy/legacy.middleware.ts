import type { Express, NextFunction, Request, Response } from "express";
import path from "path";
import { backendMiddlewarePath } from "./legacy.paths";

type MaybeMiddlewareModule = {
  encryptionMiddleware?: (req: Request, res: Response, next: NextFunction) => void;
  handleValidationErrors?: (req: Request, res: Response, next: NextFunction) => void;
  default?: (err: unknown, req: Request, res: Response, next: NextFunction) => void;
};

const safeRequire = <T>(modulePath: string): T | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(modulePath) as T;
  } catch (_error) {
    return null;
  }
};

export const registerLegacyMiddleware = (app: Express): void => {
  const encryption = safeRequire<MaybeMiddlewareModule>(path.join(backendMiddlewarePath, "encryption.js"));
  if (encryption?.encryptionMiddleware) {
    app.use(encryption.encryptionMiddleware);
  }
};

export const registerLegacyErrorHandlers = (app: Express): void => {
  const validation = safeRequire<MaybeMiddlewareModule>(path.join(backendMiddlewarePath, "validation.js"));
  if (validation?.handleValidationErrors) {
    app.use(validation.handleValidationErrors);
  }

  const errorHandler = safeRequire<MaybeMiddlewareModule>(path.join(backendMiddlewarePath, "errorHandler.js"));
  if (typeof errorHandler?.default === "function") {
    app.use(errorHandler.default);
    return;
  }

  if (typeof errorHandler === "function") {
    app.use(errorHandler as unknown as (err: unknown, req: Request, res: Response, next: NextFunction) => void);
  }
};

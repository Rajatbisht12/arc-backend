import path from "path";
import type { RequestHandler } from "express";
import { backendControllerPath, backendMiddlewarePath } from "../legacy/legacy.paths";

type AICoachController = Record<string, RequestHandler>;
type AuthMiddleware = { protect: RequestHandler };
type ValidationMiddleware = { handleValidationErrors: RequestHandler };
type RateLimiterMiddleware = {
  aiCoachLimiter: RequestHandler;
  analyticsLimiter: RequestHandler;
};
type UploadMiddleware = { uploadSingle: (fieldName: string) => RequestHandler };

const loadModule = <T>(modulePath: string): T => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(modulePath) as T;
};

export const aiCoachController = loadModule<AICoachController>(path.join(backendControllerPath, "aiCoachController.js"));
export const { protect } = loadModule<AuthMiddleware>(path.join(backendMiddlewarePath, "auth.js"));
export const { handleValidationErrors } = loadModule<ValidationMiddleware>(path.join(backendMiddlewarePath, "validation.js"));
export const { aiCoachLimiter, analyticsLimiter } = loadModule<RateLimiterMiddleware>(path.join(backendMiddlewarePath, "rateLimiter.js"));
export const { uploadSingle } = loadModule<UploadMiddleware>(path.join(backendMiddlewarePath, "upload.js"));

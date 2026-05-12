import path from "path";
import type { RequestHandler } from "express";
import { backendControllerPath, backendMiddlewarePath } from "../legacy/legacy.paths";

type AIRecruitmentController = Record<string, RequestHandler>;
type AuthMiddleware = { protect: RequestHandler };
type RateLimiterMiddleware = { aiCoachLimiter: RequestHandler };

const loadModule = <T>(modulePath: string): T => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(modulePath) as T;
};

export const aiRecruitmentController = loadModule<AIRecruitmentController>(path.join(backendControllerPath, "aiRecruitmentController.js"));
export const { protect } = loadModule<AuthMiddleware>(path.join(backendMiddlewarePath, "auth.js"));
export const { aiCoachLimiter } = loadModule<RateLimiterMiddleware>(path.join(backendMiddlewarePath, "rateLimiter.js"));

import path from "path";
import type { RequestHandler } from "express";
import { backendControllerPath, backendMiddlewarePath } from "../legacy/legacy.paths";

type FeedbackController = Record<string, RequestHandler>;
type AdminAuthMiddleware = { requireAdmin: RequestHandler };

const loadModule = <T>(modulePath: string): T => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(modulePath) as T;
};

export const feedbackController = loadModule<FeedbackController>(path.join(backendControllerPath, "feedbackController.js"));
export const { requireAdmin } = loadModule<AdminAuthMiddleware>(path.join(backendMiddlewarePath, "adminAuth.js"));

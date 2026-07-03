import path from "path";
import type { RequestHandler } from "express";
import { backendControllerPath, backendMiddlewarePath } from "../legacy/legacy.paths";

type LeaveRequestController = Record<string, RequestHandler>;
type AuthMiddleware = { protect: RequestHandler };
type ValidationMiddleware = { handleValidationErrors: RequestHandler };

const loadModule = <T>(modulePath: string): T => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(modulePath) as T;
};

export const leaveRequestController = loadModule<LeaveRequestController>(path.join(backendControllerPath, "leaveRequestController.js"));
export const { protect } = loadModule<AuthMiddleware>(path.join(backendMiddlewarePath, "auth.js"));
export const { handleValidationErrors } = loadModule<ValidationMiddleware>(path.join(backendMiddlewarePath, "validation.js"));

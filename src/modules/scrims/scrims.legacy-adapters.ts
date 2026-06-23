import path from "path";
import type { RequestHandler } from "express";
import { backendControllerPath, backendMiddlewarePath } from "../legacy/legacy.paths";

type ScrimController = Record<string, RequestHandler>;
type AuthMiddleware = { protect: RequestHandler; optionalAuth: RequestHandler };

const loadModule = <T>(modulePath: string): T => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(modulePath) as T;
};

export const scrimController = loadModule<ScrimController>(path.join(backendControllerPath, "scrimController.js"));
export const { protect, optionalAuth } = loadModule<AuthMiddleware>(path.join(backendMiddlewarePath, "auth.js"));

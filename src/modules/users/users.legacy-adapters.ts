import path from "path";
import type { RequestHandler } from "express";
import { backendControllerPath, backendMiddlewarePath } from "../legacy/legacy.paths";

type UserController = Record<string, RequestHandler>;
type AuthMiddleware = {
  protect: RequestHandler;
  optionalAuth: RequestHandler;
};

const loadModule = <T>(modulePath: string): T => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(modulePath) as T;
};

export const userController = loadModule<UserController>(path.join(backendControllerPath, "userController.js"));
export const { protect, optionalAuth } = loadModule<AuthMiddleware>(path.join(backendMiddlewarePath, "auth.js"));

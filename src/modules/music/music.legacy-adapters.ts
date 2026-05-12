import path from "path";
import type { RequestHandler } from "express";
import { backendMiddlewarePath } from "../legacy/legacy.paths";

type AuthMiddleware = { optionalAuth: RequestHandler };

const loadModule = <T>(modulePath: string): T => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(modulePath) as T;
};

export const { optionalAuth } = loadModule<AuthMiddleware>(path.join(backendMiddlewarePath, "auth.js"));

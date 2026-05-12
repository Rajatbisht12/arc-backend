import path from "path";
import type { RequestHandler } from "express";
import { backendControllerPath, backendMiddlewarePath } from "../legacy/legacy.paths";

type ReportController = Record<string, RequestHandler>;
type AuthMiddleware = { protect: RequestHandler };

const loadModule = <T>(modulePath: string): T => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(modulePath) as T;
};

export const reportController = loadModule<ReportController>(path.join(backendControllerPath, "reportController.js"));
export const { protect } = loadModule<AuthMiddleware>(path.join(backendMiddlewarePath, "auth.js"));

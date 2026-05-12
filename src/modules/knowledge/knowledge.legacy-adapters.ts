import path from "path";
import type { RequestHandler } from "express";
import { backendControllerPath, backendMiddlewarePath } from "../legacy/legacy.paths";

type KnowledgeController = Record<string, RequestHandler>;
type AuthMiddleware = { protect: RequestHandler };
type AdminAuthMiddleware = { requireAdmin: RequestHandler };

const loadModule = <T>(modulePath: string): T => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(modulePath) as T;
};

export const knowledgeController = loadModule<KnowledgeController>(path.join(backendControllerPath, "knowledgeController.js"));
export const { protect } = loadModule<AuthMiddleware>(path.join(backendMiddlewarePath, "auth.js"));
export const { requireAdmin } = loadModule<AdminAuthMiddleware>(path.join(backendMiddlewarePath, "adminAuth.js"));

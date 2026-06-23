import path from "path";
import type { RequestHandler } from "express";
import { backendControllerPath, backendMiddlewarePath } from "../legacy/legacy.paths";

type RecruitmentController = Record<string, RequestHandler>;
type AuthMiddleware = { protect: RequestHandler; optionalAuth: RequestHandler };
type ValidationModule = {
  validateRecruitment: RequestHandler[];
  validatePlayerProfile: RequestHandler[];
  validateApplication: RequestHandler[];
};

const loadModule = <T>(modulePath: string): T => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(modulePath) as T;
};

export const recruitmentController = loadModule<RecruitmentController>(path.join(backendControllerPath, "recruitmentController.js"));
export const { protect, optionalAuth } = loadModule<AuthMiddleware>(path.join(backendMiddlewarePath, "auth.js"));
export const { validateRecruitment, validatePlayerProfile, validateApplication } = loadModule<ValidationModule>(
  path.join(backendMiddlewarePath, "validation.js")
);

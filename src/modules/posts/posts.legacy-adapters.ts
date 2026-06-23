import path from "path";
import type { RequestHandler } from "express";
import { backendControllerPath, backendMiddlewarePath } from "../legacy/legacy.paths";

type PostController = Record<string, RequestHandler>;
type AuthMiddleware = { protect: RequestHandler; optionalAuth: RequestHandler };
type UploadMiddleware = { uploadMultiple: (fieldName: string, maxCount: number) => RequestHandler };
type ValidationMiddleware = { handleValidationErrors: RequestHandler };

const loadModule = <T>(modulePath: string): T => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(modulePath) as T;
};

export const postController = loadModule<PostController>(path.join(backendControllerPath, "postController.js"));
export const { protect, optionalAuth } = loadModule<AuthMiddleware>(path.join(backendMiddlewarePath, "auth.js"));
export const { uploadMultiple } = loadModule<UploadMiddleware>(path.join(backendMiddlewarePath, "upload.js"));
export const { handleValidationErrors } = loadModule<ValidationMiddleware>(path.join(backendMiddlewarePath, "validation.js"));

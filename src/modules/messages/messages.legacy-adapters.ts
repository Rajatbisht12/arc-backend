import path from "path";
import type { RequestHandler } from "express";
import { backendControllerPath, backendMiddlewarePath } from "../legacy/legacy.paths";

type MessageController = Record<string, RequestHandler>;
type AuthMiddleware = { protect: RequestHandler };
type UploadMiddleware = {
  uploadMultiple: (fieldName: string, maxCount: number) => RequestHandler;
  uploadFields: (fields: Array<{ name: string; maxCount: number }>) => RequestHandler;
};
type ValidationMiddleware = { handleValidationErrors: RequestHandler };

const loadModule = <T>(modulePath: string): T => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(modulePath) as T;
};

export const messageController = loadModule<MessageController>(path.join(backendControllerPath, "messageController.js"));
export const { protect } = loadModule<AuthMiddleware>(path.join(backendMiddlewarePath, "auth.js"));
export const { uploadMultiple, uploadFields } = loadModule<UploadMiddleware>(path.join(backendMiddlewarePath, "upload.js"));
export const { handleValidationErrors } = loadModule<ValidationMiddleware>(path.join(backendMiddlewarePath, "validation.js"));

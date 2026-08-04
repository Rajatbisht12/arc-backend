import path from "path";
import type { RequestHandler } from "express";
import { backendMiddlewarePath, backendControllerPath } from "../legacy/legacy.paths";

type AuthMiddleware = { optionalAuth: RequestHandler; protect: RequestHandler };
type UploadMiddleware = { uploadSingle: (field: string) => RequestHandler };
type AudioUploadController = {
  uploadUserAudio: RequestHandler;
  listMyAudio: RequestHandler;
  removeUserAudio: RequestHandler;
};

const loadModule = <T>(modulePath: string): T => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(modulePath) as T;
};

export const { optionalAuth, protect } = loadModule<AuthMiddleware>(
  path.join(backendMiddlewarePath, "auth.js")
);

export const { uploadSingle } = loadModule<UploadMiddleware>(
  path.join(backendMiddlewarePath, "upload.js")
);

export const { uploadUserAudio, listMyAudio, removeUserAudio } =
  loadModule<AudioUploadController>(path.join(backendControllerPath, "audioUploadController.js"));

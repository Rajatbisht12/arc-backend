import type { Express } from "express";
import express from "express";
import path from "path";
import { backendRootPath } from "./legacy.paths";

/**
 * All legacy route modules have been migrated to dedicated modules
 * under src/modules/. This file now only handles:
 *   1. Passport strategy initialisation (once)
 *   2. Serving the legacy uploads directory
 */
export const registerLegacyRoutes = (app: Express): void => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require(path.join(backendRootPath, "config", "passport.js"));

  app.use("/uploads", express.static(path.join(backendRootPath, "uploads")));
};

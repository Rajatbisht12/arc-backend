import path from "path";
import type { RequestHandler } from "express";
import { backendControllerPath } from "../legacy/legacy.paths";

type AdminMonetizationController = Record<string, RequestHandler>;

// Transitional adapter while the admin surface is TypeScript and the mature
// monetization/domain models remain in the legacy module tree.
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const adminMonetizationController = require(
  path.join(backendControllerPath, "adminMonetizationController.js")
) as AdminMonetizationController;

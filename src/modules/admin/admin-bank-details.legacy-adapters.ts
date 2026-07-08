import path from "path";
import type { RequestHandler } from "express";
import { backendControllerPath } from "../legacy/legacy.paths";

type BankDetailsController = Record<string, RequestHandler>;

// eslint-disable-next-line @typescript-eslint/no-var-requires
export const adminBankDetailsController = require(path.join(
  backendControllerPath,
  "adminBankDetailsController.js"
)) as BankDetailsController;

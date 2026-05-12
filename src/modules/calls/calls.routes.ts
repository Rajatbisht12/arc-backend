import { Router } from "express";
import path from "path";
import { backendRootPath } from "../legacy/legacy.paths";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const callRoutes = require(path.join(backendRootPath, "routes", "calls.js"));

const router = Router();
router.use("/", callRoutes);

export default router;

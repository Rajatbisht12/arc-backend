import { Router } from "express";
import path from "path";
import { backendRootPath } from "../legacy/legacy.paths";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const rtcRoutes = require(path.join(backendRootPath, "routes", "rtc.js"));

const router = Router();
router.use("/", rtcRoutes);

export default router;

import { Router } from "express";
import { reportController, protect } from "./reports.legacy-adapters";

const router = Router();

router.post("/", protect, reportController.createReport);

export default router;

import { Router } from "express";
import { knowledgeController, protect, requireAdmin } from "./knowledge.legacy-adapters";

const router = Router();

// Public routes (for testing)
router.post("/test-retrieval", knowledgeController.testRetrieval);
router.get("/stats", knowledgeController.getStats);

// Protected routes (admin only for now)
router.post("/add", protect, requireAdmin, knowledgeController.addKnowledge);
router.post("/bulk-add", protect, requireAdmin, knowledgeController.bulkAddKnowledge);
router.get("/", protect, requireAdmin, knowledgeController.getAllKnowledge);
router.get("/:id", protect, requireAdmin, knowledgeController.getKnowledgeById);
router.put("/:id", protect, requireAdmin, knowledgeController.updateKnowledge);
router.delete("/:id", protect, requireAdmin, knowledgeController.deleteKnowledge);

export default router;

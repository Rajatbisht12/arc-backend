import { Router } from "express";
import { knowledgeController } from "./knowledge.legacy-adapters";
import { requireHardcodedAdminAuth } from "../admin/admin-auth.middleware";

const router = Router();

// Diagnostic retrieval and corpus statistics expose internal knowledge records
// and can trigger non-trivial database work. They are operational/admin tools,
// not public product APIs.
router.post("/test-retrieval", requireHardcodedAdminAuth, knowledgeController.testRetrieval);
router.get("/stats", requireHardcodedAdminAuth, knowledgeController.getStats);

// Admin-only routes
router.post("/add", requireHardcodedAdminAuth, knowledgeController.addKnowledge);
router.post("/bulk-add", requireHardcodedAdminAuth, knowledgeController.bulkAddKnowledge);
router.get("/", requireHardcodedAdminAuth, knowledgeController.getAllKnowledge);
router.get("/:id", requireHardcodedAdminAuth, knowledgeController.getKnowledgeById);
router.put("/:id", requireHardcodedAdminAuth, knowledgeController.updateKnowledge);
router.delete("/:id", requireHardcodedAdminAuth, knowledgeController.deleteKnowledge);

export default router;

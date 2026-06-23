import { Router } from "express";
import { chatController } from "./chat.controller";
import { requireAuth } from "../../shared/require-auth";

const router = Router();

router.get("/:chatId/messages", requireAuth, chatController.getRecentMessages);
router.post("/messages", requireAuth, chatController.sendMessage);

export default router;

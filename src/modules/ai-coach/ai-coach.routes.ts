import { Router } from "express";
import { aiCoachController, protect, aiCoachLimiter, analyticsLimiter, uploadSingle } from "./ai-coach.legacy-adapters";

const router = Router();

// Chat with AI Coach (single AI) - with rate limiting
router.post("/chat", protect, aiCoachLimiter, aiCoachController.chatWithAI);

// Get multiple AI responses (for comparison) - with stricter rate limiting
router.post("/multiple", protect, aiCoachLimiter, aiCoachController.getMultipleResponses);

// Get AI status and health
router.get("/status", protect, aiCoachController.getAIStatus);

// Get personalized suggestions
router.get("/suggestions", protect, aiCoachController.getPersonalizedSuggestions);

// Rate AI response
router.post("/rate", protect, aiCoachController.rateResponse);

// Get AI Coach analytics - with rate limiting
router.get("/analytics", protect, analyticsLimiter, aiCoachController.getAnalytics);

// Get conversation history
router.get("/conversation/:conversationId", protect, aiCoachController.getConversationHistory);
router.put("/conversation/:conversationId/rename", protect, aiCoachController.renameConversation);
router.delete("/conversation/:conversationId", protect, aiCoachController.deleteConversation);

// Get cache statistics
router.get("/cache/stats", protect, aiCoachController.getCacheStatistics);

// Analyze gameplay image/video - with file upload
router.post("/analyze", protect, aiCoachLimiter, uploadSingle("media"), aiCoachController.analyzeGameplay);

export default router;

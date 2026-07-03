import { Router } from "express";
import { body, param } from "express-validator";
import { aiCoachController, protect, aiCoachLimiter, analyticsLimiter, uploadSingle, handleValidationErrors } from "./ai-coach.legacy-adapters";

const router = Router();

// Chat with AI Coach (single AI) - with rate limiting
router.post("/chat", protect, aiCoachLimiter, aiCoachController.chatWithAI);

// Get multiple AI responses (for comparison) - with stricter rate limiting
router.post(
  "/multiple",
  protect,
  aiCoachLimiter,
  body("message").isString().trim().isLength({ min: 1, max: 50_000 }).withMessage("Message is required and cannot exceed 50000 characters"),
  body("conversationHistory").optional().isArray({ max: 20 }).withMessage("Conversation history must contain at most 20 messages"),
  handleValidationErrors,
  aiCoachController.getMultipleResponses
);

// Get AI status and health
router.get("/status", protect, aiCoachController.getAIStatus);

// Get personalized suggestions
router.get("/suggestions", protect, aiCoachController.getPersonalizedSuggestions);

// Rate AI response
router.post(
  "/rate",
  protect,
  body("interactionId").isString().isMongoId().withMessage("Valid interaction ID is required"),
  body("rating").isInt({ min: 1, max: 5 }).withMessage("Rating must be between 1 and 5"),
  body("feedback").optional().isString().isLength({ max: 2000 }).withMessage("Feedback cannot exceed 2000 characters"),
  handleValidationErrors,
  aiCoachController.rateResponse
);

// Get AI Coach analytics - with rate limiting
router.get("/analytics", protect, analyticsLimiter, aiCoachController.getAnalytics);

// Get conversation history
const conversationIdValidation = () => param("conversationId")
  .matches(/^[A-Za-z0-9_-]{1,200}$/)
  .withMessage("Invalid conversation ID");
router.get("/conversation/:conversationId", protect, conversationIdValidation(), handleValidationErrors, aiCoachController.getConversationHistory);
router.put(
  "/conversation/:conversationId/rename",
  protect,
  conversationIdValidation(),
  body("title").isString().trim().isLength({ min: 1, max: 100 }).withMessage("Title is required and cannot exceed 100 characters"),
  handleValidationErrors,
  aiCoachController.renameConversation
);
router.delete("/conversation/:conversationId", protect, conversationIdValidation(), handleValidationErrors, aiCoachController.deleteConversation);

// Get cache statistics
router.get("/cache/stats", protect, aiCoachController.getCacheStatistics);

// Analyze gameplay image/video - with file upload
router.post("/analyze", protect, aiCoachLimiter, uploadSingle("media"), aiCoachController.analyzeGameplay);

export default router;

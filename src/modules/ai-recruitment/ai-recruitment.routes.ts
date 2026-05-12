import { Router } from "express";
import { aiRecruitmentController, protect, aiCoachLimiter } from "./ai-recruitment.legacy-adapters";

const router = Router();

// All routes require authentication
router.use(protect);

// Smart search for candidates based on natural language
router.post("/smart-search", aiCoachLimiter, aiRecruitmentController.smartSearch);

// Match players to team requirements
router.post("/match-players", aiCoachLimiter, aiRecruitmentController.matchPlayersToTeam);

// Analyze a player application
router.post("/analyze-application", aiCoachLimiter, aiRecruitmentController.analyzeApplication);

// Generate recruitment post content
router.post("/generate-post", aiCoachLimiter, aiRecruitmentController.generateRecruitmentPost);

// Generate interview questions
router.post("/generate-questions", aiCoachLimiter, aiRecruitmentController.generateInterviewQuestions);

// Rank candidates for a recruitment post
router.post("/rank-candidates", aiCoachLimiter, aiRecruitmentController.rankCandidates);

export default router;

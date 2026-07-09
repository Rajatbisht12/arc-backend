import { Router } from "express";
import { body } from "express-validator";
import { aiRecruitmentController, protect, aiCoachLimiter, handleValidationErrors } from "./ai-recruitment.legacy-adapters";

const router = Router();
const allowedGames = ["BGMI", "Valorant", "Free Fire", "Call of Duty Mobile", "CS:GO", "Fortnite", "Apex Legends", "League of Legends", "Dota 2"];
const requirementStringFields = [
  "experienceLevel", "dailyPlayingTime", "tournamentExperience", "requiredDevice",
  "language", "availability", "requiredSkills", "portfolioRequirements", "additionalRequirements"
];
const matchValidation = [
  body("teamId").optional().isString().isMongoId().withMessage("Invalid team ID"),
  body("recruitmentId").optional().isString().isMongoId().withMessage("Invalid recruitment ID"),
  body("game").optional().isIn(allowedGames).withMessage("Invalid game"),
  body("role").optional().isString().trim().isLength({ max: 120 }).withMessage("Role cannot exceed 120 characters"),
  body("requirements").optional().isObject().withMessage("Requirements must be an object"),
  ...requirementStringFields.map((field) => (
    body(`requirements.${field}`).optional().isString().isLength({ max: 2000 }).withMessage(`Invalid ${field}`)
  )),
  body("limit").optional().isInt({ min: 1, max: 100 }).withMessage("Limit must be between 1 and 100"),
  handleValidationErrors
];

// All routes require authentication
router.use(protect);

// Smart search for candidates based on natural language
router.post(
  "/smart-search",
  aiCoachLimiter,
  body("searchType").isIn(["players", "staff"]).withMessage("Search type must be players or staff"),
  body("game").optional().isIn(allowedGames).withMessage("Invalid game"),
  body("role").optional().isString().trim().isLength({ max: 120 }).withMessage("Role cannot exceed 120 characters"),
  body("description").isString().trim().isLength({ min: 1, max: 2000 }).withMessage("Description is required and cannot exceed 2000 characters"),
  body("teamId").optional().isString().isMongoId().withMessage("Invalid team ID"),
  handleValidationErrors,
  aiRecruitmentController.smartSearch
);

// Match players to team requirements
router.post("/match-players", aiCoachLimiter, ...matchValidation, aiRecruitmentController.matchPlayersToTeam);

// Analyze a player application
router.post(
  "/analyze-application",
  aiCoachLimiter,
  body("applicationId").isString().isMongoId().withMessage("Valid application ID is required"),
  handleValidationErrors,
  aiRecruitmentController.analyzeApplication
);

// Generate recruitment post content
router.post("/generate-post", aiCoachLimiter, aiRecruitmentController.generateRecruitmentPost);

// Generate interview questions
router.post(
  "/generate-questions",
  aiCoachLimiter,
  body("game").isIn(allowedGames).withMessage("Invalid game"),
  body("role").isString().trim().isLength({ min: 1, max: 120 }).withMessage("Role is required and cannot exceed 120 characters"),
  body("playerProfileId").optional().isString().isMongoId().withMessage("Invalid player profile ID"),
  handleValidationErrors,
  aiRecruitmentController.generateInterviewQuestions
);

// Rank candidates for a recruitment post
router.post(
  "/rank-candidates",
  aiCoachLimiter,
  body("recruitmentId").isString().isMongoId().withMessage("Valid recruitment ID is required"),
  handleValidationErrors,
  aiRecruitmentController.rankCandidates
);

export default router;

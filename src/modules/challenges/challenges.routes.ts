import { Router } from "express";
import { body, param } from "express-validator";
import { challengesController, handleValidationErrors, protect, publicOptionalAuth } from "./challenges.legacy-adapters";

const router = Router();

const validateChallenge = [
  body("title").notEmpty().withMessage("Title is required").isLength({ max: 100 }).withMessage("Title cannot exceed 100 characters"),
  body("description").notEmpty().withMessage("Description is required").isLength({ max: 1000 }).withMessage("Description cannot exceed 1000 characters"),
  body("challengeType").isIn(["kill_count", "win_count", "survival_time", "damage_dealt", "custom"]).withMessage("Invalid challenge type"),
  body("game")
    .isIn(["BGMI", "Valorant", "Free Fire", "Call of Duty Mobile", "CS:GO", "Fortnite", "Apex Legends", "League of Legends", "Dota 2"])
    .withMessage("Invalid game selection"),
  body("category").optional().isIn(["daily", "weekly", "monthly", "special", "tournament"]).withMessage("Invalid category"),
  body("requirements.targetValue").isNumeric().withMessage("Target value must be a number").isInt({ min: 1 }).withMessage("Target value must be at least 1"),
  body("requirements.targetUnit").isIn(["kills", "wins", "minutes", "damage", "matches", "custom"]).withMessage("Invalid target unit"),
  body("requirements.timeLimit").optional().isInt({ min: 1, max: 168 }).withMessage("Time limit must be between 1 and 168 hours"),
  body("requirements.maxParticipants").optional().isInt({ min: 1, max: 10000 }).withMessage("Max participants must be between 1 and 10000"),
  body("rewards.primaryReward").notEmpty().withMessage("Primary reward is required").isLength({ max: 200 }).withMessage("Primary reward cannot exceed 200 characters"),
  body("rewards.rewardType").isIn(["cash", "gift_card", "in_game_items", "merchandise", "recognition", "custom"]).withMessage("Invalid reward type"),
  body("rewards.rewardValue").optional().isNumeric().withMessage("Reward value must be a number").isFloat({ min: 0 }).withMessage("Reward value cannot be negative"),
  body("startDate")
    .isISO8601()
    .withMessage("Invalid start date format")
    .custom((value) => {
      if (new Date(value) < new Date()) throw new Error("Start date cannot be in the past");
      return true;
    }),
  body("endDate")
    .isISO8601()
    .withMessage("Invalid end date format")
    .custom((value, { req }) => {
      if (new Date(value) <= new Date(req.body.startDate)) throw new Error("End date must be after start date");
      return true;
    }),
  body("visibility").optional().isIn(["public", "followers", "private"]).withMessage("Invalid visibility setting"),
  body("tags")
    .optional()
    .isArray()
    .withMessage("Tags must be an array")
    .custom((tags) => {
      if (tags && tags.length > 10) throw new Error("Cannot have more than 10 tags");
      if (tags) {
        tags.forEach((tag: unknown) => {
          if (typeof tag !== "string" || tag.length > 30) {
            throw new Error("Each tag must be a string with maximum 30 characters");
          }
        });
      }
      return true;
    })
];

const validateProgressUpdate = [
  body("progressValue").isNumeric().withMessage("Progress value must be a number").isFloat({ min: 0 }).withMessage("Progress value cannot be negative")
];
const validateChallengeId = [param("id").isMongoId().withMessage("Invalid challenge ID")];

router.get("/", publicOptionalAuth, challengesController.getChallenges);
router.get("/my/challenges", protect, challengesController.getMyChallenges);
router.get("/my/participations", protect, challengesController.getMyParticipations);
router.get("/:id", publicOptionalAuth, validateChallengeId, handleValidationErrors, challengesController.getChallenge);
router.post("/", protect, ...validateChallenge, handleValidationErrors, challengesController.createChallenge);
router.post("/:id/join", protect, validateChallengeId, handleValidationErrors, challengesController.joinChallenge);
router.put("/:id/progress", protect, validateChallengeId, ...validateProgressUpdate, handleValidationErrors, challengesController.updateProgress);
router.put("/:id", protect, validateChallengeId, handleValidationErrors, challengesController.updateChallenge);
router.delete("/:id", protect, validateChallengeId, handleValidationErrors, challengesController.deleteChallenge);
router.post("/:id/distribute-rewards", protect, validateChallengeId, handleValidationErrors, challengesController.distributeRewards);

export default router;

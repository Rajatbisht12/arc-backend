import { Router } from "express";
import { body, param } from "express-validator";
import rateLimit from "express-rate-limit";
import { handleValidationErrors, publicOptionalAuth, postController, publicPostSeoController, videoUploadController, protect, uploadFields, validateAchievementPostBody } from "./posts.legacy-adapters";

const router = Router();

const createPostValidation = [
  body("text").optional({ values: "null" }).isString().isLength({ max: 2000 }).withMessage("Post content cannot exceed 2000 characters"),
  body().custom((_, { req }) => {
    const hasText = req.body.text != null && String(req.body.text).trim().length > 0;
    const files = req.files as undefined | unknown[] | Record<string, unknown[]>;
    const hasMedia = (Array.isArray(files) ? files.length > 0 : Boolean(files?.media?.length)) || Boolean(req.body.videoUploadIds);
    if (!hasText && !hasMedia) {
      throw new Error("Post must have some text or at least one image/video");
    }
    return true;
  }),
  body("postType").optional().isIn(["general", "recruitment", "achievement", "looking-for-team"]).withMessage("Invalid post type"),
  body("visibility").optional().isIn(["public", "followers", "private"]).withMessage("Invalid visibility setting"),
  body().custom((_, { req }) => {
    const validationError = validateAchievementPostBody(req.body);
    if (validationError) throw new Error(validationError);
    return true;
  })
];

const updatePostValidation = [
  body("text").optional().isLength({ min: 1, max: 2000 }).withMessage("Post content must be between 1 and 2000 characters"),
  body("visibility").optional().isIn(["public", "followers", "private"]).withMessage("Invalid visibility setting")
];

const addCommentValidation = [body("text").isLength({ min: 1, max: 500 }).withMessage("Comment must be between 1 and 500 characters")];
const postIdValidation = [param("id").isMongoId().withMessage("Invalid post ID")];
const commentIdValidation = [param("commentId").isMongoId().withMessage("Invalid comment ID")];
const MAX_ENGAGEMENT_DURATION_MS = 24 * 60 * 60 * 1000;
const engagementMetricValidation = [
  body("durationMs").optional({ values: "null" }).isInt({ min: 0, max: MAX_ENGAGEMENT_DURATION_MS }).withMessage("Invalid engagement duration"),
  body("dwellTime").optional({ values: "null" }).isInt({ min: 0, max: MAX_ENGAGEMENT_DURATION_MS }).withMessage("Invalid dwell time"),
  body("completionRate").optional({ values: "null" }).isFloat({ min: 0, max: 1 }).withMessage("Completion rate must be between 0 and 1"),
  body("context").optional({ values: "null" }).isString().trim().isLength({ max: 64 }).withMessage("Invalid engagement context"),
  body("source").optional({ values: "null" }).isIn(["organic", "boost"]).withMessage("Invalid engagement source"),
  body("deliverySource").optional({ values: "null" }).isIn(["organic", "boost"]).withMessage("Invalid delivery source")
];
const interactionValidation = [
  body("postId").isString().isMongoId().withMessage("Invalid post ID"),
  body("interactionType").isIn(["watch", "like", "comment", "share", "save", "click", "dwell_time", "skip"]).withMessage("Invalid interaction type"),
  body("clickedElement").optional({ values: "null" }).isString().isLength({ max: 128 }).withMessage("Invalid clicked element"),
  ...engagementMetricValidation
];
const reportPostValidation = [
  body("reason").optional().isString().trim().isLength({ min: 1, max: 500 }).withMessage("Report reason must be between 1 and 500 characters")
];
const postAvailabilityLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many post lookup requests. Try again later." }
});

const videoUploadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => String((req as typeof req & { user?: { _id?: string } }).user?._id || "anonymous"), message: { success: false, code: "UPLOAD_RATE_LIMIT", message: "Too many upload requests. Try again shortly." } });
// Five concurrent videos may each poll processing every two seconds. Keep
// read-only polling separate so it cannot consume the part/completion budget.
const videoStatusLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 3000, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => String((req as typeof req & { user?: { _id?: string } }).user?._id || "anonymous"), message: { success: false, code: "UPLOAD_RATE_LIMIT", message: "Too many upload status requests. Try again shortly." } });
const videoCreateLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => String((req as typeof req & { user?: { _id?: string } }).user?._id || "anonymous"), message: { success: false, code: "UPLOAD_RATE_LIMIT", message: "Too many new video uploads. Try again later." } });
router.get("/video-uploads/policy", protect, videoUploadController.policy);
router.get("/video-playback/*", videoUploadController.playbackManifest);
router.post("/video-uploads", protect, videoCreateLimiter, videoUploadController.create);
router.get("/video-uploads/:id", protect, videoStatusLimiter, videoUploadController.get);
router.get("/video-uploads/:id/parts", protect, videoStatusLimiter, videoUploadController.listParts);
router.post("/video-uploads/:id/parts", protect, videoUploadLimiter, videoUploadController.signParts);
router.post("/video-uploads/:id/complete", protect, videoUploadLimiter, videoUploadController.complete);
router.post("/video-uploads/:id/retry", protect, videoUploadLimiter, videoUploadController.retry);
router.delete("/video-uploads/:id", protect, videoUploadLimiter, videoUploadController.cancel);
router.post("/", protect, uploadFields([{ name: "media", maxCount: 5 }, { name: "cover", maxCount: 1 }]), createPostValidation, handleValidationErrors, postController.createPost);
router.get("/", publicOptionalAuth, postController.getPosts);
router.get("/clips", publicOptionalAuth, postController.getClips);
router.get("/public-seo/sitemap/count", publicPostSeoController.getPublicPostSitemapCount);
router.get("/public-seo/sitemap", publicPostSeoController.getPublicPostSitemap);
router.get("/public-seo/post/:id", postIdValidation, handleValidationErrors, publicPostSeoController.getPublicPostSeo);
router.get("/public-seo/clip/:id", postIdValidation, handleValidationErrors, publicPostSeoController.getPublicClipSeo);
// Keep the legacy existence probe for previously published clients. Detail
// requests now use privacy-aware optional authentication directly.
router.get("/:id/availability", postAvailabilityLimiter, postIdValidation, handleValidationErrors, postController.getPostAvailability);
router.get("/saved", protect, postController.getSavedPosts);
router.get("/liked", protect, postController.getLikedPosts);
router.get("/:id", publicOptionalAuth, postIdValidation, handleValidationErrors, postController.getPost);
router.get("/:id/comments", publicOptionalAuth, postIdValidation, handleValidationErrors, postController.getPostComments);
router.get("/:id/likes", publicOptionalAuth, postIdValidation, handleValidationErrors, postController.getPostLikes);
router.post("/:id/view", protect, postIdValidation, engagementMetricValidation, handleValidationErrors, postController.recordClipView);
router.post("/:id/exposure", protect, postIdValidation,
  body("durationMs").isInt({ min: 1000, max: MAX_ENGAGEMENT_DURATION_MS }),
  body("context").isIn(["feed", "clips", "post", "profile", "search"]),
  handleValidationErrors, postController.recordRecommendationExposure);
router.post("/:id/like", protect, postIdValidation, handleValidationErrors, postController.toggleLike);
router.post("/:id/comment", protect, postIdValidation, addCommentValidation, handleValidationErrors, postController.addComment);
router.delete("/:id/comments/:commentId", protect, postIdValidation, commentIdValidation, handleValidationErrors, postController.deleteComment);
router.post("/:id/share", protect, postIdValidation, handleValidationErrors, postController.recordShare);
router.post("/:id/save", protect, postIdValidation, handleValidationErrors, postController.toggleSave);
router.post("/interaction", protect, interactionValidation, handleValidationErrors, postController.trackInteraction);
router.put("/:id", protect, postIdValidation, updatePostValidation, handleValidationErrors, postController.updatePost);
router.delete("/:id", protect, postIdValidation, handleValidationErrors, postController.deletePost);
router.post("/:id/report", protect, postIdValidation, reportPostValidation, handleValidationErrors, postController.reportPost);
router.post("/:id/boost", protect, postIdValidation, handleValidationErrors, postController.boostPost);

export default router;

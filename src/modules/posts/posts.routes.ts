import { Router } from "express";
import { body } from "express-validator";
import { handleValidationErrors, optionalAuth, postController, protect, uploadMultiple } from "./posts.legacy-adapters";

const router = Router();

const createPostValidation = [
  body("text").optional({ values: "null" }).isString().isLength({ max: 2000 }).withMessage("Post content cannot exceed 2000 characters"),
  body().custom((_, { req }) => {
    const hasText = req.body.text != null && String(req.body.text).trim().length > 0;
    const hasMedia = req.files && req.files.length > 0;
    if (!hasText && !hasMedia) {
      throw new Error("Post must have some text or at least one image/video");
    }
    return true;
  }),
  body("postType").optional().isIn(["general", "recruitment", "achievement", "looking-for-team"]).withMessage("Invalid post type"),
  body("visibility").optional().isIn(["public", "followers", "private"]).withMessage("Invalid visibility setting")
];

const updatePostValidation = [
  body("text").optional().isLength({ min: 1, max: 2000 }).withMessage("Post content must be between 1 and 2000 characters"),
  body("visibility").optional().isIn(["public", "followers", "private"]).withMessage("Invalid visibility setting")
];

const addCommentValidation = [body("text").isLength({ min: 1, max: 500 }).withMessage("Comment must be between 1 and 500 characters")];

router.post("/", protect, uploadMultiple("media", 5), createPostValidation, handleValidationErrors, postController.createPost);
router.get("/", optionalAuth, postController.getPosts);
router.get("/clips", optionalAuth, postController.getClips);
router.get("/:id", optionalAuth, postController.getPost);
router.post("/:id/view", protect, postController.recordClipView);
router.post("/:id/like", protect, postController.toggleLike);
router.post("/:id/comment", protect, addCommentValidation, handleValidationErrors, postController.addComment);
router.put("/:id", protect, updatePostValidation, handleValidationErrors, postController.updatePost);
router.delete("/:id", protect, postController.deletePost);
router.post("/:id/report", protect, postController.reportPost);
router.post("/:id/boost", protect, postController.boostPost);

export default router;

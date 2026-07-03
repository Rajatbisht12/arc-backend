import { Router } from "express";
import { body, param } from "express-validator";
import rateLimit from "express-rate-limit";
import { handleValidationErrors, messageController, protect, uploadFields, uploadMultiple } from "./messages.legacy-adapters";

const router = Router();

const sendDirectMessageValidation = [
  body("recipientId").optional().isString().trim().isMongoId().withMessage("Invalid recipient ID"),
  body("recipientUsername").optional().trim(),
  body("text").optional().isLength({ max: 1000 }).withMessage("Message cannot exceed 1000 characters")
];

const createChatRoomValidation = [
  body("name").isLength({ min: 1, max: 50 }).withMessage("Chat room name must be between 1 and 50 characters"),
  body("description").optional().isLength({ max: 200 }).withMessage("Description cannot exceed 200 characters"),
  body("memberIds").optional().isArray({ max: 100 }).withMessage("Member IDs must be an array with at most 100 entries"),
  body("memberIds.*").optional().isString().isMongoId().withMessage("Invalid member ID")
];

const updateChatRoomValidation = [
  body("name").isLength({ min: 1, max: 50 }).withMessage("Chat room name must be between 1 and 50 characters"),
  body("description").optional().isLength({ max: 200 }).withMessage("Description cannot exceed 200 characters")
];

const addMemberValidation = [body("memberId").isString().notEmpty().withMessage("Member ID is required").isMongoId().withMessage("Invalid member ID")];
const updateMemberRoleValidation = [body("role").isIn(["admin", "member"]).withMessage("Role must be either admin or member")];
const sendGroupMessageValidation = [
  body("chatRoomId").isString().notEmpty().withMessage("Chat room ID is required").isMongoId().withMessage("Invalid chat room ID"),
  body("text").optional().isLength({ max: 1000 }).withMessage("Message cannot exceed 1000 characters")
];
const addReactionValidation = [
  body("emoji").notEmpty().withMessage("Emoji is required").isLength({ min: 1, max: 10 }).withMessage("Invalid emoji")
];
const chatRoomIdValidation = [param("chatRoomId").isMongoId().withMessage("Invalid chat room ID")];
const userIdValidation = [param("userId").isMongoId().withMessage("Invalid user ID")];
const memberIdValidation = [param("memberId").isMongoId().withMessage("Invalid member ID")];
const messageIdValidation = [param("messageId").isMongoId().withMessage("Invalid message ID")];
const inviteResponseValidation = [
  body("response").isIn(["accept", "decline"]).withMessage("Response must be accept or decline")
];
const inviteDirectMessageValidation = [
  body("targetUserId").isString().isMongoId().withMessage("Invalid target user ID")
];
const markReadValidation = [
  body("messageType").isIn(["direct", "group"]).withMessage("Invalid message type"),
  body("chatId").custom((value, { req }) => {
    const normalized = typeof value === "string" ? value.trim() : "";
    const pattern = req.body?.messageType === "direct"
      ? /^direct_[a-f0-9]{24}$/i
      : /^[a-f0-9]{24}$/i;
    if (!pattern.test(normalized)) throw new Error("Invalid chat ID");
    return true;
  })
];
const callSummaryValidation = [
  body("callId").matches(/^[A-Za-z0-9:_-]{8,160}$/).withMessage("Invalid call ID"),
  body("callType").isIn(["voice", "video"]).withMessage("Invalid call type"),
  body("outcome").isIn(["answered", "missed", "declined"]).withMessage("Invalid call outcome"),
  body("recipientId").optional().isString().isMongoId().withMessage("Invalid recipient ID"),
  body("chatRoomId").optional().isString().isMongoId().withMessage("Invalid chat room ID"),
  body("durationSeconds").optional().isFloat({ min: 0, max: 86400 }).withMessage("Invalid call duration"),
  body("participantCount").optional().isInt({ min: 1, max: 100 }).withMessage("Invalid participant count"),
  body().custom((value) => {
    if (Boolean(value?.recipientId) === Boolean(value?.chatRoomId)) {
      throw new Error("Exactly one of recipientId or chatRoomId is required");
    }
    return true;
  })
];
const reportMessageValidation = [
  body("messageId").isString().isMongoId().withMessage("Invalid message ID"),
  body("reason").isString().trim().isLength({ min: 1, max: 500 }).withMessage("Report reason must be between 1 and 500 characters")
];
const inviteTokenValidation = [
  param("inviteToken")
    .matches(/^[a-f0-9]{32}$/i)
    .withMessage("Invalid or expired invite link")
];
const invitePreviewLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many invite preview requests. Try again later." }
});

router.post("/direct", protect, uploadMultiple("media", 3), sendDirectMessageValidation, handleValidationErrors, messageController.sendDirectMessage);
router.get("/direct/:userId", protect, userIdValidation, handleValidationErrors, messageController.getDirectMessages);
router.get("/recent", protect, messageController.getRecentConversations);
router.post("/rooms", protect, createChatRoomValidation, handleValidationErrors, messageController.createChatRoom);
router.get("/rooms", protect, messageController.getChatRooms);
router.post("/rooms/:chatRoomId/leave", protect, chatRoomIdValidation, handleValidationErrors, messageController.leaveGroup);
router.get("/rooms/:chatRoomId/invite-link", protect, chatRoomIdValidation, handleValidationErrors, messageController.getGroupInviteLink);
router.post("/rooms/:chatRoomId/reset-invite-link", protect, chatRoomIdValidation, handleValidationErrors, messageController.resetGroupInviteLink);
router.post("/rooms/:chatRoomId/invite-dm", protect, chatRoomIdValidation, inviteDirectMessageValidation, handleValidationErrors, messageController.sendGroupInviteDM);
router.put("/rooms/:chatRoomId/permissions", protect, chatRoomIdValidation, handleValidationErrors, messageController.updateGroupPermissions);
router.get(
  "/join/:inviteToken/preview",
  invitePreviewLimiter,
  inviteTokenValidation,
  handleValidationErrors,
  messageController.getGroupInvitePreview
);
router.post("/join/:inviteToken", protect, inviteTokenValidation, handleValidationErrors, messageController.joinGroupViaInvite);
router.put(
  "/rooms/:chatRoomId",
  protect,
  chatRoomIdValidation,
  uploadFields([{ name: "avatar", maxCount: 1 }]),
  updateChatRoomValidation,
  handleValidationErrors,
  messageController.updateChatRoom
);
router.post("/rooms/:chatRoomId/members", protect, chatRoomIdValidation, addMemberValidation, handleValidationErrors, messageController.addMemberToChatRoom);
router.put("/rooms/:chatRoomId/members/:memberId/role", protect, chatRoomIdValidation, memberIdValidation, updateMemberRoleValidation, handleValidationErrors, messageController.updateMemberRole);
router.delete("/rooms/:chatRoomId/members/:memberId", protect, chatRoomIdValidation, memberIdValidation, handleValidationErrors, messageController.removeMemberFromChatRoom);
router.post("/group", protect, uploadMultiple("media", 3), sendGroupMessageValidation, handleValidationErrors, messageController.sendGroupMessage);
router.get("/rooms/:chatRoomId", protect, chatRoomIdValidation, handleValidationErrors, messageController.getGroupMessages);
router.post("/mark-read", protect, markReadValidation, handleValidationErrors, messageController.markMessagesAsRead);
router.post("/call-summary", protect, callSummaryValidation, handleValidationErrors, messageController.createCallSummary);
router.delete("/direct/:userId", protect, userIdValidation, handleValidationErrors, messageController.deleteDirectMessage);
router.delete("/rooms/:chatRoomId", protect, chatRoomIdValidation, handleValidationErrors, messageController.deleteGroupMessage);
router.post("/:messageId/reaction", protect, messageIdValidation, addReactionValidation, handleValidationErrors, messageController.addReaction);
router.post("/:messageId/invite-response", protect, messageIdValidation, inviteResponseValidation, handleValidationErrors, messageController.handleInviteResponse);
router.get("/preferences", protect, messageController.getChatPreferences);
router.post("/chat/:userId/mute", protect, userIdValidation, handleValidationErrors, messageController.toggleMuteChat);
// Mobile-compatible mute endpoints
router.post("/direct/:userId/mute", protect, userIdValidation, handleValidationErrors, messageController.toggleMuteChat);
router.post("/rooms/:chatRoomId/mute", protect, chatRoomIdValidation, handleValidationErrors, messageController.toggleMuteGroup);
router.post("/chat/:userId/pin", protect, userIdValidation, handleValidationErrors, messageController.togglePinChat);
router.post("/group/:chatRoomId/pin", protect, chatRoomIdValidation, handleValidationErrors, messageController.togglePinGroup);
// Report a message
router.post("/report", protect, reportMessageValidation, handleValidationErrors, messageController.reportMessage);
// Pin a message (message-level bookmark — stored per-user client-side; backend acknowledges)
router.post("/pin", protect, (_req, res) => {
  // Message pinning is persisted client-side (pinnedMessages Set in React state).
  // The backend endpoint exists purely to acknowledge the request gracefully.
  res.json({ success: true, message: "Message pinned" });
});


export default router;

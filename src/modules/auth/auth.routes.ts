import { Router } from "express";
import { body, query } from "express-validator";
import rateLimit from "express-rate-limit";
import {
  legacyAuthController,
  passport,
  progressiveLoginLimiter,
  progressiveOtpLoginLimiter,
  protect,
  protectAllowIncomplete,
  handleValidationErrors,
  recordSuccessfulLogin,
  uploadSingle
} from "./auth.legacy-adapters";

const router = Router();

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    message: "Too many OTP requests, please try again after 15 minutes"
  }
});

const registerValidation = [
  body("username")
    .isLength({ min: 3, max: 20 })
    .withMessage("Username must be between 3 and 20 characters")
    .custom((value) => {
      if (value && value.includes(" ")) {
        throw new Error("Username cannot contain spaces");
      }
      return true;
    })
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage("Username can only contain letters, numbers and underscores (no spaces)"),
  body("email").isEmail().withMessage("Please provide a valid email"),
  body("password").isString().isLength({ min: 6, max: 128 }).withMessage("Password must be between 6 and 128 characters"),
  body("userType").isIn(["player", "team"]).withMessage("User type must be either player or team"),
  body("displayName")
    .isLength({ min: 1, max: 50 })
    .withMessage("Display name is required and must be less than 50 characters"),
  body("gender")
    .optional()
    .isIn(["male", "female", "other", "prefer_not_to_say"])
    .withMessage("Gender must be male, female, other, or prefer_not_to_say")
];

const loginValidation = [
  body("email").optional().isEmail().withMessage("Please provide a valid email"),
  body("username").optional().isLength({ min: 3, max: 20 }).withMessage("Username must be between 3 and 20 characters"),
  body("password").isString().isLength({ min: 1, max: 128 }).withMessage("Password is required"),
  body().custom((value) => {
    if (!value.email && !value.username) {
      throw new Error("Either email or username must be provided");
    }
    return true;
  })
];

const changePasswordValidation = [
  body("currentPassword").isString().isLength({ min: 1, max: 128 }).withMessage("Current password is required"),
  body("newPassword").isString().isLength({ min: 6, max: 128 }).withMessage("New password must be between 6 and 128 characters")
];

const deleteAccountValidation = [body("password").isString().isLength({ min: 1, max: 128 }).withMessage("Password is required to delete account")];
const usernameLookupValidation = [
  query("username").isString().isLength({ min: 3, max: 20 }).matches(/^[a-zA-Z0-9_]+$/).withMessage("Invalid username")
];
const emailLookupValidation = [
  query("email").isString().isLength({ max: 254 }).isEmail().withMessage("Invalid email")
];
const sendOtpValidation = [
  body("email").isString().isLength({ max: 254 }).isEmail().withMessage("Valid email is required"),
  body("purpose").optional().isIn(["login", "register", "forgot_password"]).withMessage("Invalid purpose")
];
const verifyOtpValidation = [
  body("email").isString().isLength({ max: 254 }).isEmail().withMessage("Valid email is required"),
  body("otp").matches(/^\d{6}$/).withMessage("OTP must be exactly 6 digits")
];
const resetPasswordValidation = [
  ...verifyOtpValidation,
  body("newPassword").isString().isLength({ min: 6, max: 128 }).withMessage("New password must be between 6 and 128 characters")
];
const googleTokenValidation = [
  body("access_token").isString().isLength({ min: 1, max: 8192 }).withMessage("Invalid Google access token")
];
const appleTokenValidation = [
  body("identityToken").isString().isLength({ min: 1, max: 8192 }).withMessage("Invalid Apple identity token"),
  body("displayName").optional().isString().isLength({ max: 100 }).withMessage("Display name is too long"),
  body("nonce").optional().isString().isLength({ max: 512 }).withMessage("Invalid Apple nonce")
];
const passwordCheckValidation = [
  body("password")
    .isString()
    .isLength({ min: 6, max: 128 })
    .withMessage("Password must be between 6 and 128 characters")
];

const passwordCheckLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String((req as unknown as { user?: { _id?: unknown } }).user?._id || "authenticated"),
  message: { success: false, message: "Too many password checks. Try again shortly." }
});

const authLookupLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many account lookup requests. Try again later." }
});

const externalAuthLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many authentication requests. Try again later." }
});

const guestTokenLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many guest token requests. Try again later." }
});

const profileUpdateValidation = [
  body("username")
    .optional()
    .isLength({ min: 3, max: 20 })
    .withMessage("Username must be between 3 and 20 characters")
    .custom((value) => {
      if (value && value.includes(" ")) {
        throw new Error("Username cannot contain spaces");
      }
      return true;
    })
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage("Username can only contain letters, numbers and underscores (no spaces)"),
  body("displayName").optional().isLength({ min: 1, max: 50 }).withMessage("Display name must be less than 50 characters"),
  body("gender")
    .optional()
    .isIn(["", "male", "female", "other", "prefer_not_to_say"])
    .withMessage("Gender must be male, female, other, or prefer_not_to_say")
];

router.get("/check-username", authLookupLimiter, usernameLookupValidation, handleValidationErrors, legacyAuthController.checkUsernameAvailability);
router.get("/check-email", authLookupLimiter, emailLookupValidation, handleValidationErrors, legacyAuthController.checkEmailAvailability);
router.post("/send-otp", otpLimiter, sendOtpValidation, handleValidationErrors, legacyAuthController.sendOtp);
router.post("/verify-otp-register", otpLimiter, verifyOtpValidation, handleValidationErrors, legacyAuthController.verifyOtpForRegister);
router.post("/verify-otp-login", progressiveOtpLoginLimiter, verifyOtpValidation, handleValidationErrors, legacyAuthController.verifyOtpAndLogin);
router.post("/reset-password-otp", otpLimiter, resetPasswordValidation, handleValidationErrors, legacyAuthController.resetPasswordWithOtp);
router.post(
  "/check-password-same",
  protect,
  passwordCheckLimiter,
  passwordCheckValidation,
  handleValidationErrors,
  legacyAuthController.checkPasswordSame
);
router.post("/register", uploadSingle("avatar"), registerValidation, handleValidationErrors, legacyAuthController.register);
router.post("/login", progressiveLoginLimiter, loginValidation, handleValidationErrors, legacyAuthController.login);
router.post("/guest-token", guestTokenLimiter, legacyAuthController.generateGuestToken);
router.get("/me", protectAllowIncomplete, legacyAuthController.getMe);
router.put("/profile", protect, uploadSingle("avatar"), profileUpdateValidation, handleValidationErrors, legacyAuthController.updateProfile);
router.post("/upload-profile-picture", protect, uploadSingle("image"), legacyAuthController.uploadProfilePicture);
router.post("/upload-banner", protect, uploadSingle("image"), legacyAuthController.uploadBanner);
router.put("/change-password", protect, changePasswordValidation, handleValidationErrors, legacyAuthController.changePassword);
router.delete("/account", protect, deleteAccountValidation, handleValidationErrors, legacyAuthController.deleteAccount);
router.post("/logout", protectAllowIncomplete, legacyAuthController.logout);
router.post("/complete-profile", protectAllowIncomplete, legacyAuthController.completeProfile);
router.post("/complete-google-profile", protectAllowIncomplete, legacyAuthController.completeGoogleProfile);

router.post("/google/token", externalAuthLimiter, googleTokenValidation, handleValidationErrors, legacyAuthController.googleTokenLogin);
router.post("/apple/mobile", externalAuthLimiter, appleTokenValidation, handleValidationErrors, legacyAuthController.appleMobileLogin);

router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));
// Mobile entry point — passes state=mobile so callback can redirect to deep link
router.get("/google/mobile", passport.authenticate("google", { scope: ["profile", "email"], state: "mobile" } as object));
router.get(
  "/google/callback",
  passport.authenticate("google", { session: false, failureRedirect: `${process.env.CLIENT_URL}/login?error=google_auth_failed` }),
  async (req, res) => {
    try {
      const authReq = req as unknown as { user?: { token?: string; user?: { _id?: unknown } } };
      const token = authReq.user?.token ?? "";
      void recordSuccessfulLogin({
        user: authReq.user?.user,
        authMethod: "google_passport",
        request: req,
      });
      const isMobile = req.query.state === "mobile";
      if (isMobile) {
        return res.redirect(`arcmobile://google-auth?token=${encodeURIComponent(token)}`);
      }
      return res.redirect(`${process.env.CLIENT_URL}/login#token=${encodeURIComponent(token)}`);
    } catch (err) {
      console.error("Google OAuth callback error:", err);
      return res.redirect(`${process.env.CLIENT_URL}/login?error=google_auth_failed`);
    }
  }
);

export default router;

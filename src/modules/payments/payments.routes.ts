import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { body } from "express-validator";
import { handleValidationErrors, paymentController, premiumWebhookController, protect } from "./payments.legacy-adapters";

const router = Router();
const webhookLimiter = rateLimit({
  windowMs: 60_000,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Webhook rate limit exceeded" }
});
const customerPaymentLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as any).user?._id ? String((req as any).user._id) : ipKeyGenerator(req.ip || "127.0.0.1"),
  message: { success: false, message: "Too many payment requests. Try again later." }
});
const customerCreateLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as any).user?._id ? String((req as any).user._id) : ipKeyGenerator(req.ip || "127.0.0.1"),
  message: { success: false, message: "Too many payment creation requests. Try again later." }
});

const platformValidation = () => body("platform")
  .optional()
  .isString()
  .isIn(["web", "android", "ios"])
  .withMessage("Invalid purchase platform");
const billingPeriodValidation = () => body("billingPeriod")
  .isString()
  .isIn(["monthly", "quarterly", "yearly"])
  .withMessage("Invalid billing period");
const providerIdValidation = (field: string) => body(field)
  .isString()
  .trim()
  .isLength({ min: 1, max: 200 })
  .withMessage(`${field} is invalid`);
const signatureValidation = () => body("razorpay_signature")
  .isString()
  .isHexadecimal()
  .isLength({ min: 64, max: 64 })
  .withMessage("razorpay_signature is invalid");

const createSubscriptionOrderValidation = [
  body("planId").isString().trim().isLength({ min: 1, max: 64 }).withMessage("Plan ID is invalid"),
  billingPeriodValidation(),
  platformValidation()
];
const verifyOneTimePaymentValidation = [
  providerIdValidation("razorpay_order_id"),
  providerIdValidation("razorpay_payment_id"),
  signatureValidation(),
  platformValidation()
];
const createRecurringSubscriptionValidation = [
  body().custom((_value, { req }) => {
    const plan = req.body?.planKey ?? req.body?.planId;
    if (typeof plan !== "string" || plan.trim().length < 1 || plan.trim().length > 64) {
      throw new Error("Plan ID is invalid");
    }
    return true;
  }),
  billingPeriodValidation(),
  platformValidation()
];
const verifyRecurringSubscriptionValidation = [
  providerIdValidation("razorpay_subscription_id"),
  providerIdValidation("razorpay_payment_id"),
  signatureValidation(),
  platformValidation()
];
const createBoostOrderValidation = [
  body("postId").isString().isMongoId().withMessage("Invalid post identifier"),
  body("frequency").isString().isIn(["daily", "weekly", "monthly"]).withMessage("Invalid boost frequency"),
  body("amount").optional().isFloat({ min: 0, max: 10_000_000 }).withMessage("Invalid boost amount"),
  body("targetReach").optional().isInt({ min: 1, max: 100_000_000 }).withMessage("Invalid target reach"),
  body("targetPlayers").optional().isBoolean().withMessage("targetPlayers must be boolean"),
  body("targetTeams").optional().isBoolean().withMessage("targetTeams must be boolean")
];
const verifyBoostPaymentValidation = [
  providerIdValidation("razorpay_order_id"),
  providerIdValidation("razorpay_payment_id"),
  signatureValidation(),
  body("postId").optional().isString().isMongoId().withMessage("Invalid post identifier")
];

router.post("/razorpay/webhook", webhookLimiter, premiumWebhookController.handleRazorpayWebhook);

router.get("/history", protect, paymentController.getPaymentHistory);

// Subscription payment routes
router.post("/subscription/create-order", protect, customerCreateLimiter, createSubscriptionOrderValidation, handleValidationErrors, paymentController.createOrder);
router.post("/subscription/verify", protect, customerPaymentLimiter, verifyOneTimePaymentValidation, handleValidationErrors, paymentController.verifyPayment);
router.post("/subscription/create", protect, customerCreateLimiter, createRecurringSubscriptionValidation, handleValidationErrors, paymentController.createRecurringPremiumSubscription);
router.post("/subscription/verify-recurring", protect, customerPaymentLimiter, verifyRecurringSubscriptionValidation, handleValidationErrors, paymentController.verifyRecurringPremiumSubscription);

// Tournament payment routes
router.post("/tournament/create-order", protect, customerCreateLimiter, paymentController.createTournamentOrder);
router.post("/tournament/verify", protect, customerPaymentLimiter, paymentController.verifyTournamentPayment);

// Boost payment routes
router.get("/boost/campaigns", protect, paymentController.getBoostCampaigns);
router.post("/boost/create-order", protect, customerCreateLimiter, createBoostOrderValidation, handleValidationErrors, paymentController.createBoostOrder);
router.post("/boost/verify", protect, customerPaymentLimiter, verifyBoostPaymentValidation, handleValidationErrors, paymentController.verifyBoostPayment);

export default router;

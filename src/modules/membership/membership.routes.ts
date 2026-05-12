import { Router } from "express";
import { membershipController, paymentController, protect } from "./membership.legacy-adapters";

const router = Router();

router.get("/plans", membershipController.getPlans);       // public – list all plans
router.get("/", protect, membershipController.getMembership);
router.post("/payment/create-order", protect, paymentController.createOrder);
router.post("/payment/verify", protect, paymentController.verifyPayment);
router.post("/cancel", protect, paymentController.cancelSubscription);

export default router;

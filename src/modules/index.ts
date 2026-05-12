import type { Express } from "express";
import chatRoutes from "./chat/chat.routes";
import healthRoutes from "./health/health.routes";
import { registerLegacyMiddleware } from "./legacy/legacy.middleware";
import { registerLegacyRoutes } from "./legacy/legacy.routes";
import authRoutes from "./auth/auth.routes";
import usersRoutes from "./users/users.routes";
import messagesRoutes from "./messages/messages.routes";
import notificationsRoutes from "./notifications/notifications.routes";
import postsRoutes from "./posts/posts.routes";
import tournamentsRoutes from "./tournaments/tournaments.routes";
import scrimsRoutes from "./scrims/scrims.routes";
import recruitmentRoutes from "./recruitment/recruitment.routes";
import challengesRoutes from "./challenges/challenges.routes";
import adminRoutes from "./admin/admin.routes";
import leaveRequestsRoutes from "./leave-requests/leave-requests.routes";
import randomConnectionsRoutes from "./random-connections/random-connections.routes";
import monetizationRoutes from "./monetization/monetization.routes";
import feedbackRoutes from "./feedback/feedback.routes";
import reportsRoutes from "./reports/reports.routes";
import aiCoachRoutes from "./ai-coach/ai-coach.routes";
import aiRecruitmentRoutes from "./ai-recruitment/ai-recruitment.routes";
import knowledgeRoutes from "./knowledge/knowledge.routes";
import membershipRoutes from "./membership/membership.routes";
import musicRoutes from "./music/music.routes";
import storiesRoutes from "./stories/stories.routes";
import paymentsRoutes from "./payments/payments.routes";
import hostVerificationRoutes from "./host-verification/host-verification.routes";
import callsRoutes from "./calls/calls.routes";

export const registerModules = (app: Express): void => {
  registerLegacyMiddleware(app);

  // Core modules (already migrated)
  app.use("/api/auth", authRoutes);
  app.use("/api/users", usersRoutes);
  app.use("/api/messages", messagesRoutes);
  app.use("/api/notifications", notificationsRoutes);
  app.use("/api/posts", postsRoutes);
  app.use("/api/tournaments", tournamentsRoutes);
  app.use("/api/scrims", scrimsRoutes);
  app.use("/api/recruitment", recruitmentRoutes);
  app.use("/api/challenges", challengesRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/health", healthRoutes);
  app.use("/api/chat", chatRoutes);

  // Newly migrated modules (previously loaded from legacy routes)
  app.use("/api/leave-requests", leaveRequestsRoutes);
  app.use("/api/random-connections", randomConnectionsRoutes);
  app.use("/api/monetization", monetizationRoutes);
  app.use("/api/feedback", feedbackRoutes);
  app.use("/api/reports", reportsRoutes);
  app.use("/api/ai-coach", aiCoachRoutes);
  app.use("/api/ai-recruitment", aiRecruitmentRoutes);
  app.use("/api/knowledge", knowledgeRoutes);
  app.use("/api/membership", membershipRoutes);
  app.use("/api/music", musicRoutes);
  app.use("/api/stories", storiesRoutes);
  app.use("/api/payments", paymentsRoutes);
  app.use("/api/host-verification", hostVerificationRoutes);
  app.use("/api/calls", callsRoutes);

  // Legacy: passport init + static uploads
  registerLegacyRoutes(app);
};

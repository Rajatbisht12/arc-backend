import assert from "node:assert/strict";
import type { Request, Response } from "express";
import aiCoachRouter from "./ai-coach/ai-coach.routes";
import aiRecruitmentRouter from "./ai-recruitment/ai-recruitment.routes";
import adminRouter, { rejectStructuredAdminQuery } from "./admin/admin.routes";
import broadcastRouter from "./admin/broadcast.routes";
import broadcastTemplateRouter from "./admin/broadcast-template.routes";
import premiumMembershipRouter from "./admin/premium-membership.routes";
import authRouter from "./auth/auth.routes";
import challengesRouter from "./challenges/challenges.routes";
import hostVerificationRouter from "./host-verification/host-verification.routes";
import leaveRequestsRouter from "./leave-requests/leave-requests.routes";
import messagesRouter from "./messages/messages.routes";
import postsRouter from "./posts/posts.routes";
import paymentsRouter from "./payments/payments.routes";
import randomConnectionsRouter from "./random-connections/random-connections.routes";
import reportsRouter from "./reports/reports.routes";
import storiesRouter from "./stories/stories.routes";
import tournamentsRouter from "./tournaments/tournaments.routes";
import usersRouter from "./users/users.routes";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const callsRouter = require("../legacy-src/routes/calls.js");

type RouterLayer = {
  route?: {
    path?: string;
    methods?: Record<string, boolean>;
    stack?: Array<{ handle?: { name?: string; resetKey?: unknown; getKey?: unknown } }>;
  };
};

const routeStack = (router: unknown, method: string, path: string): NonNullable<NonNullable<RouterLayer["route"]>["stack"]> => {
  const stack = (router as { stack?: RouterLayer[] }).stack || [];
  const layer = stack.find((candidate) => (
    candidate.route?.path === path && candidate.route?.methods?.[method.toLowerCase()] === true
  ));
  assert.ok(layer, `${method.toUpperCase()} ${path} must be registered`);
  return layer.route?.stack || [];
};

const routeHandlers = (router: unknown, method: string, path: string): string[] => {
  return routeStack(router, method, path).map((entry) => entry.handle?.name || "");
};

const assertValidationTerminal = (router: unknown, method: string, path: string): void => {
  const handlers = routeHandlers(router, method, path);
  const validationIndex = handlers.indexOf("handleValidationErrors");
  assert.ok(validationIndex >= 0, `${method.toUpperCase()} ${path} must terminate express-validator chains`);
  assert.ok(validationIndex < handlers.length - 1, `${method.toUpperCase()} ${path} validation must run before its controller`);
};

const assertRateLimited = (router: unknown, method: string, path: string): void => {
  const stack = routeStack(router, method, path);
  assert.ok(
    stack.some((entry) => (
      typeof entry.handle?.resetKey === "function" && typeof entry.handle?.getKey === "function"
    )),
    `${method.toUpperCase()} ${path} must be rate limited`
  );
};

const responseRecorder = () => ({
  statusCode: 200,
  body: undefined as unknown,
  status(code: number) {
    this.statusCode = code;
    return this;
  },
  json(body: unknown) {
    this.body = body;
    return this;
  }
});

const paramHandler = (router: unknown, name: string) => {
  const handlers = (router as { params?: Record<string, Array<(...args: any[]) => unknown>> }).params?.[name] || [];
  assert.ok(handlers.length > 0, `Router must register a validator for :${name}`);
  return handlers[0];
};

const assertObjectIdParamGuard = (router: unknown, name: string): void => {
  const handler = paramHandler(router, name);
  const rejected = responseRecorder();
  let nextCalls = 0;
  handler({ method: "POST", path: "/bad" }, rejected, () => { nextCalls += 1; }, "not-an-object-id", name);
  assert.equal(rejected.statusCode, 400, `:${name} must reject malformed ObjectIds`);
  assert.equal(nextCalls, 0);

  const accepted = responseRecorder();
  handler({ method: "POST", path: "/507f1f77bcf86cd799439011" }, accepted, () => { nextCalls += 1; }, "507f1f77bcf86cd799439011", name);
  assert.equal(nextCalls, 1, `:${name} must accept valid ObjectIds`);
};

const run = (): void => {
  {
    const response = responseRecorder();
    let nextCalls = 0;
    rejectStructuredAdminQuery(
      { query: { status: { $ne: "cancelled" } } } as unknown as Request,
      response as unknown as Response,
      () => { nextCalls += 1; }
    );
    assert.equal(response.statusCode, 400);
    assert.equal(nextCalls, 0);
  }
  [
    ["post", "/register"],
    ["post", "/login"],
    ["get", "/check-username"],
    ["get", "/check-email"],
    ["post", "/send-otp"],
    ["post", "/verify-otp-register"],
    ["post", "/verify-otp-login"],
    ["post", "/reset-password-otp"],
    ["post", "/check-password-same"],
    ["post", "/google/token"],
    ["post", "/apple/mobile"],
    ["put", "/profile"],
    ["put", "/change-password"],
    ["delete", "/account"]
  ].forEach(([method, path]) => assertValidationTerminal(authRouter, method, path));

  const passwordRoute = routeHandlers(authRouter, "post", "/check-password-same");
  assert.ok(passwordRoute.includes("protect"), "password comparison must require authentication");
  assert.ok(
    passwordRoute.indexOf("protect") < passwordRoute.indexOf("checkPasswordSame"),
    "authentication must run before password comparison"
  );
  [
    ["get", "/check-username"],
    ["get", "/check-email"],
    ["post", "/guest-token"],
    ["post", "/google/token"],
    ["post", "/apple/mobile"]
  ].forEach(([method, path]) => assertRateLimited(authRouter, method, path));

  [
    ["post", "/direct"],
    ["post", "/rooms"],
    ["post", "/rooms/:chatRoomId/invite-dm"],
    ["put", "/rooms/:chatRoomId"],
    ["post", "/rooms/:chatRoomId/members"],
    ["put", "/rooms/:chatRoomId/members/:memberId/role"],
    ["post", "/group"],
    ["post", "/mark-read"],
    ["post", "/call-summary"],
    ["get", "/direct/:userId"],
    ["delete", "/direct/:userId"],
    ["get", "/rooms/:chatRoomId"],
    ["delete", "/rooms/:chatRoomId"],
    ["delete", "/rooms/:chatRoomId/members/:memberId"],
    ["post", "/:messageId/reaction"],
    ["post", "/:messageId/invite-response"],
    ["post", "/report"],
    ["get", "/join/:inviteToken/preview"],
    ["post", "/join/:inviteToken"]
  ].forEach(([method, path]) => assertValidationTerminal(messagesRouter, method, path));
  assertRateLimited(messagesRouter, "get", "/join/:inviteToken/preview");

  [
    ["post", "/:teamId/roster/add"],
    ["post", "/:teamId/staff/add"],
    ["post", "/:teamId/staff/add-by-username"],
    ["delete", "/:teamId/staff/cancel-by-username"],
    ["get", "/:teamId/pending-invites"],
    ["delete", "/roster-invite/:inviteId"],
    ["post", "/roster-invites/:inviteId/accept"],
    ["post", "/roster-invites/:inviteId/decline"],
    ["delete", "/staff-invite/:inviteId"]
  ].forEach(([method, path]) => assertValidationTerminal(usersRouter, method, path));

  [
    ["get", "/:id"],
    ["post", "/:id/view"],
    ["post", "/:id/like"],
    ["post", "/:id/comment"],
    ["post", "/:id/share"],
    ["post", "/:id/save"],
    ["put", "/:id"],
    ["delete", "/:id"],
    ["post", "/:id/report"],
    ["post", "/:id/boost"]
  ].forEach(([method, path]) => assertValidationTerminal(postsRouter, method, path));

  [
    ["get", "/user/:userId"],
    ["get", "/:storyId"],
    ["post", "/:storyId/view"],
    ["get", "/:storyId/views"],
    ["delete", "/:storyId"]
  ].forEach(([method, path]) => assertValidationTerminal(storiesRouter, method, path));

  [
    ["post", "/"],
    ["get", "/:id"],
    ["post", "/:id/join"],
    ["put", "/:id/progress"],
    ["put", "/:id"],
    ["delete", "/:id"],
    ["post", "/:id/distribute-rewards"]
  ].forEach(([method, path]) => assertValidationTerminal(challengesRouter, method, path));

  [
    ["post", "/join-queue"],
    ["post", "/disconnect"],
    ["post", "/next"],
    ["post", "/send-message"],
    ["post", "/v2/join-queue"],
    ["post", "/v2/disconnect"]
  ].forEach(([method, path]) => assertValidationTerminal(randomConnectionsRouter, method, path));

  assertValidationTerminal(reportsRouter, "post", "/");
  assertValidationTerminal(hostVerificationRouter, "post", "/apply");
  [
    ["post", "/multiple"],
    ["post", "/rate"],
    ["get", "/conversation/:conversationId"],
    ["put", "/conversation/:conversationId/rename"],
    ["delete", "/conversation/:conversationId"]
  ].forEach(([method, path]) => assertValidationTerminal(aiCoachRouter, method, path));
  [
    ["post", "/smart-search"],
    ["post", "/match-players"],
    ["post", "/analyze-application"],
    ["post", "/rank-candidates"]
  ].forEach(([method, path]) => assertValidationTerminal(aiRecruitmentRouter, method, path));
  [
    ["post", "/team/:teamId/leave-request"],
    ["get", "/team/:teamId/leave-requests"],
    ["patch", "/team/:teamId/leave-request/:requestId"],
    ["delete", "/team/:teamId/leave-request/:requestId"]
  ].forEach(([method, path]) => assertValidationTerminal(leaveRequestsRouter, method, path));
  [
    ["post", "/token"],
    ["post", "/initiate"],
    ["post", "/accept"],
    ["post", "/reject"],
    ["post", "/end"],
    ["get", "/sessions/:callId"],
    ["post", "/sessions/:callId/accept"],
    ["post", "/sessions/:callId/decline"],
    ["post", "/sessions/:callId/end"],
    ["post", "/group-token"]
  ].forEach(([method, path]) => assertValidationTerminal(callsRouter, method, path));
  [
    ["post", "/subscription/create-order"],
    ["post", "/subscription/verify"],
    ["post", "/subscription/create"],
    ["post", "/subscription/verify-recurring"],
    ["post", "/boost/create-order"],
    ["post", "/boost/verify"]
  ].forEach(([method, path]) => assertValidationTerminal(paymentsRouter, method, path));

  ["userId", "postId", "tournamentId", "reportId", "campaignId", "applicationId", "id"]
    .forEach((name) => assertObjectIdParamGuard(adminRouter, name));
  assertObjectIdParamGuard(broadcastRouter, "id");
  assertObjectIdParamGuard(broadcastTemplateRouter, "id");
  assertObjectIdParamGuard(premiumMembershipRouter, "id");
  assertObjectIdParamGuard(tournamentsRouter, "id");

  const publicTournamentLookup = responseRecorder();
  let publicLookupNextCalls = 0;
  paramHandler(tournamentsRouter, "id")(
    { method: "GET", path: "/TRN-BGM-A1B2C3D4" },
    publicTournamentLookup,
    () => { publicLookupNextCalls += 1; },
    "TRN-BGM-A1B2C3D4",
    "id"
  );
  assert.equal(publicLookupNextCalls, 1, "Public tournament detail must continue accepting share codes");

  const shortGameTournamentLookup = responseRecorder();
  paramHandler(tournamentsRouter, "id")(
    { method: "GET", path: "/TRN-FF-A1B2C3D4" },
    shortGameTournamentLookup,
    () => { publicLookupNextCalls += 1; },
    "TRN-FF-A1B2C3D4",
    "id"
  );
  assert.equal(publicLookupNextCalls, 2, "Two-letter game tournament codes must remain valid");

  const malformedPublicLookup = responseRecorder();
  paramHandler(tournamentsRouter, "id")(
    { method: "GET", path: "/not-a-code" },
    malformedPublicLookup,
    () => { publicLookupNextCalls += 1; },
    "not-a-code",
    "id"
  );
  assert.equal(malformedPublicLookup.statusCode, 400);
  assert.equal(publicLookupNextCalls, 2, "Malformed public detail identifiers must not bypass validation");

  console.log("Mounted API validation and password-oracle route contracts passed");
};

run();

import assert from "node:assert/strict";
import usersRouter from "./users.routes";

type RouteLayer = {
  route?: {
    path?: string;
    methods?: Record<string, boolean>;
    stack?: Array<{ handle: (...args: any[]) => unknown }>;
  };
};

const routeStack = (method: string, path: string) => {
  const layer = ((usersRouter as unknown as { stack: RouteLayer[] }).stack || []).find((candidate) => (
    candidate.route?.path === path && candidate.route?.methods?.[method] === true
  ));
  assert.ok(layer?.route?.stack, `${method.toUpperCase()} ${path} must exist`);
  return layer.route.stack;
};

const validate = async (
  method: string,
  path: string,
  { params = {}, body = {} }: { params?: Record<string, unknown>; body?: Record<string, unknown> }
) => {
  const stack = routeStack(method, path);
  // Authentication is first and the controller is last. Exercise every route
  // validator plus the shared validation terminal between those boundaries.
  const handlers = stack.slice(1, -1).map((entry) => entry.handle);
  const request = { method: method.toUpperCase(), path, params, body, query: {}, headers: {} };
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(value: unknown) { this.body = value; return this; }
  };

  for (const handler of handlers) {
    let continued = false;
    await Promise.resolve(handler(request, response, () => { continued = true; }));
    if (!continued) break;
  }
  return response;
};

const run = async () => {
  const baseParams = { teamId: "507f1f77bcf86cd799439011" };
  const baseRoster = {
    playerId: "507f1f77bcf86cd799439012",
    game: "BGMI"
  };

  assert.equal((await validate("post", "/:teamId/roster/add", {
    params: baseParams,
    body: { ...baseRoster, role: "x".repeat(40) }
  })).statusCode, 200, "40-character custom role must pass");

  assert.equal((await validate("post", "/:teamId/roster/add", {
    params: baseParams,
    body: { ...baseRoster, role: "x".repeat(41) }
  })).statusCode, 400, "41-character custom role must fail");

  assert.equal((await validate("post", "/:teamId/roster/add", {
    params: baseParams,
    body: { ...baseRoster, role: "__custom__" }
  })).statusCode, 400, "client custom-role sentinel must never be persisted");

  assert.equal((await validate("post", "/:teamId/roster/add", {
    params: baseParams,
    body: { ...baseRoster, role: "Coach\nOwner" }
  })).statusCode, 400, "control characters must fail before role normalization");

  assert.equal((await validate("post", "/:teamId/staff/add", {
    params: { teamId: "contract_team" },
    body: { memberId: baseRoster.playerId, role: "Head Coach" }
  })).statusCode, 200, "static staff roles and legacy username team identifiers must pass");

  assert.equal((await validate("post", "/:teamId/staff/add", {
    params: baseParams,
    body: { memberId: "not-an-id", role: "Coach" }
  })).statusCode, 400, "malformed member ids must fail before the controller");

  assert.equal((await validate("post", "/roster-invites/:inviteId/accept", {
    params: { inviteId: "not-an-id" }
  })).statusCode, 400, "malformed invite ids must fail before the controller");

  console.log("Team invitation route validation tests passed");
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage } from "node:http";
import {
  CLOUDFLARE_ORIGIN_AUTH_HEADER,
  createCloudflareOriginAuthMiddleware,
  hasValidCloudflareOriginAuth,
  isOriginAuthHealthPath
} from "../../infrastructure/security/cloudflareOrigin";
import { getSocketClientIp, SocketConnectionGuard } from "../../infrastructure/security/socketConnectionGuard";

const secret = "a-production-length-origin-secret-value";

test("origin authentication compares a sufficiently long credential", () => {
  assert.equal(hasValidCloudflareOriginAuth(secret, secret), true);
  assert.equal(hasValidCloudflareOriginAuth(secret, "wrong"), false);
  assert.equal(hasValidCloudflareOriginAuth("short", "short"), false);
});

test("health checks remain available outside the Cloudflare path", () => {
  assert.equal(isOriginAuthHealthPath("/health"), true);
  assert.equal(isOriginAuthHealthPath("/api/health"), true);
  assert.equal(isOriginAuthHealthPath("/api/posts"), false);
});

test("observe mode strips the credential but does not reject", () => {
  const req = {
    path: "/api/posts",
    method: "GET",
    headers: { [CLOUDFLARE_ORIGIN_AUTH_HEADER]: secret }
  } as never;
  const res = { locals: {} } as never;
  let nextCalled = false;
  const middleware = createCloudflareOriginAuthMiddleware({ mode: "observe", secret, logger: { warn: () => undefined } });
  middleware(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal((req as { headers: Record<string, string> }).headers[CLOUDFLARE_ORIGIN_AUTH_HEADER], undefined);
});

test("enforce mode rejects requests without the edge credential", () => {
  const req = { path: "/api/posts", method: "GET", headers: {} } as never;
  let statusCode = 0;
  let payload: unknown;
  const res = {
    locals: {},
    status(code: number) { statusCode = code; return this; },
    json(body: unknown) { payload = body; return this; }
  } as never;
  let nextCalled = false;
  const middleware = createCloudflareOriginAuthMiddleware({ mode: "enforce", secret, logger: { warn: () => undefined } });
  middleware(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(statusCode, 403);
  assert.deepEqual(payload, { success: false, message: "Forbidden" });
});

test("socket IP resolution trusts CF-Connecting-IP only with origin authentication", () => {
  const trusted = {
    headers: {
      [CLOUDFLARE_ORIGIN_AUTH_HEADER]: secret,
      "cf-connecting-ip": "203.0.113.9",
      "x-forwarded-for": "203.0.113.9, 198.51.100.2"
    },
    socket: { remoteAddress: "10.0.0.5" }
  } as unknown as IncomingMessage;
  assert.equal(getSocketClientIp(trusted, secret), "203.0.113.9");

  const untrusted = {
    headers: {
      [CLOUDFLARE_ORIGIN_AUTH_HEADER]: "spoofed",
      "cf-connecting-ip": "192.0.2.10",
      "x-forwarded-for": "192.0.2.20, 198.51.100.7"
    },
    socket: { remoteAddress: "10.0.0.5" }
  } as unknown as IncomingMessage;
  assert.equal(getSocketClientIp(untrusted, secret), "198.51.100.7");
});

test("socket fallback limiter rejects only after the configured burst", async () => {
  const redis = { isReady: false, multi: () => { throw new Error("not used"); } };
  const guard = new SocketConnectionGuard({ redis, windowSeconds: 10, maxConnectionsPerWindow: 2 });
  const request = { headers: {}, socket: { remoteAddress: "203.0.113.11" } } as unknown as IncomingMessage;
  assert.equal(await guard.allow(request), true);
  assert.equal(await guard.allow(request), true);
  assert.equal(await guard.allow(request), false);
});

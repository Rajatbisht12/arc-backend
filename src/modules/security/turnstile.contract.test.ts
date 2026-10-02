import assert from "node:assert/strict";
import { isProtectedWebAuthRequest, isValidTurnstileResult } from "../../infrastructure/security/turnstile";

const request = (origin?: string) => ({ get: (name: string) => name === "origin" ? origin : undefined });

assert.equal(isProtectedWebAuthRequest(request("https://www.squadhunt.com") as never), true);
assert.equal(isProtectedWebAuthRequest(request("https://squadhunt.com") as never), true);
assert.equal(isProtectedWebAuthRequest(request(undefined) as never), false, "native clients must not be challenged");
assert.equal(isProtectedWebAuthRequest(request("https://attacker.example") as never), false);

const hosts = new Set(["squadhunt.com", "www.squadhunt.com"]);
assert.equal(isValidTurnstileResult({ success: true, hostname: "www.squadhunt.com", action: "web_auth" }, "web_auth", hosts), true);
assert.equal(isValidTurnstileResult({ success: true, hostname: "www.squadhunt.com", action: "wrong" }, "web_auth", hosts), false);
assert.equal(isValidTurnstileResult({ success: true, hostname: "attacker.example", action: "web_auth" }, "web_auth", hosts), false);
assert.equal(isValidTurnstileResult({ success: false, hostname: "www.squadhunt.com", action: "web_auth" }, "web_auth", hosts), false);

console.log("Turnstile Web-only authentication contracts passed");

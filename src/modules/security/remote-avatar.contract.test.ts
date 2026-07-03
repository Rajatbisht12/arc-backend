import assert from "node:assert/strict";
import { parseAllowedRemoteAvatarUrl } from "../../infrastructure/storage/s3";

assert.ok(parseAllowedRemoteAvatarUrl("https://lh3.googleusercontent.com/avatar.png"));
assert.ok(parseAllowedRemoteAvatarUrl("https://res.cloudinary.com/demo/avatar.png"));
assert.equal(parseAllowedRemoteAvatarUrl("http://169.254.169.254/latest/meta-data"), null);
assert.equal(parseAllowedRemoteAvatarUrl("https://googleusercontent.com.evil.example/avatar.png"), null);
assert.equal(parseAllowedRemoteAvatarUrl("https://user:password@lh3.googleusercontent.com/avatar.png"), null);
assert.equal(parseAllowedRemoteAvatarUrl("https://localhost/avatar.png"), null);

console.log("Remote avatar SSRF policy contracts passed");

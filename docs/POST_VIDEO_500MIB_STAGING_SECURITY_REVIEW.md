# Staging dependency and media-security review — 2026-10-20

Scope: local backend lockfile at base `8a7d68a2bdd85e29e450e0bc3486921aaf3fe065` plus staging-only preparation changes. No dependency upgrade, production deployment or security-policy activation was performed. `npm audit --omit=dev --json` again reports **17 affected production dependency entries: 6 moderate, 10 high, 1 critical**. These are dependency entries, not 17 independently demonstrated exploits. None of the newly added staging helpers introduces an npm dependency.

## Triage and safe remediation order

| Dependency (installed) | Audit severity / relationship | Actual usage / applicability | Suggested remediation and required tests |
| --- | --- | --- | --- |
| `compression` 1.8.1 | High, direct | Global `app.use(compression())` in `src/app.ts`; premature-close response DoS surface is reachable. No exploit/load test against production. | Patch 1.8.2; disconnect/stream/manifest responses and existing HTTP suite. |
| `engine.io` 6.6.6 | High, Socket.IO transitive | Network transport exposed by server; polling/upgrade paths precede some application event authorization. | Resolve >=6.6.10 with compatible Socket.IO updates; websocket and polling auth, calls, reconnect, Random Connect. |
| `socket.io-parser` 4.2.6 | High, transitive | Socket.IO packet decoding is in the network path. Zero-attachment exhaustion advisory is not mitigated merely by call-event ownership checks. | >=4.2.7; malformed packet, authentication and call-signaling regression tests. |
| `ws` 8.18.3 | High, transitive | Engine.IO / adapter websocket dependencies; installed in runtime, not dev-only. | >=8.21.0; upgrade/fragment/disconnect tests and cross-instance adapter behavior. |
| `socket.io-adapter` 2.5.6 | Moderate, transitive | Audit entry inherits `ws` finding; do not count as a separately reproduced exploit. | Resolve patched `ws` throughout lockfile; realtime producer and membership/privacy suites. |
| `multer` 2.1.1 | High, direct | Real authenticated legacy upload middleware uses memory storage and synchronous `fileFilter` in `src/legacy-src/middleware/upload.js`. Multipart resource-exhaustion advisories remain relevant to authenticated malicious accounts. The async-filter-specific condition is not established for this synchronous filter. | Registry currently 2.4.0 (advisory ranges include <2.3.0); use reviewed compatible patch, exact 50 MiB/+1 boundaries, multipart nested fields, rejection and cleanup tests. Do not increase legacy limits. |
| `sharp` 0.34.5 | High, direct/native | Untrusted image bytes processed in `src/infrastructure/storage/s3.ts` (`sharp(file.buffer)`); libvips/libheif/librsvg decoder exposure warrants priority. | 0.35.5 currently offered; 0.x minor/native binary change needs Node 22/alpine linux-amd64 build, image-format/rotation/resource limits and deployment smoke tests, not an unreviewed lock bump. |
| `proxy-addr` 2.0.7 | **Critical**, Express transitive | Specific mapped-IPv6 **CIDR trust-list** trigger is not used by SquadHunt's numeric-hop configuration; see dedicated evidence below. Not a blanket false-positive declaration. | >=2.0.8 via compatible parent/lock refresh; forwarded IP, limiter, numeric hop and ALB proxy-chain tests. |
| `ip-address` 10.1.0 | High, rate-limiter transitive | Address parsing participates in request identity handling; malformed IPv6/address input is an external boundary. Exact advisory exploitability not reproduced. | Resolve a version newer than the listed <=10.7.0 ranges with a compatible `express-rate-limit` update; IPv4/IPv6/XFF limits and invalid addresses. |
| `express-rate-limit` 8.4.1 | Moderate, direct | Audit wrapper entry for `ip-address`, not a distinct demonstrated issue. | Upgrade compatible parent/lock, preserving progressive auth rate limits and proxy trust. |
| `axios` 1.15.2 | High, direct | Real outbound game/search HTTP clients under `src/legacy-src/utils`. Many advisories require inherited polluted configuration, HTTP/2, proxy/NO_PROXY or untrusted redirects. Not every advisory applies to every fixed-host request; outbound code still requires patching. | Current registry 1.20.0 covers listed <1.20.0 ranges. Test game/search APIs with HTTP fixtures, timeout/body limits, redirects/proxies, blocked internal URL paths. |
| `form-data` 4.0.5 | High, Axios transitive | Outbound multipart construction only where used; not evidence that the incoming upload engine uses it. | >=4.0.6 through compatible parent resolution; outbound multipart fixtures and boundary/header tests. |
| `body-parser` 1.20.5 | Moderate, Express transitive | JSON/urlencoded input parsing is active. The invalid-configured-limit advisory condition must be distinguished from ordinary valid configured limits. | >=1.20.6; request-size and parser error tests; preserve existing request limits. |
| `qs` 6.14.2 | Moderate, transitive | Query/urlencoded parsing; untrusted nested keys remain an input boundary. | >=6.16.0 in all runtime paths; deep input, prototype keys, size/depth rejection and existing route parsing tests. |
| `mongoose` 8.23.1 | Moderate, direct | Controllers/services perform database updates; casting/prototype-pollution advisory needs update payload review, not merely version presence. | >=8.24.1 within 8.x; owner allowlists, privacy, publication indexes, recommendations, actual staging DocDB migration apply/reapply. |
| `morgan` 1.10.1 | Moderate, direct | Production `combined` logger in `src/app.ts` consumes request-derived URL/header values. Log-control-character advisories are applicable to logging boundaries. | >=1.12.1; log injection/sanitization tests and no credentials/signed grant leakage. |
| `nodemailer` 8.0.6 | High, direct | `src/legacy-src/utils/email.js` builds server email through `sendMail`; individual attachment/envelope/raw-message conditions need separate review. It is not dev-only. | Registry 10.1.7 is a **major** upgrade. Separate reviewed email change, template escaping, SMTP fixtures, injection/addresses, OTP and all notification-policy tests; not `audit fix --force`. |

First separate security update batch: global HTTP/transport parsers and compatible transitive patches. Second: native image stack and Axios/Mongoose. Third: major email transition with SMTP contract tests. Re-run audit after each lockfile change, inspect `npm ls` for duplicate vulnerable nested copies, build the actual linux-amd64 image and run the same compatibility/regression gates before a separately approved production deployment. Prioritization does not excuse the remaining high findings or constitute production activation approval.

## Critical `proxy-addr` finding, reverified

Primary advisory: [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h), patched 2.0.8. It concerns mapped-IPv6 trust subnet matching.

`src/config/env.ts` defines `TRUST_PROXY_HOPS` as a coerced integer with minimum 1, maximum 2 and default 1. `src/app.ts` passes that number directly to Express `app.set('trust proxy', env.TRUST_PROXY_HOPS)`. No CIDR-list environment option was found in this path. A local runtime check wrapped `proxy-addr.compile`, initialized Express, reset the counter, then applied numeric values 1 and 2: **zero CIDR compile calls**; trust callback accepted hop 0 and rejected the boundary hop as expected. Express's own initial default setup calls compile with an empty list; that is not the vulnerable supplied CIDR policy.

Conclusion: the advisory's documented CIDR trigger is **not established in this application path**. Continue to patch the transitive library; do not downgrade the advisory globally or claim arbitrary proxy deployments safe. Numeric-hop trust also requires that the actual ingress path has exactly the intended trusted proxy count. Staging CloudFront + ALB is a different path from production; validate spoofed XFF and effective client IP before relying on per-IP abuse limits. No production trust setting was changed.

## Native licensing inventory (informational, not legal approval)

The lock metadata for non-dev package entries contains MIT/Apache/BSD/ISC and LGPL-bearing `@img/sharp-libvips-*` packages across optional platforms. Four entries have missing lockfile license metadata: `busboy`, `passport-strategy`, `pause`, `streamsearch`. Missing metadata is not proof of missing/forbidden licensing; inspect package LICENSE files/distribution notices. Optional entries in a lock are not all installed on the production architecture. FFmpeg itself is an OS package in the Dockerfile, outside npm audit and this metadata count; inspect the actual container SBOM/FFmpeg build options and retain applicable notices. No blanket claim that LGPL makes server use prohibited is made.

## Private-media security gate

`src/legacy-src/utils/postVideoDelivery.js` uses a 15-minute grant issuance bucket and an expiry one hour beyond that bucket: actual remaining lifetime is approximately 45–60 minutes. API manifest authorization can reject a newly blocked/deleted/private viewer immediately, while previously signed child segment/MP4 URLs are bearer grants until expiry. A 24-hour cleanup grace is storage safety, not revocation. Actual CloudFront enforcement, signed/unsigned range/CORS responses and browser refresh behavior require the new staging distribution; code tests alone do not certify them.

Do not approve the one-hour privacy window implicitly. A 5-minute renewable grant option needs Web/native refresh during long playback, background/foreground and expired range requests. Stronger edge/session revocation would add operational state and cost. Neither change has been mixed into production or the staging isolation fix without a policy decision.

The new staging media template has no unrestricted default behavior: every CloudFront request requires the stage key group, S3 public access is blocked, OAC can read only playback, and source-prefix delivery is explicitly denied. Template validation proves syntax, not actual enforcement. Stage resource IAM denies production secret/S3 access; database/cache network and exact task bindings independently prevent accidental production reuse.

## Executed staging evidence (20 October, India time)

The explicitly approved new distribution was exercised against real S3 objects:
unsigned playback 403, expired signed playback 403, signed MP4 range 206 with
the requested 1,024 bytes, signed thumbnail 200, unsigned S3 source 403, and
even a valid CloudFront signature on the source prefix 403. Allowlisted local
Web origin receives CORS headers; production Web origin does not. CORS is not
authorization: a denied browser origin can still receive HTTP 206 without an
allow-origin header. Do not describe that as server-side authorization denial.

The real staging API additionally returned 403 for non-followers of a
followers-only post, 200 for an accepted follower, 200 for the private post's
owner, 403 for a follower of an owner-only post, and 403 for a blocked viewer.
After privacy changed, a previously issued viewer HLS manifest returned 403;
after deleting the controlled synthetic post, detail returned 404 and the old
manifest 403. **The already-issued MP4 grant still returned 206 after the
privacy change.** This confirms the documented revocation limitation, not a
pass for immediate asset revocation. Production activation remains blocked
on explicit policy approval or a separately tested shorter-grant/revocation
implementation. No production grant lifetime was changed.

### Access-log grant leak fixed in candidate code

Inspection confirmed the previous `morgan("combined")` format records the
full request URL, including the new manifest bearer token. The focused fix in
`src/infrastructure/security/accessLog.ts`, wired by `src/app.ts`, strips all
query/fragment values from request URLs and referrers and strips raw control
characters. It does not mutate request URLs, suppress failures, or change
authentication/signature verification. Two focused tests plus the compiled
compatibility smoke passed. Staging API revision 3 uses the rebuilt immutable
image `sha256:a07eb6d28947bae108c90a0323127bd27496e447cb1fa08e2d6027cea32559dc`;
actual playback requests in its access logs were verified redacted. Earlier
disposable staging logs must be treated as containing live test grants until
expiry and removed during approved cleanup. No production log was modified.

Dependency upgrades remain a separate reviewed change. The log-format fix
does not claim to resolve all Morgan advisories or the other audit entries.

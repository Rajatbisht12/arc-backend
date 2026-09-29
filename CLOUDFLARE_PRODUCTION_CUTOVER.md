# Cloudflare production cutover runbook

This runbook deliberately separates preparation from activation. A Cloudflare zone or rule does not protect production until the registrar delegates the zone to Cloudflare and the relevant record is proxied.

## Current prepared state

- `squadhunt.com` and `squadhunt.in` exist in Cloudflare as pending Free-plan zones.
- Imported DNS records are DNS-only. Hostinger remains authoritative.
- Full (strict), minimum TLS 1.2, TLS 1.3, HTTP/2, HTTP/3, WebSockets, and Always Use HTTPS are prepared.
- The Cloudflare Free Managed Ruleset, two low-risk custom block rules, an authentication rate limit, and API/Socket.IO cache bypass are prepared.
- HSTS preload, Bot Fight Mode, Turnstile, DNSSEC, authenticated origin pulls, and origin enforcement are intentionally not enabled.
- CloudFront remains the media CDN. TURN/STUN must remain direct and DNS-only.

## Hard gates

Do not switch nameservers or proxy a hostname until every applicable gate is satisfied.

1. Export the full Hostinger zone files for both domains and compare them record-for-record with Cloudflare. Preserve MX, SPF, DKIM, DMARC, SRV, verification, and mail discovery records.
2. Validate ownership and current purpose of every A, AAAA, and CNAME record. The Cloudflare scan is not a substitute for a registrar export.
3. Issue and attach a valid origin certificate for `api.squadhunt.com` before proxying that hostname. Keep it DNS-only until strict TLS succeeds directly.
4. Deploy the backend changes with `CLOUDFLARE_ORIGIN_AUTH_MODE=off` first. Confirm HTTP, uploads, OAuth/webhooks, and Socket.IO remain healthy.
5. Use a scoped AWS deployment/security role. Do not perform production mutations with an AWS account root session.
6. Keep a Hostinger export, a Cloudflare DNS export, the current ALB listeners/security groups, and current ECS task definition available for rollback.

## Stage 1: DNS parity without traffic changes

1. Compare Hostinger exports with the pending Cloudflare zones.
2. Import only missing confirmed records. Do not remove records solely because they look old.
3. Leave every record DNS-only.
4. Confirm mail delivery, DKIM alignment, DMARC lookup, Microsoft/Google verification, and all public hostnames from independent resolvers.

Rollback: no production path changed. Remove only records that were newly added to the pending Cloudflare copy.

## Stage 2: origin and application readiness

1. Correct the `api.squadhunt.com` origin certificate/SNI configuration.
2. Upgrade the ALB listener to a modern TLS 1.2+ policy and the CloudFront viewer policy to TLS 1.2+ using a scoped AWS role.
3. Deploy this repository with origin authentication off:

   ```text
   CLOUDFLARE_ORIGIN_AUTH_MODE=off
   TRUST_PROXY_HOPS=1
   ```

4. Confirm the health endpoint, authenticated APIs, multipart uploads, OAuth, payment webhooks, Socket.IO polling/upgrade, reconnect, messaging, Random Connect, and call signaling.

Rollback: restore the prior ECS task definition and prior ALB/CloudFront TLS policies.

## Stage 3: nameserver activation, one zone at a time

1. Lower authoritative DNS TTLs before the maintenance window where the current provider permits it.
2. Change registrar nameservers for one zone only.
3. Wait for Cloudflare zone status to become active and verify DNSSEC remains off during the transition.
4. Verify every public DNS record and mail/security record from at least two independent resolvers.
5. Verify web, API, OAuth, email, and media behavior while records are still DNS-only.
6. Repeat for the second zone only after the first is stable.

Rollback: restore the saved Hostinger nameservers. Do not delete the Cloudflare zone during rollback.

## Stage 4: proxy web and API incrementally

1. Proxy `www.squadhunt.com`, verify Vercel custom-domain support through Cloudflare, then proxy the apex only after the first hostname is stable.
2. Proxy `api.squadhunt.in`. Verify HTTPS, API authentication, multipart uploads, Socket.IO polling and upgrade, long-lived/reconnected sockets, mobile requests, OAuth, and webhooks.
3. Proxy `api.squadhunt.com` only after direct strict-origin TLS succeeds.
4. Never proxy the CloudFront media distribution or TURN/STUN endpoints.
5. Review Cloudflare Security Events and rate-limit events before adding stricter rules.

Rollback: set the affected record to DNS-only. If strict TLS is the cause, correct the origin certificate; never switch to Flexible SSL.

## Stage 5: origin authentication

1. Generate a new high-entropy secret in the approved secret manager. Never commit or print it.
2. Configure Cloudflare to inject `X-SquadHunt-Origin-Auth` only toward the API origin.
3. Set the same secret in the ECS task and deploy:

   ```text
   CLOUDFLARE_ORIGIN_AUTH_MODE=observe
   TRUST_PROXY_HOPS=2
   ```

4. Verify logs show the credential on Cloudflare-routed HTTP and Socket.IO traffic. Confirm health checks, internal AWS traffic, Vercel server calls, webhooks, and mobile clients.
5. Resolve every legitimate bypass. Then switch to `enforce` and repeat the full smoke matrix.
6. Only after successful enforcement, restrict the ALB security group to current Cloudflare published ingress ranges plus explicitly documented health/internal sources. Automate range updates before relying on IP allowlisting.

Rollback: switch origin auth to `observe` or `off`, restore the previous security group, and keep the secret in the secret manager for investigation. Do not expose it in logs.

## Stage 6: hardening after stable traffic

1. Enable DNSSEC and publish the DS record only after each Cloudflare zone is active and stable.
2. Upgrade the Cloudflare plan if Cloudflare Managed/OWASP rulesets or multiple endpoint-specific rate-limit rules are required. Validate managed WAF rules in observed traffic before blocking.
3. Keep Bot Fight Mode off until native App/API behavior is validated. It can issue browser-oriented challenges inappropriate for native requests.
4. Add Turnstile only to selected Web abuse flows with server-side Siteverify, hostname, and action validation. Do not require it from every native request.
5. Add HSTS `includeSubDomains` or preload only after every HTTPS subdomain has been inventoried and verified.
6. Enable the logging available for the selected Cloudflare plan and configure ALB/CloudFront logs, CloudTrail, and justified VPC Flow Logs with retention and access controls.

Rollback: disable the specific new rule/control. Preserve event evidence and avoid reverting unrelated controls.

## S3 and media remediation (separate change window)

Cloudflare does not fix S3 authorization. Inventory each object prefix and classify it as public or private before changing the bucket policy.

1. Confirm CloudFront Origin Access Control can read every intended public object.
2. Migrate private prefixes to short-lived signed URLs/cookies.
3. Test avatars, posts, clips, stories, deleted content, and message attachments on Web and App.
4. Remove wildcard anonymous `GetObject`, enable all S3 Block Public Access settings, and verify direct S3 access fails while CloudFront behavior remains correct.

Rollback: restore the saved bucket policy only for the shortest necessary period, then correct the affected prefix/signing behavior. Never make the whole bucket public as a permanent fallback.

## Required release evidence

Record status and latency for Web pages, App flows, API authentication, OAuth, uploads, payment webhooks, Socket.IO polling/upgrade/reconnect, messaging, Random Connect, calling, CloudFront media playback, and direct-origin/direct-S3 denial. Record Cloudflare cache status only for intentionally cacheable Web assets; authenticated API and Socket.IO responses must remain uncached.

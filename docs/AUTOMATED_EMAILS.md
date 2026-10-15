# SquadHunt automated email rollout

Seven approved templates are rendered by `src/legacy-src/utils/automatedEmailTemplates.js`.
OTP messages use the existing SMTP transport and a shared OTP card. Other
templates use a durable `AutomatedEmailEvent` record and the existing BullMQ
email queue. The event key deduplicates retries; a provider acknowledgement
whose database status cannot be confirmed remains in `sending` for manual
reconciliation instead of risking an automatic duplicate.

The marketing preference is independent from push and in-app notification
settings. Existing users are not opted in. The five-day worker uses `lastSeen`,
which is refreshed from authenticated Web and mobile requests in UTC. It checks
consent and activity again immediately before SMTP delivery. The scheduler is
hourly and limited to 100 candidates per run. Campaign sending defaults off.

Production relay audit (2026-10-15): the ECS backend task reads `SMTP_HOST`
from its Secrets Manager configuration, which currently resolves to
`smtp.hostinger.com`. The local backend configuration uses the same relay.
AWS SES is not the active transport, and no SES email identities were found
in the checked account/region. No Hostinger Mail API token, webhook, or
automatic bounce/complaint suppression integration is configured in this
repository. Hostinger's delivery logs may support manual investigation, but
they do not automatically update the app's suppression field. Promotional
sending must remain disabled until this gap is closed and tested.
Public DNS has Hostinger SPF and all three default Hostinger DKIM CNAMEs;
DMARC is currently `p=none`. This does not prove that actual delivered mail
signs the one-click unsubscribe headers, so inspect a delivered MIME sample.

The supplied postal address matches public company-directory listings for
SquadHunt Private Limited (CIN U62099MH2025PTC463186) in its core street,
city, and postal-code details. These are third-party listings, not an
authoritative MCA filing. The supplied "Gangapur Road" line was not
independently established from an official record.

Before enabling `PROMOTIONAL_EMAILS_ENABLED=true` in production:

1. Confirm the supplied SquadHunt Private Limited Nashik postal address against
   authoritative corporate records. This repository cannot establish that fact.
2. Set a separate stable `EMAIL_UNSUBSCRIBE_SECRET` of at least 32 random
   characters. Do not reuse a JWT secret. Rotate only with a plan for older
   unsubscribe links.
3. Integrate and test Hostinger bounce/complaint feedback or a suitable
   provider-level suppression feed. Stop future marketing sends to hard-bounced
   or complaining recipients. Do not assume AWS SES suppression covers mail
   sent by Hostinger.
4. Verify the SMTP sender identity, SPF alignment, DKIM signing of both
   `List-Unsubscribe` and `List-Unsubscribe-Post`, DMARC, and the provider's
   bounce/complaint suppression settings. The SMTP API alone does not show
   whether the relay signs those exact headers.
5. Verify that the public website proxies `/api/email/unsubscribe/:token` to
   this backend over HTTPS, without authentication or bot challenges.
6. Review consent notice, lawful basis, withdrawal, retention, and DPDPA
   requirements with counsel. A technical opt-in does not establish legal
   compliance by itself.

Authenticated users can change consent at `/settings/notifications`. A footer
link performs logout-independent GET unsubscribe; the one-click header uses
POST to the same endpoint. Both are idempotent. Transactional OTP and account
emails never use the marketing preference and never carry unsubscribe headers.

Run `npm run test:automated-email`, `npm run test:notification-policy`, and
`npm run build` before rollout. Inspect actual delivered MIME and client views
with test mailboxes before enabling a campaign. No live emails are sent by
these tests.

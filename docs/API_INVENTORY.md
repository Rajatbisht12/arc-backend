# API Inventory

Generated from the mounted Express routers on 2026-09-29T22:27:00.098Z.

- HTTP endpoints: **479**
- Socket event handlers/emissions: **204**
- Access classes: `admin`: 139, `authenticated`: 280, `authenticated-onboarding`: 4, `public`: 26, `public-optional-auth`: 15, `user-or-guest`: 15

> This is a static registration inventory. Runtime health and behavioral coverage are reported separately; inclusion here does not imply an endpoint has a live-database integration test.

## HTTP endpoints

| Method | Path | Access | Source |
|---|---|---|---|
| GET | `/` | public | `src/app.ts:64` |
| GET | `/api/admin/activities` | admin | `src/modules/admin/admin.routes.ts:85` |
| GET | `/api/admin/analytics/users` | admin | `src/modules/admin/admin.routes.ts:83` |
| GET | `/api/admin/audit-logs` | admin | `src/modules/admin/admin.routes.ts:86` |
| POST | `/api/admin/auth/login` | public | `src/modules/admin/admin-login.routes.ts:33` |
| GET | `/api/admin/boost-campaigns` | admin | `src/modules/admin/admin.routes.ts:104` |
| PATCH | `/api/admin/boost-campaigns/:campaignId/delivery/adjust` | admin | `src/modules/admin/admin.routes.ts:109` |
| POST | `/api/admin/boost-campaigns/:campaignId/delivery/configure` | admin | `src/modules/admin/admin.routes.ts:107` |
| POST | `/api/admin/boost-campaigns/:campaignId/delivery/control` | admin | `src/modules/admin/admin.routes.ts:108` |
| POST | `/api/admin/boost-campaigns/:campaignId/manual-delivery` | admin | `src/modules/admin/admin.routes.ts:106` |
| PUT | `/api/admin/boost-campaigns/:campaignId/status` | admin | `src/modules/admin/admin.routes.ts:110` |
| GET | `/api/admin/boost-delivery` | admin | `src/modules/admin/admin.routes.ts:105` |
| GET | `/api/admin/broadcast-templates` | admin | `src/modules/admin/broadcast-template.routes.ts:25` |
| POST | `/api/admin/broadcast-templates` | admin | `src/modules/admin/broadcast-template.routes.ts:26` |
| DELETE | `/api/admin/broadcast-templates/:id` | admin | `src/modules/admin/broadcast-template.routes.ts:28` |
| PATCH | `/api/admin/broadcast-templates/:id` | admin | `src/modules/admin/broadcast-template.routes.ts:27` |
| GET | `/api/admin/broadcasts` | admin | `src/modules/admin/broadcast.routes.ts:37` |
| POST | `/api/admin/broadcasts` | admin | `src/modules/admin/broadcast.routes.ts:38` |
| DELETE | `/api/admin/broadcasts/:id` | admin | `src/modules/admin/broadcast.routes.ts:41` |
| GET | `/api/admin/broadcasts/:id` | admin | `src/modules/admin/broadcast.routes.ts:39` |
| PATCH | `/api/admin/broadcasts/:id` | admin | `src/modules/admin/broadcast.routes.ts:40` |
| GET | `/api/admin/broadcasts/:id/analytics` | admin | `src/modules/admin/broadcast.routes.ts:47` |
| POST | `/api/admin/broadcasts/:id/cancel` | admin | `src/modules/admin/broadcast.routes.ts:46` |
| POST | `/api/admin/broadcasts/:id/duplicate` | admin | `src/modules/admin/broadcast.routes.ts:42` |
| POST | `/api/admin/broadcasts/:id/preview` | admin | `src/modules/admin/broadcast.routes.ts:43` |
| GET | `/api/admin/broadcasts/:id/recipients` | admin | `src/modules/admin/broadcast.routes.ts:48` |
| POST | `/api/admin/broadcasts/:id/retry-failed` | admin | `src/modules/admin/broadcast.routes.ts:45` |
| POST | `/api/admin/broadcasts/:id/send` | admin | `src/modules/admin/broadcast.routes.ts:44` |
| GET | `/api/admin/broadcasts/dashboard` | admin | `src/modules/admin/broadcast.routes.ts:34` |
| GET | `/api/admin/broadcasts/delivery-logs` | admin | `src/modules/admin/broadcast.routes.ts:35` |
| POST | `/api/admin/broadcasts/preview` | admin | `src/modules/admin/broadcast.routes.ts:36` |
| GET | `/api/admin/dashboard` | admin | `src/modules/admin/admin.routes.ts:81` |
| GET | `/api/admin/health` | admin | `src/modules/admin/admin.routes.ts:84` |
| GET | `/api/admin/host-verification/applications` | admin | `src/modules/admin/admin.routes.ts:167` |
| POST | `/api/admin/host-verification/applications/:id/approve` | admin | `src/modules/admin/admin.routes.ts:168` |
| POST | `/api/admin/host-verification/applications/:id/reject` | admin | `src/modules/admin/admin.routes.ts:174` |
| POST | `/api/admin/host-verification/revoke/:userId` | admin | `src/modules/admin/admin.routes.ts:181` |
| GET | `/api/admin/host-verification/verified-hosts` | admin | `src/modules/admin/admin.routes.ts:180` |
| GET | `/api/admin/monetization/applications` | admin | `src/modules/admin/admin.routes.ts:128` |
| POST | `/api/admin/monetization/applications/:applicationId/approve` | admin | `src/modules/admin/admin.routes.ts:129` |
| POST | `/api/admin/monetization/applications/:applicationId/reject` | admin | `src/modules/admin/admin.routes.ts:130` |
| GET | `/api/admin/monetization/audit-logs` | admin | `src/modules/admin/admin.routes.ts:118` |
| GET | `/api/admin/monetization/bank-details` | admin | `src/modules/admin/admin.routes.ts:121` |
| GET | `/api/admin/monetization/bank-details/:id` | admin | `src/modules/admin/admin.routes.ts:123` |
| GET | `/api/admin/monetization/bank-details/:id/history` | admin | `src/modules/admin/admin.routes.ts:122` |
| PATCH | `/api/admin/monetization/bank-details/:id/notes` | admin | `src/modules/admin/admin.routes.ts:126` |
| POST | `/api/admin/monetization/bank-details/:id/request-update` | admin | `src/modules/admin/admin.routes.ts:125` |
| POST | `/api/admin/monetization/bank-details/:id/reveal` | admin | `src/modules/admin/admin.routes.ts:127` |
| PATCH | `/api/admin/monetization/bank-details/:id/verification` | admin | `src/modules/admin/admin.routes.ts:124` |
| GET | `/api/admin/monetization/bank-details/export.csv` | admin | `src/modules/admin/admin.routes.ts:119` |
| GET | `/api/admin/monetization/bank-details/export.xls` | admin | `src/modules/admin/admin.routes.ts:120` |
| GET | `/api/admin/monetization/charts` | admin | `src/modules/admin/admin.routes.ts:113` |
| GET | `/api/admin/monetization/cpm/:userId` | admin | `src/modules/admin/admin.routes.ts:144` |
| PUT | `/api/admin/monetization/cpm/:userId` | admin | `src/modules/admin/admin.routes.ts:143` |
| GET | `/api/admin/monetization/creators` | admin | `src/modules/admin/admin.routes.ts:137` |
| GET | `/api/admin/monetization/creators/:userId/analytics` | admin | `src/modules/admin/admin.routes.ts:135` |
| GET | `/api/admin/monetization/creators/:userId/bank-details` | admin | `src/modules/admin/admin.routes.ts:134` |
| GET | `/api/admin/monetization/creators/:userId/overview` | admin | `src/modules/admin/admin.routes.ts:136` |
| GET | `/api/admin/monetization/creators/export.csv` | admin | `src/modules/admin/admin.routes.ts:133` |
| GET | `/api/admin/monetization/dashboard` | admin | `src/modules/admin/admin.routes.ts:112` |
| POST | `/api/admin/monetization/disable/:userId` | admin | `src/modules/admin/admin.routes.ts:142` |
| POST | `/api/admin/monetization/grant/:userId` | admin | `src/modules/admin/admin.routes.ts:139` |
| GET | `/api/admin/monetization/leaderboards` | admin | `src/modules/admin/admin.routes.ts:114` |
| POST | `/api/admin/monetization/payout-hold/:userId` | admin | `src/modules/admin/admin.routes.ts:131` |
| POST | `/api/admin/monetization/payout-hold/:userId/release` | admin | `src/modules/admin/admin.routes.ts:132` |
| GET | `/api/admin/monetization/payouts` | admin | `src/modules/admin/admin.routes.ts:158` |
| GET | `/api/admin/monetization/payouts/:id` | admin | `src/modules/admin/admin.routes.ts:157` |
| POST | `/api/admin/monetization/payouts/:id/approve` | admin | `src/modules/admin/admin.routes.ts:159` |
| POST | `/api/admin/monetization/payouts/:id/cancel` | admin | `src/modules/admin/admin.routes.ts:166` |
| POST | `/api/admin/monetization/payouts/:id/failed` | admin | `src/modules/admin/admin.routes.ts:162` |
| GET | `/api/admin/monetization/payouts/:id/history` | admin | `src/modules/admin/admin.routes.ts:154` |
| POST | `/api/admin/monetization/payouts/:id/hold` | admin | `src/modules/admin/admin.routes.ts:163` |
| POST | `/api/admin/monetization/payouts/:id/paid` | admin | `src/modules/admin/admin.routes.ts:161` |
| POST | `/api/admin/monetization/payouts/:id/processing` | admin | `src/modules/admin/admin.routes.ts:160` |
| POST | `/api/admin/monetization/payouts/:id/reject` | admin | `src/modules/admin/admin.routes.ts:165` |
| POST | `/api/admin/monetization/payouts/:id/resume` | admin | `src/modules/admin/admin.routes.ts:164` |
| GET | `/api/admin/monetization/payouts/:id/statement` | admin | `src/modules/admin/admin.routes.ts:156` |
| POST | `/api/admin/monetization/payouts/:id/statement` | admin | `src/modules/admin/admin.routes.ts:155` |
| POST | `/api/admin/monetization/payouts/bulk/:action` | admin | `src/modules/admin/admin.routes.ts:153` |
| GET | `/api/admin/monetization/payouts/export.csv` | admin | `src/modules/admin/admin.routes.ts:151` |
| POST | `/api/admin/monetization/payouts/generate` | admin | `src/modules/admin/admin.routes.ts:152` |
| GET | `/api/admin/monetization/reports` | admin | `src/modules/admin/admin.routes.ts:117` |
| GET | `/api/admin/monetization/reports/export` | admin | `src/modules/admin/admin.routes.ts:115` |
| POST | `/api/admin/monetization/reports/export` | admin | `src/modules/admin/admin.routes.ts:116` |
| POST | `/api/admin/monetization/resume/:userId` | admin | `src/modules/admin/admin.routes.ts:141` |
| POST | `/api/admin/monetization/revoke/:userId` | admin | `src/modules/admin/admin.routes.ts:138` |
| GET | `/api/admin/monetization/summary` | admin | `src/modules/admin/admin.routes.ts:111` |
| POST | `/api/admin/monetization/suspend/:userId` | admin | `src/modules/admin/admin.routes.ts:140` |
| GET | `/api/admin/monetization/withdrawal-requests` | admin | `src/modules/admin/admin.routes.ts:145` |
| POST | `/api/admin/monetization/withdrawal-requests/:id/approve` | admin | `src/modules/admin/admin.routes.ts:146` |
| POST | `/api/admin/monetization/withdrawal-requests/:id/cancel` | admin | `src/modules/admin/admin.routes.ts:150` |
| POST | `/api/admin/monetization/withdrawal-requests/:id/failed` | admin | `src/modules/admin/admin.routes.ts:149` |
| POST | `/api/admin/monetization/withdrawal-requests/:id/paid` | admin | `src/modules/admin/admin.routes.ts:148` |
| POST | `/api/admin/monetization/withdrawal-requests/:id/reject` | admin | `src/modules/admin/admin.routes.ts:147` |
| GET | `/api/admin/posts` | admin | `src/modules/admin/admin.routes.ts:95` |
| DELETE | `/api/admin/posts/:postId` | admin | `src/modules/admin/admin.routes.ts:96` |
| GET | `/api/admin/premium-memberships` | admin | `src/modules/admin/premium-membership.routes.ts:23` |
| GET | `/api/admin/premium-memberships/:id` | admin | `src/modules/admin/premium-membership.routes.ts:28` |
| POST | `/api/admin/premium-memberships/:id/auto-renew` | admin | `src/modules/admin/premium-membership.routes.ts:34` |
| POST | `/api/admin/premium-memberships/:id/cancel` | admin | `src/modules/admin/premium-membership.routes.ts:31` |
| POST | `/api/admin/premium-memberships/:id/change-plan` | admin | `src/modules/admin/premium-membership.routes.ts:30` |
| POST | `/api/admin/premium-memberships/:id/extend` | admin | `src/modules/admin/premium-membership.routes.ts:29` |
| GET | `/api/admin/premium-memberships/:id/login-history` | admin | `src/modules/admin/premium-membership.routes.ts:27` |
| GET | `/api/admin/premium-memberships/:id/payments` | admin | `src/modules/admin/premium-membership.routes.ts:25` |
| POST | `/api/admin/premium-memberships/:id/reconcile` | admin | `src/modules/admin/premium-membership.routes.ts:36` |
| POST | `/api/admin/premium-memberships/:id/refund` | admin | `src/modules/admin/premium-membership.routes.ts:35` |
| POST | `/api/admin/premium-memberships/:id/remove` | admin | `src/modules/admin/premium-membership.routes.ts:32` |
| POST | `/api/admin/premium-memberships/:id/resume` | admin | `src/modules/admin/premium-membership.routes.ts:33` |
| GET | `/api/admin/premium-memberships/:id/timeline` | admin | `src/modules/admin/premium-membership.routes.ts:26` |
| GET | `/api/admin/premium-memberships/dashboard` | admin | `src/modules/admin/premium-membership.routes.ts:21` |
| GET | `/api/admin/premium-memberships/eligible-users` | admin | `src/modules/admin/premium-membership.routes.ts:22` |
| POST | `/api/admin/premium-memberships/grant` | admin | `src/modules/admin/premium-membership.routes.ts:24` |
| GET | `/api/admin/push/deliveries` | admin | `src/modules/admin/push.routes.ts:287` |
| GET | `/api/admin/push/devices` | admin | `src/modules/admin/push.routes.ts:191` |
| GET | `/api/admin/push/requests` | admin | `src/modules/admin/push.routes.ts:147` |
| POST | `/api/admin/push/test` | admin | `src/modules/admin/push.routes.ts:378` |
| GET | `/api/admin/push/voip-deliveries` | admin | `src/modules/admin/push.routes.ts:335` |
| GET | `/api/admin/reports` | admin | `src/modules/admin/admin.routes.ts:101` |
| PUT | `/api/admin/reports/:reportId` | admin | `src/modules/admin/admin.routes.ts:103` |
| GET | `/api/admin/reports/:reportId/target` | admin | `src/modules/admin/admin.routes.ts:102` |
| GET | `/api/admin/scrims` | admin | `src/modules/admin/admin.routes.ts:99` |
| DELETE | `/api/admin/scrims/:scrimId` | admin | `src/modules/admin/admin.routes.ts:100` |
| GET | `/api/admin/search` | admin | `src/modules/admin/admin.routes.ts:82` |
| GET | `/api/admin/tournaments` | admin | `src/modules/admin/admin.routes.ts:97` |
| DELETE | `/api/admin/tournaments/:tournamentId` | admin | `src/modules/admin/admin.routes.ts:98` |
| GET | `/api/admin/users` | admin | `src/modules/admin/admin.routes.ts:87` |
| DELETE | `/api/admin/users/:userId` | admin | `src/modules/admin/admin.routes.ts:94` |
| PUT | `/api/admin/users/:userId/controls` | admin | `src/modules/admin/admin.routes.ts:90` |
| GET | `/api/admin/users/:userId/inspection` | admin | `src/modules/admin/admin.routes.ts:88` |
| POST | `/api/admin/users/:userId/premium/grant` | admin | `src/modules/admin/admin.routes.ts:91` |
| POST | `/api/admin/users/:userId/premium/remove` | admin | `src/modules/admin/admin.routes.ts:92` |
| PUT | `/api/admin/users/:userId/reset-password` | admin | `src/modules/admin/admin.routes.ts:93` |
| PUT | `/api/admin/users/:userId/status` | admin | `src/modules/admin/admin.routes.ts:89` |
| DELETE | `/api/auth/account` | authenticated | `src/modules/auth/auth.routes.ts:187` |
| POST | `/api/auth/apple/mobile` | public | `src/modules/auth/auth.routes.ts:199` |
| PUT | `/api/auth/change-password` | authenticated | `src/modules/auth/auth.routes.ts:186` |
| GET | `/api/auth/check-email` | public | `src/modules/auth/auth.routes.ts:166` |
| POST | `/api/auth/check-password-same` | authenticated | `src/modules/auth/auth.routes.ts:171` |
| GET | `/api/auth/check-username` | public | `src/modules/auth/auth.routes.ts:165` |
| POST | `/api/auth/complete-google-profile` | authenticated-onboarding | `src/modules/auth/auth.routes.ts:196` |
| POST | `/api/auth/complete-profile` | authenticated-onboarding | `src/modules/auth/auth.routes.ts:189` |
| GET | `/api/auth/google` | public | `src/modules/auth/auth.routes.ts:201` |
| GET | `/api/auth/google/callback` | public | `src/modules/auth/auth.routes.ts:204` |
| GET | `/api/auth/google/mobile` | public | `src/modules/auth/auth.routes.ts:203` |
| POST | `/api/auth/google/token` | public | `src/modules/auth/auth.routes.ts:198` |
| POST | `/api/auth/guest-token` | public | `src/modules/auth/auth.routes.ts:181` |
| POST | `/api/auth/login` | public | `src/modules/auth/auth.routes.ts:180` |
| POST | `/api/auth/logout` | authenticated-onboarding | `src/modules/auth/auth.routes.ts:188` |
| GET | `/api/auth/me` | authenticated-onboarding | `src/modules/auth/auth.routes.ts:182` |
| PUT | `/api/auth/profile` | authenticated | `src/modules/auth/auth.routes.ts:183` |
| POST | `/api/auth/register` | public | `src/modules/auth/auth.routes.ts:179` |
| POST | `/api/auth/reset-password-otp` | public | `src/modules/auth/auth.routes.ts:170` |
| POST | `/api/auth/send-otp` | public | `src/modules/auth/auth.routes.ts:167` |
| POST | `/api/auth/upload-banner` | authenticated | `src/modules/auth/auth.routes.ts:185` |
| POST | `/api/auth/upload-profile-picture` | authenticated | `src/modules/auth/auth.routes.ts:184` |
| POST | `/api/auth/verify-otp-login` | public | `src/modules/auth/auth.routes.ts:169` |
| POST | `/api/auth/verify-otp-register` | public | `src/modules/auth/auth.routes.ts:168` |
| POST | `/api/calls/accept` | authenticated | `src/legacy-src/routes/calls.js:53` |
| POST | `/api/calls/end` | authenticated | `src/legacy-src/routes/calls.js:69` |
| POST | `/api/calls/group-token` | authenticated | `src/legacy-src/routes/calls.js:90` |
| POST | `/api/calls/initiate` | authenticated | `src/legacy-src/routes/calls.js:44` |
| POST | `/api/calls/reject` | authenticated | `src/legacy-src/routes/calls.js:61` |
| GET | `/api/calls/sessions/:callId` | authenticated | `src/legacy-src/routes/calls.js:84` |
| POST | `/api/calls/sessions/:callId/accept` | authenticated | `src/legacy-src/routes/calls.js:85` |
| POST | `/api/calls/sessions/:callId/decline` | authenticated | `src/legacy-src/routes/calls.js:86` |
| POST | `/api/calls/sessions/:callId/end` | authenticated | `src/legacy-src/routes/calls.js:87` |
| GET | `/api/calls/sessions/pending` | authenticated | `src/legacy-src/routes/calls.js:83` |
| POST | `/api/calls/token` | authenticated | `src/legacy-src/routes/calls.js:41` |
| GET | `/api/challenges` | public-optional-auth | `src/modules/challenges/challenges.routes.ts:59` |
| POST | `/api/challenges` | authenticated | `src/modules/challenges/challenges.routes.ts:63` |
| DELETE | `/api/challenges/:id` | authenticated | `src/modules/challenges/challenges.routes.ts:67` |
| GET | `/api/challenges/:id` | public-optional-auth | `src/modules/challenges/challenges.routes.ts:62` |
| PUT | `/api/challenges/:id` | authenticated | `src/modules/challenges/challenges.routes.ts:66` |
| POST | `/api/challenges/:id/distribute-rewards` | authenticated | `src/modules/challenges/challenges.routes.ts:68` |
| POST | `/api/challenges/:id/join` | authenticated | `src/modules/challenges/challenges.routes.ts:64` |
| PUT | `/api/challenges/:id/progress` | authenticated | `src/modules/challenges/challenges.routes.ts:65` |
| GET | `/api/challenges/my/challenges` | authenticated | `src/modules/challenges/challenges.routes.ts:60` |
| GET | `/api/challenges/my/participations` | authenticated | `src/modules/challenges/challenges.routes.ts:61` |
| GET | `/api/chat/:chatId/messages` | authenticated | `src/modules/chat/chat.routes.ts:7` |
| POST | `/api/chat/messages` | authenticated | `src/modules/chat/chat.routes.ts:8` |
| GET | `/api/feedback` | admin | `src/modules/feedback/feedback.routes.ts:41` |
| POST | `/api/feedback` | public | `src/modules/feedback/feedback.routes.ts:30` |
| DELETE | `/api/feedback/:id` | admin | `src/modules/feedback/feedback.routes.ts:53` |
| PUT | `/api/feedback/:id/status` | admin | `src/modules/feedback/feedback.routes.ts:43` |
| GET | `/api/feedback/stats` | admin | `src/modules/feedback/feedback.routes.ts:42` |
| GET | `/api/health` | public | `src/modules/health/health.routes.ts:5` |
| POST | `/api/host-verification/apply` | authenticated | `src/modules/host-verification/host-verification.routes.ts:8` |
| GET | `/api/host-verification/status` | authenticated | `src/modules/host-verification/host-verification.routes.ts:21` |
| POST | `/api/leave-requests/team/:teamId/leave-request` | authenticated | `src/modules/leave-requests/leave-requests.routes.ts:8` |
| DELETE | `/api/leave-requests/team/:teamId/leave-request/:requestId` | authenticated | `src/modules/leave-requests/leave-requests.routes.ts:42` |
| PATCH | `/api/leave-requests/team/:teamId/leave-request/:requestId` | authenticated | `src/modules/leave-requests/leave-requests.routes.ts:30` |
| GET | `/api/leave-requests/team/:teamId/leave-requests` | authenticated | `src/modules/leave-requests/leave-requests.routes.ts:18` |
| GET | `/api/leave-requests/user/leave-requests` | authenticated | `src/modules/leave-requests/leave-requests.routes.ts:27` |
| GET | `/api/membership` | authenticated | `src/modules/membership/membership.routes.ts:24` |
| POST | `/api/membership/cancel` | authenticated | `src/modules/membership/membership.routes.ts:29` |
| POST | `/api/membership/payment/create-order` | authenticated | `src/modules/membership/membership.routes.ts:25` |
| POST | `/api/membership/payment/verify` | authenticated | `src/modules/membership/membership.routes.ts:26` |
| GET | `/api/membership/plans` | public | `src/modules/membership/membership.routes.ts:23` |
| POST | `/api/membership/subscription/create` | authenticated | `src/modules/membership/membership.routes.ts:27` |
| POST | `/api/membership/subscription/verify` | authenticated | `src/modules/membership/membership.routes.ts:28` |
| POST | `/api/messages/:messageId/invite-response` | authenticated | `src/modules/messages/messages.routes.ts:145` |
| POST | `/api/messages/:messageId/reaction` | authenticated | `src/modules/messages/messages.routes.ts:144` |
| POST | `/api/messages/call-summary` | authenticated | `src/modules/messages/messages.routes.ts:141` |
| POST | `/api/messages/chat/:userId/mute` | authenticated | `src/modules/messages/messages.routes.ts:147` |
| POST | `/api/messages/chat/:userId/pin` | authenticated | `src/modules/messages/messages.routes.ts:151` |
| POST | `/api/messages/direct` | authenticated | `src/modules/messages/messages.routes.ts:89` |
| DELETE | `/api/messages/direct/:userId` | authenticated | `src/modules/messages/messages.routes.ts:142` |
| GET | `/api/messages/direct/:userId` | authenticated | `src/modules/messages/messages.routes.ts:90` |
| POST | `/api/messages/direct/:userId/mute` | authenticated | `src/modules/messages/messages.routes.ts:149` |
| POST | `/api/messages/group` | authenticated | `src/modules/messages/messages.routes.ts:138` |
| POST | `/api/messages/group/:chatRoomId/pin` | authenticated | `src/modules/messages/messages.routes.ts:152` |
| POST | `/api/messages/join/:inviteToken` | authenticated | `src/modules/messages/messages.routes.ts:125` |
| GET | `/api/messages/join/:inviteToken/preview` | public | `src/modules/messages/messages.routes.ts:118` |
| POST | `/api/messages/mark-read` | authenticated | `src/modules/messages/messages.routes.ts:140` |
| GET | `/api/messages/media-policy` | authenticated | `src/modules/messages/messages.routes.ts:88` |
| POST | `/api/messages/pin` | authenticated | `src/modules/messages/messages.routes.ts:156` |
| GET | `/api/messages/preferences` | authenticated | `src/modules/messages/messages.routes.ts:146` |
| GET | `/api/messages/recent` | authenticated | `src/modules/messages/messages.routes.ts:91` |
| POST | `/api/messages/report` | authenticated | `src/modules/messages/messages.routes.ts:154` |
| GET | `/api/messages/rooms` | authenticated | `src/modules/messages/messages.routes.ts:93` |
| POST | `/api/messages/rooms` | authenticated | `src/modules/messages/messages.routes.ts:92` |
| DELETE | `/api/messages/rooms/:chatRoomId` | authenticated | `src/modules/messages/messages.routes.ts:143` |
| GET | `/api/messages/rooms/:chatRoomId` | authenticated | `src/modules/messages/messages.routes.ts:139` |
| PUT | `/api/messages/rooms/:chatRoomId` | authenticated | `src/modules/messages/messages.routes.ts:126` |
| POST | `/api/messages/rooms/:chatRoomId/clear` | authenticated | `src/modules/messages/messages.routes.ts:107` |
| DELETE | `/api/messages/rooms/:chatRoomId/conversation` | authenticated | `src/modules/messages/messages.routes.ts:98` |
| POST | `/api/messages/rooms/:chatRoomId/invite-dm` | authenticated | `src/modules/messages/messages.routes.ts:116` |
| GET | `/api/messages/rooms/:chatRoomId/invite-link` | authenticated | `src/modules/messages/messages.routes.ts:114` |
| POST | `/api/messages/rooms/:chatRoomId/leave` | authenticated | `src/modules/messages/messages.routes.ts:94` |
| POST | `/api/messages/rooms/:chatRoomId/members` | authenticated | `src/modules/messages/messages.routes.ts:135` |
| DELETE | `/api/messages/rooms/:chatRoomId/members/:memberId` | authenticated | `src/modules/messages/messages.routes.ts:137` |
| PUT | `/api/messages/rooms/:chatRoomId/members/:memberId/role` | authenticated | `src/modules/messages/messages.routes.ts:136` |
| POST | `/api/messages/rooms/:chatRoomId/mute` | authenticated | `src/modules/messages/messages.routes.ts:150` |
| PUT | `/api/messages/rooms/:chatRoomId/permissions` | authenticated | `src/modules/messages/messages.routes.ts:117` |
| POST | `/api/messages/rooms/:chatRoomId/reset-invite-link` | authenticated | `src/modules/messages/messages.routes.ts:115` |
| GET | `/api/monetization/application` | authenticated | `src/modules/monetization/monetization.routes.ts:10` |
| GET | `/api/monetization/application/history` | authenticated | `src/modules/monetization/monetization.routes.ts:11` |
| POST | `/api/monetization/application/withdraw` | authenticated | `src/modules/monetization/monetization.routes.ts:13` |
| POST | `/api/monetization/apply` | authenticated | `src/modules/monetization/monetization.routes.ts:12` |
| DELETE | `/api/monetization/bank-details` | authenticated | `src/modules/monetization/monetization.routes.ts:20` |
| GET | `/api/monetization/bank-details` | authenticated | `src/modules/monetization/monetization.routes.ts:17` |
| PUT | `/api/monetization/bank-details` | authenticated | `src/modules/monetization/monetization.routes.ts:18` |
| DELETE | `/api/monetization/bank-details/tax-id` | authenticated | `src/modules/monetization/monetization.routes.ts:19` |
| GET | `/api/monetization/dashboard` | authenticated | `src/modules/monetization/monetization.routes.ts:14` |
| GET | `/api/monetization/earnings` | authenticated | `src/modules/monetization/monetization.routes.ts:15` |
| GET | `/api/monetization/eligibility` | authenticated | `src/modules/monetization/monetization.routes.ts:9` |
| GET | `/api/monetization/payout-history` | authenticated | `src/modules/monetization/monetization.routes.ts:16` |
| GET | `/api/monetization/status` | authenticated | `src/modules/monetization/monetization.routes.ts:21` |
| POST | `/api/monetization/withdrawal-request` | authenticated | `src/modules/monetization/monetization.routes.ts:22` |
| GET | `/api/music/search` | user-or-guest | `src/modules/music/music.routes.ts:225` |
| POST | `/api/music/upload` | authenticated | `src/modules/music/music.routes.ts:302` |
| DELETE | `/api/music/upload/:id` | authenticated | `src/modules/music/music.routes.ts:304` |
| GET | `/api/music/upload/mine` | authenticated | `src/modules/music/music.routes.ts:303` |
| GET | `/api/notifications` | authenticated | `src/modules/notifications/notifications.routes.ts:937` |
| DELETE | `/api/notifications/:id` | authenticated | `src/modules/notifications/notifications.routes.ts:1127` |
| PUT | `/api/notifications/:id/archive` | authenticated | `src/modules/notifications/notifications.routes.ts:1089` |
| POST | `/api/notifications/:id/click` | authenticated | `src/modules/notifications/notifications.routes.ts:892` |
| POST | `/api/notifications/:id/delivered` | authenticated | `src/modules/notifications/notifications.routes.ts:827` |
| POST | `/api/notifications/:id/open` | authenticated | `src/modules/notifications/notifications.routes.ts:856` |
| PUT | `/api/notifications/:id/read` | authenticated | `src/modules/notifications/notifications.routes.ts:1034` |
| PUT | `/api/notifications/:id/unarchive` | authenticated | `src/modules/notifications/notifications.routes.ts:1108` |
| DELETE | `/api/notifications/client-context` | authenticated | `src/modules/notifications/notifications.routes.ts:552` |
| POST | `/api/notifications/client-context` | authenticated | `src/modules/notifications/notifications.routes.ts:442` |
| GET | `/api/notifications/push-deliveries` | authenticated | `src/modules/notifications/notifications.routes.ts:633` |
| GET | `/api/notifications/push-status` | authenticated | `src/modules/notifications/notifications.routes.ts:575` |
| POST | `/api/notifications/push-test` | authenticated | `src/modules/notifications/notifications.routes.ts:661` |
| DELETE | `/api/notifications/push-token` | authenticated | `src/modules/notifications/notifications.routes.ts:508` |
| POST | `/api/notifications/push-token` | authenticated | `src/modules/notifications/notifications.routes.ts:263` |
| PUT | `/api/notifications/read-all` | authenticated | `src/modules/notifications/notifications.routes.ts:1065` |
| DELETE | `/api/notifications/voip-token` | authenticated | `src/modules/notifications/notifications.routes.ts:410` |
| POST | `/api/notifications/voip-token` | authenticated | `src/modules/notifications/notifications.routes.ts:370` |
| GET | `/api/payments/apple/catalog` | authenticated | `src/modules/payments/payments.routes.ts:113` |
| POST | `/api/payments/apple/intents/boost` | authenticated | `src/modules/payments/payments.routes.ts:123` |
| POST | `/api/payments/apple/intents/subscription` | authenticated | `src/modules/payments/payments.routes.ts:114` |
| POST | `/api/payments/apple/notifications` | public | `src/modules/payments/payments.routes.ts:105` |
| POST | `/api/payments/apple/restore` | authenticated | `src/modules/payments/payments.routes.ts:140` |
| POST | `/api/payments/apple/transactions/verify` | authenticated | `src/modules/payments/payments.routes.ts:131` |
| GET | `/api/payments/boost/campaigns` | authenticated | `src/modules/payments/payments.routes.ts:163` |
| POST | `/api/payments/boost/create-order` | authenticated | `src/modules/payments/payments.routes.ts:164` |
| POST | `/api/payments/boost/verify` | authenticated | `src/modules/payments/payments.routes.ts:165` |
| GET | `/api/payments/history` | authenticated | `src/modules/payments/payments.routes.ts:150` |
| POST | `/api/payments/razorpay/webhook` | public | `src/modules/payments/payments.routes.ts:104` |
| POST | `/api/payments/subscription/create` | authenticated | `src/modules/payments/payments.routes.ts:155` |
| POST | `/api/payments/subscription/create-order` | authenticated | `src/modules/payments/payments.routes.ts:153` |
| POST | `/api/payments/subscription/verify` | authenticated | `src/modules/payments/payments.routes.ts:154` |
| POST | `/api/payments/subscription/verify-recurring` | authenticated | `src/modules/payments/payments.routes.ts:156` |
| POST | `/api/payments/tournament/create-order` | authenticated | `src/modules/payments/payments.routes.ts:159` |
| POST | `/api/payments/tournament/verify` | authenticated | `src/modules/payments/payments.routes.ts:160` |
| GET | `/api/posts` | user-or-guest | `src/modules/posts/posts.routes.ts:62` |
| POST | `/api/posts` | authenticated | `src/modules/posts/posts.routes.ts:61` |
| DELETE | `/api/posts/:id` | authenticated | `src/modules/posts/posts.routes.ts:80` |
| GET | `/api/posts/:id` | user-or-guest | `src/modules/posts/posts.routes.ts:70` |
| PUT | `/api/posts/:id` | authenticated | `src/modules/posts/posts.routes.ts:79` |
| GET | `/api/posts/:id/availability` | public | `src/modules/posts/posts.routes.ts:67` |
| POST | `/api/posts/:id/boost` | authenticated | `src/modules/posts/posts.routes.ts:82` |
| POST | `/api/posts/:id/comment` | authenticated | `src/modules/posts/posts.routes.ts:75` |
| GET | `/api/posts/:id/comments` | user-or-guest | `src/modules/posts/posts.routes.ts:71` |
| POST | `/api/posts/:id/like` | authenticated | `src/modules/posts/posts.routes.ts:74` |
| GET | `/api/posts/:id/likes` | user-or-guest | `src/modules/posts/posts.routes.ts:72` |
| POST | `/api/posts/:id/report` | authenticated | `src/modules/posts/posts.routes.ts:81` |
| POST | `/api/posts/:id/save` | authenticated | `src/modules/posts/posts.routes.ts:77` |
| POST | `/api/posts/:id/share` | authenticated | `src/modules/posts/posts.routes.ts:76` |
| POST | `/api/posts/:id/view` | authenticated | `src/modules/posts/posts.routes.ts:73` |
| GET | `/api/posts/clips` | user-or-guest | `src/modules/posts/posts.routes.ts:63` |
| POST | `/api/posts/interaction` | authenticated | `src/modules/posts/posts.routes.ts:78` |
| GET | `/api/posts/liked` | authenticated | `src/modules/posts/posts.routes.ts:69` |
| GET | `/api/posts/saved` | authenticated | `src/modules/posts/posts.routes.ts:68` |
| GET | `/api/random-connections/active-sessions` | authenticated | `src/modules/random-connections/random-connections.routes.ts:112` |
| POST | `/api/random-connections/cleanup-current` | authenticated | `src/modules/random-connections/random-connections.routes.ts:116` |
| GET | `/api/random-connections/current-connection` | authenticated | `src/modules/random-connections/random-connections.routes.ts:110` |
| GET | `/api/random-connections/daily-gender-matches-remaining` | authenticated | `src/modules/random-connections/random-connections.routes.ts:41` |
| POST | `/api/random-connections/disconnect` | authenticated | `src/modules/random-connections/random-connections.routes.ts:113` |
| GET | `/api/random-connections/entitlements` | authenticated | `src/modules/random-connections/random-connections.routes.ts:40` |
| POST | `/api/random-connections/heartbeat` | authenticated | `src/modules/random-connections/random-connections.routes.ts:111` |
| POST | `/api/random-connections/join-queue` | authenticated | `src/modules/random-connections/random-connections.routes.ts:108` |
| DELETE | `/api/random-connections/leave-queue` | authenticated | `src/modules/random-connections/random-connections.routes.ts:109` |
| POST | `/api/random-connections/next` | authenticated | `src/modules/random-connections/random-connections.routes.ts:114` |
| GET | `/api/random-connections/queue-status` | authenticated | `src/modules/random-connections/random-connections.routes.ts:16` |
| POST | `/api/random-connections/send-message` | authenticated | `src/modules/random-connections/random-connections.routes.ts:115` |
| POST | `/api/random-connections/v2/cleanup-current` | authenticated | `src/modules/random-connections/random-connections.routes.ts:125` |
| GET | `/api/random-connections/v2/current-connection` | authenticated | `src/modules/random-connections/random-connections.routes.ts:122` |
| POST | `/api/random-connections/v2/disconnect` | authenticated | `src/modules/random-connections/random-connections.routes.ts:124` |
| POST | `/api/random-connections/v2/heartbeat` | authenticated | `src/modules/random-connections/random-connections.routes.ts:123` |
| POST | `/api/random-connections/v2/join-queue` | authenticated | `src/modules/random-connections/random-connections.routes.ts:120` |
| DELETE | `/api/random-connections/v2/leave-queue` | authenticated | `src/modules/random-connections/random-connections.routes.ts:121` |
| PUT | `/api/recruitment/applications/:applicationId/status` | authenticated | `src/modules/recruitment/recruitment.routes.ts:50` |
| GET | `/api/recruitment/applications/my` | authenticated | `src/modules/recruitment/recruitment.routes.ts:47` |
| GET | `/api/recruitment/applications/team` | authenticated | `src/modules/recruitment/recruitment.routes.ts:48` |
| GET | `/api/recruitment/entitlements` | authenticated | `src/modules/recruitment/recruitment.routes.ts:32` |
| GET | `/api/recruitment/player-profiles` | authenticated | `src/modules/recruitment/recruitment.routes.ts:33` |
| POST | `/api/recruitment/player-profiles` | authenticated | `src/modules/recruitment/recruitment.routes.ts:30` |
| DELETE | `/api/recruitment/player-profiles/:id` | authenticated | `src/modules/recruitment/recruitment.routes.ts:38` |
| GET | `/api/recruitment/player-profiles/:id` | public-optional-auth | `src/modules/recruitment/recruitment.routes.ts:35` |
| PUT | `/api/recruitment/player-profiles/:id` | authenticated | `src/modules/recruitment/recruitment.routes.ts:37` |
| POST | `/api/recruitment/player-profiles/:profileId/interest` | authenticated | `src/modules/recruitment/recruitment.routes.ts:45` |
| GET | `/api/recruitment/player-profiles/daily-limit` | authenticated | `src/modules/recruitment/recruitment.routes.ts:31` |
| GET | `/api/recruitment/profile/:code` | public-optional-auth | `src/modules/recruitment/recruitment.routes.ts:36` |
| GET | `/api/recruitment/profile/:code/preview` | public-optional-auth | `src/modules/recruitment/recruitment.routes.ts:34` |
| POST | `/api/recruitment/profile/:profileId/interest` | authenticated | `src/modules/recruitment/recruitment.routes.ts:46` |
| GET | `/api/recruitment/recruitment/:code` | public-optional-auth | `src/modules/recruitment/recruitment.routes.ts:23` |
| GET | `/api/recruitment/recruitment/:code/preview` | public-optional-auth | `src/modules/recruitment/recruitment.routes.ts:22` |
| POST | `/api/recruitment/recruitment/:recruitmentId/apply` | authenticated | `src/modules/recruitment/recruitment.routes.ts:43` |
| POST | `/api/recruitment/recruitment/:recruitmentId/withdraw` | authenticated | `src/modules/recruitment/recruitment.routes.ts:44` |
| GET | `/api/recruitment/team-applications` | authenticated | `src/modules/recruitment/recruitment.routes.ts:49` |
| GET | `/api/recruitment/team-recruitments` | authenticated | `src/modules/recruitment/recruitment.routes.ts:21` |
| POST | `/api/recruitment/team-recruitments` | authenticated | `src/modules/recruitment/recruitment.routes.ts:20` |
| DELETE | `/api/recruitment/team-recruitments/:id` | authenticated | `src/modules/recruitment/recruitment.routes.ts:28` |
| GET | `/api/recruitment/team-recruitments/:id` | public-optional-auth | `src/modules/recruitment/recruitment.routes.ts:24` |
| PUT | `/api/recruitment/team-recruitments/:id` | authenticated | `src/modules/recruitment/recruitment.routes.ts:25` |
| POST | `/api/recruitment/team-recruitments/:id/close` | authenticated | `src/modules/recruitment/recruitment.routes.ts:26` |
| POST | `/api/recruitment/team-recruitments/:id/reopen` | authenticated | `src/modules/recruitment/recruitment.routes.ts:27` |
| DELETE | `/api/recruitment/team-recruitments/:recruitmentId/apply` | authenticated | `src/modules/recruitment/recruitment.routes.ts:41` |
| POST | `/api/recruitment/team-recruitments/:recruitmentId/apply` | authenticated | `src/modules/recruitment/recruitment.routes.ts:40` |
| POST | `/api/recruitment/team-recruitments/:recruitmentId/withdraw` | authenticated | `src/modules/recruitment/recruitment.routes.ts:42` |
| POST | `/api/reports` | authenticated | `src/modules/reports/reports.routes.ts:7` |
| GET | `/api/rtc/credentials` | admin | `src/legacy-src/routes/rtc.js:100` |
| DELETE | `/api/rtc/credentials/:username` | admin | `src/legacy-src/routes/rtc.js:109` |
| GET | `/api/rtc/ice` | authenticated | `src/legacy-src/routes/rtc.js:72` |
| GET | `/api/rtc/usage` | admin | `src/legacy-src/routes/rtc.js:91` |
| GET | `/api/rtc/usage/:username` | admin | `src/legacy-src/routes/rtc.js:83` |
| GET | `/api/scrims` | public-optional-auth | `src/modules/scrims/scrims.routes.ts:12` |
| POST | `/api/scrims` | authenticated | `src/modules/scrims/scrims.routes.ts:13` |
| DELETE | `/api/scrims/:id` | authenticated | `src/modules/scrims/scrims.routes.ts:20` |
| GET | `/api/scrims/:id` | public-optional-auth | `src/modules/scrims/scrims.routes.ts:18` |
| PUT | `/api/scrims/:id` | authenticated | `src/modules/scrims/scrims.routes.ts:19` |
| POST | `/api/scrims/:id/assign-special-prize` | authenticated | `src/modules/scrims/scrims.routes.ts:28` |
| POST | `/api/scrims/:id/broadcast` | authenticated | `src/modules/scrims/scrims.routes.ts:29` |
| PUT | `/api/scrims/:id/cancel` | authenticated | `src/modules/scrims/scrims.routes.ts:25` |
| POST | `/api/scrims/:id/generate-final-result` | authenticated | `src/modules/scrims/scrims.routes.ts:27` |
| POST | `/api/scrims/:id/join` | authenticated | `src/modules/scrims/scrims.routes.ts:22` |
| POST | `/api/scrims/:id/leave` | authenticated | `src/modules/scrims/scrims.routes.ts:23` |
| POST | `/api/scrims/:id/matches/:matchNumber/results` | authenticated | `src/modules/scrims/scrims.routes.ts:24` |
| POST | `/api/scrims/:id/prize-distribution` | authenticated | `src/modules/scrims/scrims.routes.ts:26` |
| GET | `/api/scrims/code/:code` | public-optional-auth | `src/modules/scrims/scrims.routes.ts:15` |
| POST | `/api/stories` | authenticated | `src/modules/stories/stories.routes.ts:11` |
| DELETE | `/api/stories/:storyId` | authenticated | `src/modules/stories/stories.routes.ts:15` |
| GET | `/api/stories/:storyId` | authenticated | `src/modules/stories/stories.routes.ts:12` |
| POST | `/api/stories/:storyId/view` | authenticated | `src/modules/stories/stories.routes.ts:13` |
| GET | `/api/stories/:storyId/views` | authenticated | `src/modules/stories/stories.routes.ts:14` |
| GET | `/api/stories/feed` | authenticated | `src/modules/stories/stories.routes.ts:9` |
| GET | `/api/stories/user/:userId` | authenticated | `src/modules/stories/stories.routes.ts:10` |
| GET | `/api/tournaments` | public-optional-auth | `src/modules/tournaments/tournaments.routes.ts:29` |
| POST | `/api/tournaments` | authenticated | `src/modules/tournaments/tournaments.routes.ts:30` |
| DELETE | `/api/tournaments/:id` | authenticated | `src/modules/tournaments/tournaments.routes.ts:38` |
| GET | `/api/tournaments/:id` | public-optional-auth | `src/modules/tournaments/tournaments.routes.ts:36` |
| PUT | `/api/tournaments/:id` | authenticated | `src/modules/tournaments/tournaments.routes.ts:37` |
| POST | `/api/tournaments/:id/assign-groups` | authenticated | `src/modules/tournaments/tournaments.routes.ts:44` |
| POST | `/api/tournaments/:id/assign-participant` | authenticated | `src/modules/tournaments/tournaments.routes.ts:58` |
| POST | `/api/tournaments/:id/assign-special-prize` | authenticated | `src/modules/tournaments/tournaments.routes.ts:79` |
| POST | `/api/tournaments/:id/auto-assign-round-2` | authenticated | `src/modules/tournaments/tournaments.routes.ts:76` |
| POST | `/api/tournaments/:id/broadcast-schedule` | authenticated | `src/modules/tournaments/tournaments.routes.ts:67` |
| PUT | `/api/tournaments/:id/cancel` | authenticated | `src/modules/tournaments/tournaments.routes.ts:47` |
| POST | `/api/tournaments/:id/create-round-2` | authenticated | `src/modules/tournaments/tournaments.routes.ts:75` |
| POST | `/api/tournaments/:id/generate-final-result` | authenticated | `src/modules/tournaments/tournaments.routes.ts:78` |
| POST | `/api/tournaments/:id/group-message` | authenticated | `src/modules/tournaments/tournaments.routes.ts:49` |
| DELETE | `/api/tournaments/:id/group-message/:groupId/:round/:messageIndex` | authenticated | `src/modules/tournaments/tournaments.routes.ts:53` |
| GET | `/api/tournaments/:id/group-messages` | authenticated | `src/modules/tournaments/tournaments.routes.ts:51` |
| POST | `/api/tournaments/:id/join` | authenticated | `src/modules/tournaments/tournaments.routes.ts:40` |
| POST | `/api/tournaments/:id/join-duo` | authenticated | `src/modules/tournaments/tournaments.routes.ts:41` |
| POST | `/api/tournaments/:id/leave` | authenticated | `src/modules/tournaments/tournaments.routes.ts:42` |
| POST | `/api/tournaments/:id/leave-team` | authenticated | `src/modules/tournaments/tournaments.routes.ts:43` |
| POST | `/api/tournaments/:id/next-round` | authenticated | `src/modules/tournaments/tournaments.routes.ts:71` |
| POST | `/api/tournaments/:id/open-registration` | authenticated | `src/modules/tournaments/tournaments.routes.ts:80` |
| GET | `/api/tournaments/:id/participants` | authenticated | `src/modules/tournaments/tournaments.routes.ts:56` |
| POST | `/api/tournaments/:id/prize-distribution` | authenticated | `src/modules/tournaments/tournaments.routes.ts:77` |
| GET | `/api/tournaments/:id/qualification-settings` | authenticated | `src/modules/tournaments/tournaments.routes.ts:74` |
| POST | `/api/tournaments/:id/qualification-settings` | authenticated | `src/modules/tournaments/tournaments.routes.ts:73` |
| GET | `/api/tournaments/:id/qualification-status` | authenticated | `src/modules/tournaments/tournaments.routes.ts:72` |
| POST | `/api/tournaments/:id/qualify` | authenticated | `src/modules/tournaments/tournaments.routes.ts:70` |
| POST | `/api/tournaments/:id/recreate-groups` | authenticated | `src/modules/tournaments/tournaments.routes.ts:60` |
| POST | `/api/tournaments/:id/remove-participant` | authenticated | `src/modules/tournaments/tournaments.routes.ts:57` |
| POST | `/api/tournaments/:id/results` | authenticated | `src/modules/tournaments/tournaments.routes.ts:68` |
| GET | `/api/tournaments/:id/results/:round` | authenticated | `src/modules/tournaments/tournaments.routes.ts:69` |
| PUT | `/api/tournaments/:id/round-settings` | authenticated | `src/modules/tournaments/tournaments.routes.ts:59` |
| GET | `/api/tournaments/:id/schedule` | authenticated | `src/modules/tournaments/tournaments.routes.ts:62` |
| POST | `/api/tournaments/:id/schedule` | authenticated | `src/modules/tournaments/tournaments.routes.ts:61` |
| PUT | `/api/tournaments/:id/schedule-config` | authenticated | `src/modules/tournaments/tournaments.routes.ts:66` |
| POST | `/api/tournaments/:id/schedule-matches` | authenticated | `src/modules/tournaments/tournaments.routes.ts:46` |
| DELETE | `/api/tournaments/:id/schedule/:matchId` | authenticated | `src/modules/tournaments/tournaments.routes.ts:64` |
| PUT | `/api/tournaments/:id/schedule/:matchId` | authenticated | `src/modules/tournaments/tournaments.routes.ts:63` |
| DELETE | `/api/tournaments/:id/schedule/round/:round` | authenticated | `src/modules/tournaments/tournaments.routes.ts:65` |
| POST | `/api/tournaments/:id/start` | authenticated | `src/modules/tournaments/tournaments.routes.ts:45` |
| POST | `/api/tournaments/:id/start-match` | authenticated | `src/modules/tournaments/tournaments.routes.ts:54` |
| POST | `/api/tournaments/:id/tournament-message` | authenticated | `src/modules/tournaments/tournaments.routes.ts:48` |
| DELETE | `/api/tournaments/:id/tournament-message/:messageIndex` | authenticated | `src/modules/tournaments/tournaments.routes.ts:52` |
| GET | `/api/tournaments/:id/tournament-messages` | authenticated | `src/modules/tournaments/tournaments.routes.ts:50` |
| POST | `/api/tournaments/:id/update-match-result` | authenticated | `src/modules/tournaments/tournaments.routes.ts:55` |
| GET | `/api/tournaments/by-name/:tournamentName/:hostUsername` | public-optional-auth | `src/modules/tournaments/tournaments.routes.ts:33` |
| GET | `/api/tournaments/code/:code` | public-optional-auth | `src/modules/tournaments/tournaments.routes.ts:32` |
| GET | `/api/tournaments/hosting-limits` | authenticated | `src/modules/tournaments/tournaments.routes.ts:26` |
| GET | `/api/users` | user-or-guest | `src/modules/users/users.routes.ts:85` |
| GET | `/api/users/:id/clips` | user-or-guest | `src/modules/users/users.routes.ts:123` |
| DELETE | `/api/users/:id/follow` | authenticated | `src/modules/users/users.routes.ts:119` |
| POST | `/api/users/:id/follow` | authenticated | `src/modules/users/users.routes.ts:118` |
| GET | `/api/users/:id/followers` | user-or-guest | `src/modules/users/users.routes.ts:120` |
| GET | `/api/users/:id/following` | user-or-guest | `src/modules/users/users.routes.ts:121` |
| GET | `/api/users/:id/posts` | user-or-guest | `src/modules/users/users.routes.ts:122` |
| GET | `/api/users/:identifier` | user-or-guest | `src/modules/users/users.routes.ts:117` |
| GET | `/api/users/:identifier/availability` | public | `src/modules/users/users.routes.ts:116` |
| GET | `/api/users/:identifier/tournaments` | user-or-guest | `src/modules/users/users.routes.ts:104` |
| POST | `/api/users/:teamId/leave-request` | authenticated | `src/modules/users/users.routes.ts:132` |
| GET | `/api/users/:teamId/leave-requests` | authenticated | `src/modules/users/users.routes.ts:133` |
| GET | `/api/users/:teamId/pending-invites` | authenticated | `src/modules/users/users.routes.ts:131` |
| DELETE | `/api/users/:teamId/roster/:game/:playerId` | authenticated | `src/modules/users/users.routes.ts:126` |
| DELETE | `/api/users/:teamId/roster/:game/leave` | authenticated | `src/modules/users/users.routes.ts:125` |
| POST | `/api/users/:teamId/roster/add` | authenticated | `src/modules/users/users.routes.ts:124` |
| DELETE | `/api/users/:teamId/staff/:playerId` | authenticated | `src/modules/users/users.routes.ts:130` |
| POST | `/api/users/:teamId/staff/add` | authenticated | `src/modules/users/users.routes.ts:127` |
| POST | `/api/users/:teamId/staff/add-by-username` | authenticated | `src/modules/users/users.routes.ts:128` |
| DELETE | `/api/users/:teamId/staff/cancel-by-username` | authenticated | `src/modules/users/users.routes.ts:129` |
| GET | `/api/users/:userId/dm-privacy` | authenticated | `src/modules/users/users.routes.ts:110` |
| GET | `/api/users/:username/tournament-history` | user-or-guest | `src/modules/users/users.routes.ts:105` |
| GET | `/api/users/avatar/:userId` | public | `src/modules/users/users.routes.ts:88` |
| DELETE | `/api/users/block/:username` | authenticated | `src/modules/users/users.routes.ts:91` |
| POST | `/api/users/block/:username` | authenticated | `src/modules/users/users.routes.ts:90` |
| GET | `/api/users/blocked` | authenticated | `src/modules/users/users.routes.ts:89` |
| POST | `/api/users/create-team` | authenticated | `src/modules/users/users.routes.ts:87` |
| POST | `/api/users/follow-requests/:requestId/accept` | authenticated | `src/modules/users/users.routes.ts:112` |
| POST | `/api/users/follow-requests/:requestId/reject` | authenticated | `src/modules/users/users.routes.ts:113` |
| GET | `/api/users/follow-requests/incoming` | authenticated | `src/modules/users/users.routes.ts:111` |
| GET | `/api/users/gaming-stats` | authenticated | `src/modules/users/users.routes.ts:98` |
| POST | `/api/users/gaming-stats` | authenticated | `src/modules/users/users.routes.ts:99` |
| DELETE | `/api/users/gaming-stats/:statId` | authenticated | `src/modules/users/users.routes.ts:101` |
| PUT | `/api/users/gaming-stats/:statId` | authenticated | `src/modules/users/users.routes.ts:100` |
| POST | `/api/users/gaming-stats/sync-coc` | authenticated | `src/modules/users/users.routes.ts:102` |
| POST | `/api/users/gaming-stats/sync-cr` | authenticated | `src/modules/users/users.routes.ts:103` |
| POST | `/api/users/leave-requests/:requestId/approve` | authenticated | `src/modules/users/users.routes.ts:134` |
| POST | `/api/users/leave-requests/:requestId/reject` | authenticated | `src/modules/users/users.routes.ts:135` |
| GET | `/api/users/notification-settings` | authenticated | `src/modules/users/users.routes.ts:108` |
| PUT | `/api/users/notification-settings` | authenticated | `src/modules/users/users.routes.ts:109` |
| GET | `/api/users/privacy-settings` | authenticated | `src/modules/users/users.routes.ts:106` |
| PUT | `/api/users/privacy-settings` | authenticated | `src/modules/users/users.routes.ts:107` |
| DELETE | `/api/users/roster-invite/:inviteId` | authenticated | `src/modules/users/users.routes.ts:92` |
| GET | `/api/users/roster-invites` | authenticated | `src/modules/users/users.routes.ts:94` |
| POST | `/api/users/roster-invites/:inviteId/accept` | authenticated | `src/modules/users/users.routes.ts:95` |
| POST | `/api/users/roster-invites/:inviteId/decline` | authenticated | `src/modules/users/users.routes.ts:96` |
| GET | `/api/users/search` | user-or-guest | `src/modules/users/users.routes.ts:86` |
| DELETE | `/api/users/staff-invite/:inviteId` | authenticated | `src/modules/users/users.routes.ts:97` |
| GET | `/health` | public | `src/app.ts:65` |

## Socket events

| Direction | Event | Source |
|---|---|---|
| inbound | `bind-random-session` | `src/modules/legacy/legacy.socket.ts:562` |
| outbound | `broadcast_message` | `src/legacy-src/controllers/tournamentController.js:958` |
| outbound | `broadcast_message` | `src/legacy-src/controllers/tournamentController.js:967` |
| outbound | `broadcast-notification` | `src/legacy-src/utils/notificationEmitter.js:32` |
| outbound | `broadcast-push-notification` | `src/legacy-src/utils/notificationEmitter.js:45` |
| inbound | `call-accept` | `src/modules/legacy/legacy.socket.ts:927` |
| outbound | `call-accept` | `src/modules/legacy/legacy.socket.ts:927` |
| outbound | `call-accept` | `src/legacy-src/controllers/callController.js:455` |
| outbound | `call-accept` | `src/legacy-src/controllers/callSessionController.js:78` |
| inbound | `call-end` | `src/modules/legacy/legacy.socket.ts:927` |
| outbound | `call-end` | `src/modules/legacy/legacy.socket.ts:927` |
| outbound | `call-end` | `src/legacy-src/controllers/callController.js:614` |
| outbound | `call-end` | `src/legacy-src/controllers/callSessionController.js:97` |
| outbound | `call-end` | `src/legacy-src/services/callSessionService.js:78` |
| outbound | `call-end` | `src/legacy-src/services/callSessionService.js:87` |
| outbound | `call-end` | `src/modules/legacy/legacy.socket.ts:216` |
| outbound | `call-error` | `src/modules/legacy/legacy.socket.ts:749` |
| outbound | `call-error` | `src/modules/legacy/legacy.socket.ts:769` |
| outbound | `call-error` | `src/modules/legacy/legacy.socket.ts:775` |
| outbound | `call-error` | `src/modules/legacy/legacy.socket.ts:783` |
| outbound | `call-error` | `src/modules/legacy/legacy.socket.ts:800` |
| outbound | `call-error` | `src/modules/legacy/legacy.socket.ts:813` |
| outbound | `call-error` | `src/modules/legacy/legacy.socket.ts:834` |
| outbound | `call-error` | `src/modules/legacy/legacy.socket.ts:851` |
| outbound | `call-error` | `src/modules/legacy/legacy.socket.ts:948` |
| outbound | `call-error` | `src/modules/legacy/legacy.socket.ts:997` |
| outbound | `call-error` | `src/modules/legacy/legacy.socket.ts:1055` |
| outbound | `call-error` | `src/modules/legacy/legacy.socket.ts:1077` |
| outbound | `call-error` | `src/modules/legacy/legacy.socket.ts:1091` |
| outbound | `call-error` | `src/modules/legacy/legacy.socket.ts:1095` |
| outbound | `call-error` | `src/modules/legacy/legacy.socket.ts:1099` |
| outbound | `call-error` | `src/modules/legacy/legacy.socket.ts:1104` |
| outbound | `call-error` | `src/modules/legacy/legacy.socket.ts:1178` |
| outbound | `call-error` | `src/modules/legacy/legacy.socket.ts:1251` |
| outbound | `call-missed` | `src/legacy-src/services/callSessionService.js:347` |
| inbound | `call-reject` | `src/modules/legacy/legacy.socket.ts:927` |
| outbound | `call-reject` | `src/modules/legacy/legacy.socket.ts:927` |
| outbound | `call-reject` | `src/legacy-src/controllers/callController.js:526` |
| outbound | `call-reject` | `src/legacy-src/controllers/callSessionController.js:90` |
| inbound | `call-request` | `src/modules/legacy/legacy.socket.ts:735` |
| outbound | `call-request` | `src/legacy-src/controllers/callController.js:296` |
| outbound | `call-request` | `src/modules/legacy/legacy.socket.ts:861` |
| outbound | `call-session-updated` | `src/legacy-src/controllers/callController.js:44` |
| outbound | `call-session-updated` | `src/legacy-src/controllers/callSessionController.js:104` |
| outbound | `call-session-updated` | `src/legacy-src/controllers/callSessionController.js:105` |
| outbound | `call-session-updated` | `src/legacy-src/services/callSessionService.js:79` |
| outbound | `call-session-updated` | `src/legacy-src/services/callSessionService.js:88` |
| outbound | `call-session-updated` | `src/modules/legacy/legacy.socket.ts:985` |
| outbound | `call-session-updated` | `src/modules/legacy/legacy.socket.ts:987` |
| outbound | `call-session-updated` | `src/modules/legacy/legacy.socket.ts:988` |
| inbound | `call-signal` | `src/modules/legacy/legacy.socket.ts:1005` |
| outbound | `call-signal` | `src/modules/legacy/legacy.socket.ts:1062` |
| outbound | `call:answer` | `src/legacy-src/controllers/callController.js:447` |
| outbound | `call:ended` | `src/legacy-src/controllers/callController.js:607` |
| outbound | `call:offer` | `src/legacy-src/controllers/callController.js:295` |
| outbound | `call:rejected` | `src/legacy-src/controllers/callController.js:519` |
| outbound | `chat:error` | `src/modules/chat/chat.socket.ts:159` |
| outbound | `chat:error` | `src/modules/chat/chat.socket.ts:185` |
| outbound | `chat:error` | `src/modules/chat/chat.socket.ts:192` |
| outbound | `connection-matched` | `src/legacy-src/controllers/randomConnectController.js:1547` |
| outbound | `connection-matched` | `src/legacy-src/controllers/randomConnectionController.js:186` |
| outbound | `connection-matched` | `src/legacy-src/controllers/randomConnectionController.js:187` |
| outbound | `connection-matched` | `src/legacy-src/controllers/randomConnectionController.js:191` |
| outbound | `connection-matched` | `src/legacy-src/controllers/randomConnectionController.js:197` |
| outbound | `connection-matched` | `src/legacy-src/controllers/randomConnectionController.js:227` |
| outbound | `connection-matched` | `src/legacy-src/controllers/randomConnectionController.js:228` |
| outbound | `connection-matched` | `src/legacy-src/controllers/randomConnectionController.js:233` |
| outbound | `connection-matched` | `src/legacy-src/controllers/randomConnectionController.js:234` |
| outbound | `connection-matched` | `src/legacy-src/controllers/randomConnectionController.js:247` |
| outbound | `connection-matched` | `src/legacy-src/controllers/randomConnectionController.js:248` |
| outbound | `connection-matched` | `src/legacy-src/controllers/randomConnectionController.js:608` |
| outbound | `connection-matched` | `src/legacy-src/controllers/randomConnectionController.js:609` |
| outbound | `connection-matched` | `src/legacy-src/controllers/randomConnectionController.js:743` |
| outbound | `connection-matched` | `src/legacy-src/controllers/randomConnectionController.js:744` |
| outbound | `connection-matched` | `src/legacy-src/controllers/randomConnectionControllerNew.js:96` |
| outbound | `connection-matched` | `src/legacy-src/controllers/randomConnectionControllerNew.js:97` |
| inbound | `disconnect` | `src/infrastructure/websocket/socket.ts:175` |
| inbound | `disconnect` | `src/modules/legacy/legacy.socket.ts:1267` |
| outbound | `follow-request-updated` | `src/legacy-src/controllers/userController.js:999` |
| outbound | `group-call-ended` | `src/modules/legacy/legacy.socket.ts:509` |
| outbound | `group-call-ended` | `src/modules/legacy/legacy.socket.ts:510` |
| outbound | `group-call-incoming` | `src/modules/legacy/legacy.socket.ts:1153` |
| inbound | `group-call-join` | `src/modules/legacy/legacy.socket.ts:1168` |
| outbound | `group-call-joined` | `src/modules/legacy/legacy.socket.ts:1131` |
| outbound | `group-call-joined` | `src/modules/legacy/legacy.socket.ts:1221` |
| inbound | `group-call-leave` | `src/modules/legacy/legacy.socket.ts:1261` |
| outbound | `group-call-not-found` | `src/modules/legacy/legacy.socket.ts:1174` |
| outbound | `group-call-participant-joined` | `src/modules/legacy/legacy.socket.ts:1228` |
| outbound | `group-call-participant-left` | `src/modules/legacy/legacy.socket.ts:523` |
| outbound | `group-call-participant-left` | `src/modules/legacy/legacy.socket.ts:529` |
| inbound | `group-call-request` | `src/modules/legacy/legacy.socket.ts:1084` |
| inbound | `group-call-signal` | `src/modules/legacy/legacy.socket.ts:1237` |
| outbound | `group-call-signal` | `src/modules/legacy/legacy.socket.ts:1254` |
| outbound | `groupInfoUpdated` | `src/legacy-src/controllers/messageController.js:1771` |
| outbound | `groupInfoUpdated` | `src/legacy-src/controllers/messageController.js:1777` |
| outbound | `groupMemberRoleUpdated` | `src/legacy-src/controllers/messageController.js:2204` |
| outbound | `groupMemberRoleUpdated` | `src/legacy-src/controllers/messageController.js:2205` |
| outbound | `groupPermissionsUpdated` | `src/legacy-src/controllers/messageController.js:3085` |
| outbound | `invite_status_updated` | `src/legacy-src/controllers/messageController.js:2394` |
| outbound | `invite_status_updated` | `src/legacy-src/controllers/messageController.js:2398` |
| inbound | `join-chat-room` | `src/modules/chat/chat.socket.ts:148` |
| inbound | `join-random-queue` | `src/modules/legacy/legacy.socket.ts:546` |
| inbound | `join-random-room` | `src/modules/legacy/legacy.socket.ts:596` |
| inbound | `join-user-room` | `src/infrastructure/websocket/socket.ts:152` |
| inbound | `leave-chat-room` | `src/modules/chat/chat.socket.ts:163` |
| inbound | `leave-random-queue` | `src/modules/legacy/legacy.socket.ts:555` |
| inbound | `leave-random-room` | `src/modules/legacy/legacy.socket.ts:621` |
| inbound | `media-state` | `src/modules/legacy/legacy.socket.ts:716` |
| outbound | `media-state` | `src/modules/legacy/legacy.socket.ts:732` |
| outbound | `memberLeft` | `src/legacy-src/controllers/messageController.js:2768` |
| outbound | `memberRemoved` | `src/legacy-src/controllers/messageController.js:2029` |
| outbound | `message_deleted` | `src/legacy-src/controllers/messageController.js:2562` |
| outbound | `message_deleted` | `src/legacy-src/controllers/messageController.js:2563` |
| outbound | `message_deleted` | `src/legacy-src/controllers/messageController.js:2661` |
| outbound | `message_reaction` | `src/legacy-src/controllers/messageController.js:1625` |
| outbound | `message_reaction` | `src/legacy-src/controllers/messageController.js:1627` |
| outbound | `message_reaction` | `src/legacy-src/controllers/messageController.js:1628` |
| outbound | `new-notification` | `src/legacy-src/utils/notificationEmitter.js:21` |
| outbound | `new-notification` | `src/legacy-src/utils/notificationEmitter.js:366` |
| outbound | `newMessage` | `src/legacy-src/controllers/callController.js:647` |
| outbound | `newMessage` | `src/legacy-src/controllers/messageController.js:389` |
| outbound | `newMessage` | `src/legacy-src/controllers/messageController.js:1293` |
| outbound | `newMessage` | `src/legacy-src/controllers/messageController.js:1755` |
| outbound | `newMessage` | `src/legacy-src/controllers/messageController.js:1907` |
| outbound | `newMessage` | `src/legacy-src/controllers/messageController.js:2024` |
| outbound | `newMessage` | `src/legacy-src/controllers/messageController.js:2185` |
| outbound | `newMessage` | `src/legacy-src/controllers/messageController.js:2373` |
| outbound | `newMessage` | `src/legacy-src/controllers/messageController.js:2764` |
| outbound | `newMessage` | `src/legacy-src/controllers/messageController.js:2925` |
| outbound | `newMessage` | `src/legacy-src/controllers/messageController.js:2930` |
| outbound | `newMessage` | `src/legacy-src/controllers/messageController.js:3109` |
| outbound | `newMessage` | `src/legacy-src/controllers/messageController.js:3260` |
| outbound | `newMessage` | `src/legacy-src/controllers/messageController.js:3347` |
| outbound | `newMessage` | `src/legacy-src/controllers/recruitmentController.js:189` |
| outbound | `newMessage` | `src/modules/chat/chat.socket.ts:190` |
| outbound | `newMessage` | `src/modules/legacy/legacy.socket.ts:474` |
| outbound | `partner-disconnected` | `src/legacy-src/controllers/randomConnectController.js:1587` |
| outbound | `partner-disconnected` | `src/legacy-src/controllers/randomConnectController.js:1875` |
| outbound | `partner-disconnected` | `src/legacy-src/controllers/randomConnectController.js:1941` |
| outbound | `partner-disconnected` | `src/legacy-src/controllers/randomConnectController.js:2168` |
| outbound | `partner-disconnected` | `src/legacy-src/controllers/randomConnectionController.js:333` |
| outbound | `partner-disconnected` | `src/legacy-src/controllers/randomConnectionController.js:501` |
| outbound | `partner-disconnected` | `src/legacy-src/controllers/randomConnectionController.js:922` |
| outbound | `partner-disconnected` | `src/legacy-src/controllers/randomConnectionController.js:1021` |
| outbound | `partner-disconnected` | `src/legacy-src/controllers/randomConnectionControllerNew.js:154` |
| outbound | `partner-disconnected` | `src/legacy-src/controllers/randomConnectionControllerNew.js:310` |
| outbound | `partner-disconnected` | `src/legacy-src/controllers/randomConnectionControllerNew.js:368` |
| inbound | `ping` | `src/infrastructure/websocket/socket.ts:164` |
| outbound | `pong` | `src/infrastructure/websocket/socket.ts:164` |
| outbound | `premium-entitlement-changed` | `src/legacy-src/services/premiumMembershipService.js:356` |
| outbound | `presence:snapshot` | `src/modules/presence/presence.socket.ts:89` |
| inbound | `presence:subscribe` | `src/modules/presence/presence.socket.ts:42` |
| inbound | `presence:unsubscribe` | `src/modules/presence/presence.socket.ts:98` |
| outbound | `presence:updated` | `src/legacy-src/utils/presencePrivacy.js:21` |
| outbound | `presence:updated` | `src/legacy-src/utils/presencePrivacy.js:37` |
| outbound | `presence:updated` | `src/modules/presence/presence.socket.ts:111` |
| outbound | `presence:updated` | `src/modules/presence/presence.socket.ts:131` |
| outbound | `privacy-settings-updated` | `src/legacy-src/utils/presencePrivacy.js:13` |
| outbound | `privacy-settings-updated` | `src/legacy-src/utils/presencePrivacy.js:14` |
| outbound | `profile-updated` | `src/legacy-src/controllers/userController.js:1905` |
| outbound | `profile-updated` | `src/legacy-src/controllers/userController.js:1989` |
| outbound | `profile-updated` | `src/legacy-src/controllers/userController.js:3819` |
| inbound | `random-connection-message` | `src/modules/legacy/legacy.socket.ts:640` |
| outbound | `random-connection-message` | `src/legacy-src/controllers/randomConnectController.js:2109` |
| outbound | `random-connection-message` | `src/legacy-src/controllers/randomConnectController.js:2112` |
| outbound | `random-connection-message` | `src/legacy-src/controllers/randomConnectionController.js:829` |
| outbound | `random-connection-message` | `src/modules/legacy/legacy.socket.ts:652` |
| outbound | `random-session-bound` | `src/modules/legacy/legacy.socket.ts:593` |
| outbound | `random-session-ended` | `src/legacy-src/controllers/randomConnectController.js:245` |
| outbound | `random-session-ended` | `src/legacy-src/controllers/randomConnectController.js:342` |
| outbound | `random-session-ended` | `src/legacy-src/controllers/randomConnectController.js:1881` |
| outbound | `random-session-ended` | `src/legacy-src/controllers/randomConnectController.js:1949` |
| outbound | `random-session-ended` | `src/legacy-src/controllers/randomConnectController.js:2174` |
| outbound | `random-session-error` | `src/modules/legacy/legacy.socket.ts:585` |
| outbound | `random-session-error` | `src/modules/legacy/legacy.socket.ts:606` |
| outbound | `random-session-error` | `src/modules/legacy/legacy.socket.ts:633` |
| outbound | `random-session-error` | `src/modules/legacy/legacy.socket.ts:649` |
| outbound | `random-session-error` | `src/modules/legacy/legacy.socket.ts:672` |
| outbound | `random-session-error` | `src/modules/legacy/legacy.socket.ts:691` |
| inbound | `random-session-ready` | `src/modules/legacy/legacy.socket.ts:627` |
| outbound | `random-session-ready` | `src/legacy-src/controllers/randomConnectController.js:432` |
| outbound | `random-session-timer-started` | `src/legacy-src/controllers/randomConnectController.js:464` |
| outbound | `random-session-timer-sync` | `src/legacy-src/controllers/randomConnectController.js:471` |
| outbound | `random-session-timer-sync` | `src/modules/legacy/legacy.socket.ts:618` |
| outbound | `random-session-timer-warning` | `src/legacy-src/controllers/randomConnectController.js:306` |
| outbound | `rejoined-queue` | `src/legacy-src/controllers/randomConnectionController.js:617` |
| outbound | `rejoined-queue` | `src/legacy-src/controllers/randomConnectionController.js:774` |
| outbound | `room-joined` | `src/modules/legacy/legacy.socket.ts:613` |
| inbound | `send-message` | `src/modules/chat/chat.socket.ts:179` |
| outbound | `team_membership_updated` | `src/legacy-src/controllers/messageController.js:2423` |
| outbound | `team_membership_updated` | `src/legacy-src/controllers/messageController.js:2424` |
| outbound | `tournament_updated` | `src/legacy-src/controllers/tournamentController.js:883` |
| outbound | `tournament_updated` | `src/legacy-src/controllers/tournamentController.js:920` |
| inbound | `typing-start` | `src/modules/chat/chat.socket.ts:209` |
| inbound | `typing-stop` | `src/modules/chat/chat.socket.ts:210` |
| outbound | `user-joined-room` | `src/modules/legacy/legacy.socket.ts:614` |
| outbound | `user-stopped-typing` | `src/modules/chat/chat.socket.ts:138` |
| outbound | `user-typing` | `src/modules/chat/chat.socket.ts:138` |
| inbound | `video-state-change` | `src/modules/legacy/legacy.socket.ts:700` |
| outbound | `video-state-change` | `src/modules/legacy/legacy.socket.ts:709` |
| inbound | `webrtc-request-offer` | `src/modules/legacy/legacy.socket.ts:682` |
| outbound | `webrtc-request-offer` | `src/modules/legacy/legacy.socket.ts:694` |
| inbound | `webrtc-signal` | `src/modules/legacy/legacy.socket.ts:660` |
| outbound | `webrtc-signal` | `src/modules/legacy/legacy.socket.ts:675` |

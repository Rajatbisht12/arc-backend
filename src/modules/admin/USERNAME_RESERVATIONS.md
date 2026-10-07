# Reserved Usernames

The Admin Panel manages reservations at `/reserved-usernames` (or `/admin/reserved-usernames` on the main host). Only admin tokens with `users:read` may list them; `users:manage` is required to reserve or remove them. Each action is written to the existing Admin audit log.

`UsernameRegistry` is a single normalized namespace for both live user claims and admin reservations. Its unique `normalizedUsername` index prevents a reservation from racing successfully with a new signup or rename. The canonical key uses the existing username rule: whitespace stripped, ASCII letters/digits/underscores only, 3–20 characters, then lowercase. An already-used name is rejected without changing the account.

Production disables automatic index creation. `deploy.sh` invokes the read-only registry audit before the mutating preflight, creates/verifies the index and backfills existing user claims before the new service receives traffic, then reconciles again after the rolling deployment. A case-insensitive collision between existing accounts or a conflicting registry row fails the audit for manual review. Do not bypass it or remove an account automatically.

For manual local environments with `MONGODB_URI` configured:

```sh
npm run audit:username-registry
npm run migrate:username-registry
npm run verify:username-registry
```

No new names are automatically reserved by this migration. The prior built-in protected names remain protected by backend policy, including `SquadHunt`. The official system account's `isSystemAccount`/`userType` security designation is independent of an admin reservation. Removing a reservation for a built-in protected name does not make that built-in name claimable.

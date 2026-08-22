# Clash Royale player-stat sync

The Mobile and Web clients call the authenticated SquadHunt endpoint:

```text
POST /api/users/gaming-stats/sync-cr
{ "playerTag": "#ABC123DEF" }
```

Only the backend calls Supercell. It uses:

```text
GET https://api.clashroyale.com/v1/players/%23ABC123DEF
Authorization: Bearer <server token>
```

## Production configuration

1. Give the backend a stable public outbound IP (for AWS ECS, normally a NAT
   Gateway with an Elastic IP).
2. Create a Clash Royale API token at `https://developer.clashroyale.com` with
   that outbound IP in its allowlist.
3. Store the token as `CLASH_ROYALE_API_TOKEN` in the `arc/prod/backend` AWS
   Secrets Manager JSON object. `CLASH_ROYALE_API_KEY` remains a compatibility
   alias.
4. Restart/deploy the ECS service so the secret is reloaded.

Do not put the token in Expo configuration, React Native source, Web source, or
version control. An ALB's public address is an inbound address and is not the
ECS task's outbound address.

An official API `401` or `403` means the server token is invalid or the request
did not originate from an allowlisted IP. It is not a player-tag validation
error. A missing player is returned separately as `404 PLAYER_NOT_FOUND`.

# Windows-local worker8 signing-key check

This package makes the reviewed check available to the original Windows signing
laptop through Git. It does not change the application, worker image, AWS resources
or deployed configuration. Importing it makes no provider call.

The standalone script checks the existing signer at:

`%LOCALAPPDATA%\SquadHuntRelease\worker-rollout-r2-signing`

It verifies the directory/private-file owner-only Windows ACLs, derives the expected
Ed25519 public fingerprint and signs/verifies a local domain-separated test in
memory. Its JSON output contains public hashes and booleans only. The private key
and test signature are not exported. It signs no OBSERVE/DRAIN request. The bundled
historical ACL library contains setup helpers, but this check exposes only inspection
and its CLI accepts only an approval timestamp; it cannot select key initialization
or ACL modification.

Expected canonical public-key fingerprint:
`f7aa9f7c9e4e080aa76159114cded44fdb86782f9d6545a120a905487142a603`

Exact reviewed script byte SHA256:
`28b99e6209b0b7c8a253bd70b18a9321fdc0df1ebdfe2a224a2c21b0b680e29d`

## Fetch on Windows

Use Git Bash in the existing LocalAppData release directory:

```bash
cd /c/Users/bisra/AppData/Local/SquadHuntRelease &&
git clone --depth 1 --single-branch \
  --branch release/hls-worker8-key-check-r1-20261104 \
  --config core.autocrlf=false \
  https://github.com/vortica-labs/arc-backend.git \
  hls-worker8-key-check-r1-20261104
```

Cloning downloads source only. It does not inspect or execute the signing key.
No npm install, Docker, deploy.sh or application command is needed.

## Execute only within an approved window

The release operator supplies the exact hash-checked invocation with the actual
approval timestamp after an operation-specific decision. Do not substitute the
current time, extend the decision, or execute solely because this PR was merged.
The script requires a decision age under30minutes and rejects a future timestamp.
The previously issued window ends at01:00IST on4November2026; this PR does not renew it.

The one-use journal must not exist:
`%LOCALAPPDATA%\SquadHuntRelease\hls-worker8-key-binding-r1-20261104-consumed`

On success, paste only the JSON receipt into the release conversation. On HOLD or
unknown outcome retain the journal and report that result; do not rerun, delete
journals, recreate keys, adjust ACLs, change owners or use another key. This package
contains no private key, credentials, application media or production approval receipt.

## Local validation

```bash
node --test release-tools/hls-worker8-local-key-check-r1/check.test.cjs
```

Tests cover exact source bytes, exports, in-memory proof, CLI argument/deadline
rejection and the non-Windows guard. Windows ACLs and possession of the real key
remain native laptop checks; local tests do not qualify signed worker transport,
OBSERVE/DRAIN, two-worker encoding or autoscaling.

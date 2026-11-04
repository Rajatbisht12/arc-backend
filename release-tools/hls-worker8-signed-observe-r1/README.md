# Bounded Windows-local worker OBSERVE signer

Source transport only. Do not merge or deploy this PR as an application release. These files do nothing on import. They do not generate, upload or modify the existing worker signing key.

Run only the fresh commit/hash/task-bound command supplied by Codex after the exact combined relay/signing approval. The command uses this existing laptop's Node and AWS CLI2/default profile; no npm install, Docker build or credential sharing. No standalone approval timestamp should be invented or extended.

The signer validates the original LocalAppData/SquadHuntRelease/worker-rollout-r2-signing directory/private-file ACLs, public fingerprint and key pair. New run artifacts are protected in a separate nonsynced owner-only directory. Original key and ACLs stay unchanged. No private key is passed to AWS or printed.

It verifies the actual new helper's short-lived mailbox challenge, signs exactly two OBSERVE envelopes (expired/valid), and conditionally writes one encrypted command object. No DRAIN, worker HTTP request, deployment, scaling or media operation is performed by Windows. Signed envelopes remain only in protected local files/private encrypted mailbox; never paste them or commit them. Return only the final safe JSON receipt. A published command is not proof of worker acceptance; Codex separately verifies the native helper result.

One-use journal, bounded polling, strict identity/deadline/counters and no retries after unknown outcomes. Any HOLD must be reported without rerunning or changing accounts, ACLs, keys or timestamps. Retain artifacts until separately authorized cleanup. Missing/expired challenge stops before key access. Future native qualifications require fresh scopes; this client cannot be repurposed to sign DRAIN or another task.

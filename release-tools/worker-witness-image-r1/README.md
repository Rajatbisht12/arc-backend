# Witness-only worker image candidate — no deployment

This carrier builds/pushes only a new, separately approved ECR tag. Do not merge it for an application release or run deploy.sh. No ECS, DB, Redis, signing key, upload, Post, network, IAM, admission or scaling action is included. The currently running worker8 image is untouched.

The source archive supplies760 application files plus its manifest. All759 other file records match the frozen worker8 archive; only clipHlsProcessing.js restores four process-witness hooks. Encoder flags, dependencies and current application features remain unchanged. Source/manifest hashes define application provenance; the Git carrier commit labels packaging only. This candidate is not native loaded-work proof.

Run only with the fresh exact external approval and absent one-use journal on the existing Windows Docker laptop. Require the existing local desktop-linux named-pipe builder; do not create or change it. Three AWS attempts only: exact-account STS, positive new-tag absence and authentication. One build/push and one registry-index read. No retry after unknown acknowledgement, alternate tag/builder, cleanup or rollout.

The private Ed25519 signing key is not used, read or exported. Publish only after the owner separately approves this exact build scope. Worker image replacement, qualification jobs, DRAIN, service capacity and autoscaling need subsequent exact approvals.

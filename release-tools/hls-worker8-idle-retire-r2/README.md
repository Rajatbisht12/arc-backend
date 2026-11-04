# Bounded old-worker retirement signer — source only

Do not run this tool without a fresh exact owner approval and the command generated for the independently verified running helper. This source PR does not authorize AWS writes, signatures or worker retirement. Do not merge it for production.

The original Ed25519 key stays under LocalAppData/SquadHuntRelease/worker-rollout-r2-signing on its original Windows laptop. The tool verifies its existing owner-only ACLs, public fingerprint and possession without changing key permissions or exporting the private key.

Only the exact old worker8 task/process can be signed: operational OBSERVE, one DRAIN, and one optional reconciliation OBSERVE. Three short-lived envelopes have distinct nonces. The new worker9 is never a signing target. The helper validates fresh envelopes and current idle/protection/consumer conditions before the single DRAIN. Existing worker protocol fences intake, waits for owned processing and closes its consumer before protection release. Unknown outcomes stop control writes; never resend DRAIN.

AWS access is limited by code to STS plus the one new dedicated challenge object and three conditional AES256 command-object puts. Commands are published reconcile, drain, then observe; observe is the last commit marker. Commands and envelopes stay in protected Windows files and private S3. Paste only the final safe JSON receipt into chat. Do not paste command-body files or key material.

One-use new Windows journal: hls-worker8-idle-retire-r2-20261105-signer-consumed. Keep prior journals and consumed OBSERVE objects unchanged. An existing journal or any HOLD/unknown result forbids rerun, deletion, alternate prefix or automatic cleanup.

The source-defined idle/consumer-close proof is separate from independent operating-system FFmpeg or Redis/Mongo lease absence: worker8's known missing hooks cannot establish these. This retirement is not loaded-DRAIN, two-encode overlap or autoscaling qualification. No service update, manual stop, protection-clear API, queue change, new job or media operation is performed by Windows.

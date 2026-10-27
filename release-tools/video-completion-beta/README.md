# Build-only completion/recovery candidate

This package contains the deployed frozen backend plus the exact reviewed completion tracing, optional durable push deferral, and canonical publication recovery overlay. It does not deploy anything.

The source candidate includes seven runtime-file changes. See `candidate.json` for per-file before/after hashes. The original `release-tools/video30-beta/backend.zip` remains unchanged.

On the Docker laptop, from a clean checkout containing this package:

```sh
node release-tools/video-completion-beta/prepare-image.cjs --preview-only
node release-tools/video-completion-beta/prepare-image.cjs --build-only
```

The helper verifies every extracted source file, builds Linux/amd64, checks image labels, and executes a network-disabled compiled runtime import check. It performs zero image pushes, AWS mutations or deployments. It requires committed release inputs; it never builds the laptop's unrelated application worktree.

Return the final build receipt. Its local image ID is not an ECR registry digest. Image publication and API/worker deployment need separate approvals after verification. Do not run `deploy.sh` for this build-only step.

Both new capabilities default off in application code:

- `VIDEO_COMPLETION_TRACE_ENABLED`
- `POST_VIDEO_DEFER_PUSH_ENABLED`

No task definition or environment change is made by building. The deployed rollback remains API215/worker4 at OCI index `sha256:7be56ae459ab16b6163ff4420fe16f2784f4776edbf01bd4a7373046b8921f7a`. No schema/index change is included. Existing xyz-only access and one-worker capacity must remain unchanged unless separately approved.

Local evidence: exact packaged source passes TypeScript/runtime imports, 10 completion/outbox tests, 41 recovery/publication tests, 2 task-protection tests and 6 upload tests. The four real-FFmpeg local measurements include immediate intercepted provider responses and an injected 10-second delay. They do not prove the historical AWS delay's exact cause or live Fargate recovery.

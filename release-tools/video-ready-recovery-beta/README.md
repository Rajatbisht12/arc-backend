# READY acknowledgement recovery repair — build only

This candidate changes one runtime file: videoUploadService.js. Error cleanup
requires a confirmed conditional FAILED transition before deleting an attempt's
output prefix. Unknown write outcomes preserve files; READY publication remains
recoverable. One existing test now verifies deferred ownership-checked cancelled
cleanup. No FFmpeg, API contract, schema/index, private delivery, quota or flag
change is included. The archive derives from the published API219 source so its
acknowledgement compatibility repair is preserved. A later exact worker-only
release is proposed; API219 and worker6 remain deployed now.

Use a clean dedicated Git worktree on the Docker laptop, preserving main edits:

1. Fetch the separately approved build-handoff branch/commit.
2. Create a detached clean worktree at that exact commit.
3. Run `node release-tools/video-ready-recovery-beta/prepare-image.cjs --build-only`.
4. Return the final build receipt and local image/index ID.

The helper pins the source ZIP/content, validates755 files, uses linux/amd64,
performs a no-network compiled-runtime import smoke check, and records a receipt.
`--preview-only` verifies packaging without Docker. No deploy.sh, image push,
AWS helper/service/task registration, migration or new QA workload is performed.

No new image digest exists until Docker builds. ECR publication and worker-only
cutover/drain/rollback each require separate exact approvals. The previous
staging, release and experiment allowances cannot be reused.

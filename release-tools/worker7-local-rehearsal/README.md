# Worker7 local Linux rehearsal

This runs the pinned worker7 image on a Docker laptop with isolated, authenticated local MongoDB8 and Redis7 sidecars. It has no AWS credentials, production connections, published host ports or outbound container network. It creates no AWS resources and sends no push notification. AWS remains unchanged.

The 20 fault cases use local storage/stage adapters and accelerated fixture leases. A separate 21st case uses the approved portrait source and the actual frozen FFmpeg encoder, producing and decoding HLS/MP4 files locally. This is **not** DocumentDB5, S3, natural live lease, ECS replacement or AWS crash-recovery proof.

Extract a fresh bundle into a local directory outside OneDrive synchronization if possible. Keep all files together. Run `node handoff.cjs --check`. The only source fixture is the included 5,939,073-byte approved synthetic portrait, whose SHA256 is checked again inside the container. These local-only passwords are not live credentials.

Pull the exact worker7 image using your existing ECR login on the host. If a login is needed, in Git Bash use:

```sh
aws ecr get-login-password --profile default --region us-east-1 | docker login --username AWS --password-stdin 906446637180.dkr.ecr.us-east-1.amazonaws.com
docker pull --platform linux/amd64 906446637180.dkr.ecr.us-east-1.amazonaws.com/arc-backend@sha256:144b96e60256405280f77b29269595e04ff18ae5561310b87171d35bd7c04f1f
node handoff.cjs --run-local
```

Login/pull occur on the host only. Do not mount `.aws`, a Docker socket, app secrets or any additional environment file. The helper verifies the bundle and image, starts a unique local Compose project in detached mode, binds the exact runner container, waits for its actual exit, and removes only that project’s containers/network afterward. Every subprocess status/signal/error code is saved in `results/orchestration.json`; zero runner exit, valid raw test evidence and positive cleanup absence are required. MongoDB/Redis data are disposable tmpfs, with no cloud data. Leave at least 6 GiB of Docker memory available.

Keep `results/receipt.json` and `results/rehearsal.log`. A nonzero exit or incomplete receipt is a failure to investigate. Do not replace a failed result: extract a fresh bundle directory for another rehearsal. Share the final receipt; a successful receipt is still local Linux evidence only. Do not run deploy.sh, push another image, start an AWS helper or execute either live experiment from this bundle.

The runner is capped at ten minutes. The host execution deadline is fifteen minutes, followed by at most three minutes of bounded cleanup/absence checks. If Docker itself becomes unresponsive, inspect the exact `worker7-local-<random>` project printed in Docker output and stop only its containers; never use global Docker cleanup commands.

If an older launcher reported failure after printing 21 passing tests, preserve that worktree and its results. From a fresh corrected checkout, run:

```sh
node release-tools/worker7-local-rehearsal/handoff.cjs --verify-results ../arc-worker7-local-rehearsal-lf-20261028/release-tools/worker7-local-rehearsal/results
```

This mode reads the existing receipt and raw log only: no Docker invocation, container creation, encode, network request or AWS call. It verifies exact source/fixture identity, Linux/x64, all 21 TAP cases, the raw log SHA256 and the real encoder evidence. Its result proves the local tests; it does not retroactively declare the old launcher successful or establish cloud recovery. Preserve the original nonzero launcher outcome and any remaining orchestration uncertainty.

# Build-only notification outbox beta candidate

This folder contains a frozen derivative of the deployed completion candidate, with only the seven runtime push changes and four local-test files listed in candidate.json. It never packages the surrounding dirty worktree. No FFmpeg, HLS, MP4, private-playback or native/Web source changed.

On the Docker laptop, after the feature branch is separately approved and pushed:

```sh
git fetch origin
git switch release/push-outbox-beta-build-20261027
node release-tools/push-outbox-beta/prepare-image.cjs --build-only
```

Use a clean checkout. The helper validates the complete source manifest, builds Linux/amd64, and runs a network-disabled runtime-import smoke check. Send the final build receipt back. It does not publish an image or deploy AWS. Do not use deploy.sh for this handoff; the exact service release requires the resulting immutable registry digest and separate approval.

Current local evidence: 21 isolated push fault-injection cases, 41 publication/recovery regressions, 11 completion/trace checks including the actual local synthetic-FFmpeg benchmark; 58 native background and 41 native push checks plus TypeScript. Expo is intercepted in local tests. These are not new live device-delivery results.

Proposed deployment: API dispatch mode direct, worker dispatch mode outbox_only, existing one API/one encoder, xyz-only upload access, same IAM/network/data/index configuration. No release is authorized by this folder. An old ambiguous provider acknowledgement is terminal, not automatically resent; records and canonical Post identity are preserved.

# Worker rollout R2: isolated source proposal, deployment blocked

This branch preserves the published worker image; it changes no worker source,
dependency, Dockerfile or source ZIP. It adds three dispatch selectors to the
existing deploy.sh, before its original compatibility branch:

* `worker-rollout-key-init`: local Ed25519 signer preparation only.
* `worker-rollout-r2-plan`: reports missing bindings, zero provider calls.
* `worker-rollout-r2-create`: guarded change-set creation/readback only after a
  future exact approval, clean merged source and sealed fresh native preflight.

There is **no rollout execute selector** while native retirement/transport/fault
bindings are missing. Do not run plain deploy.sh or present create mode as a
deployment. Its original API, financial/schema/topology preflights stay byte-identical;
they are not invoked or relabeled PASS by the isolated worker path.

Local checks: `node --test scripts/worker-rollout-r2.test.js`; `bash -n deploy.sh`.
The test suite includes actual local HTTP against the exact published worker
control implementation. It does not qualify AWS network/IAM/Fargate behavior.

After review/merge and exact clean pull on the usual Windows Docker laptop, a
future local key step can use a NEW directory beneath LocalAppData (not OneDrive):

```bash
export WORKER_CONTROL_KEY_DIRECTORY="$LOCALAPPDATA/SquadHuntRelease/worker-rollout-r2-signing"
SQUADHUNT_RELEASE_KIND=worker-rollout-key-init bash deploy.sh
```

This command is documentation only and was not executed during preparation. If
the parent directory is absent create that parent first; never reuse/overwrite a
key directory. Windows calls whoami/icacls to remove inherited access and grant
the current SID, then independently checks Get-Acl on both directory/private file,
ownership, allow/deny entries, reparse state and the actual public/private key pair.
It holds without a success receipt on any mismatch. POSIX requires0700/0600. Native Windows
ACL behavior still needs actual deployment-laptop qualification; local tests ran
on macOS. Keep control-private.pem on that laptop outside sync/source/journal;
share only control-public.json. No cloud secret, IAM credential or Google key is
created. Only ephemeral unit-test signers were generated locally and removed.

The standalone `scripts/lib/worker-control-key-local-r2.js` supports provider-free
`init` and `check` without running deploy.sh, Docker or any repository helper.
Use a NEW child directory under LocalAppData/SquadHuntRelease, never a synced
checkout. It emits only the public key/receipt and ACL booleans. Existing key
directories and partial failures are not overwritten or automatically retried.
The private file must remain on the deployment laptop. The powershell script is
fixed/encoded, uses LiteralPath, and never changes the host execution policy.

Render the candidate from the exact native-matching worker-template-before.json
and the real public receipt. All other template resources must stay unchanged.
The task inherits revision7's command/health/logging/roles/ladder/private settings,
2vCPU/4GiB/40GiB/concurrency1. It uses published indexffff2101… and amd64child0e0c1b9a…,
protection/R4 control enabled and120minute lease. No revision/task ARN is predicted.
The unbound JSON is intentionally not registerable.

The future create scope must pin actual merged revision and every source byte,
real public key, a separately reviewed fresh native preflight receipt and exact
request hash. The receipt must positively bind the applied IAM policy, current
worker template/parameters/service7, original role ownership and absent set name.
The pure test fixture cannot fill that requirement. Creation allows one caller
read, one CreateChangeSet, up to six5second exact status reads and one returned
template read; no execute/IAM/ECS/build/data operation. Unknown acknowledgement
holds without resubmission. Retain unexecuted change set and one-use external journal.
The R2 read-only transport scope is a separate coding-machine package, not a
worker-change preflight or proof of accepted-work safety.

Worker execution still needs actual change-plan approval, qualified owned queue
pause and old-worker natural retirement, private probe routing and fault/rollback
protocol. Booleans in a receipt are trusted only as part of a separately reviewed
exact native evidence chain; this library is not remote attestation or a queue
collector. Source hashes alone do not make a receipt native.

`worker-control-client-r2.js` signs OBSERVE/DRAIN on the laptop, validates private
literal-IP origin5002 and exact task/container/boot/owner/run, rejects replay via
the worker, disallows redirects, and bounds requests/responses. Its renderProbe
function emits a standard-library-only helper for the existing image; no private
key/shared config or application role is needed in that helper. No probe task,
role/network definition or registration is authorized/sealed here. The helper
must receive exact current target/ENI/SG and expiring signed input after approval.
Challenge and each signed action may need separately bounded one-use probe tasks;
their actual count/time/cost ceilings cannot be inferred from this local renderer.

The published HTTP protocol authenticates requests, not responses cryptographically.
Response provenance additionally depends on the reviewed private ENI/route/SG and
native task/container binding. No public ALB/DNS/port exposure, arbitrary URL,
ECS Exec assumption or unauthenticated drain is permitted. An uncertain DRAIN
response is reconciled by signed OBSERVE, never a blind second DRAIN.

No automatic controller rollback, protection clear, queue resume or stop occurs
in this source package. Full deployment approval remains BLOCKED until the native
bindings and actual change-set plan are positively qualified.

type Fetch = typeof fetch;
type DrainProof = { intakeFenced: boolean; activeJobs: number; consumerClosed: boolean };
type Options = { env?: NodeJS.ProcessEnv; request?: Fetch; now?: () => number; onUnsafe?: (code: string) => Promise<unknown>; automaticTimer?: boolean };
function check(value: unknown, code: string): asserts value { if (!value) throw Error(code); }
const localEndpoint = (value: string | undefined, suffix: string) => {
  const url = new URL(value || '');
  check(url.protocol === 'http:' && ['169.254.170.2', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.username && !url.password && !url.search && !url.hash, 'ECS_LOCAL_ENDPOINT_REQUIRED');
  return url.toString().replace(/\/$/, '') + suffix;
};
/** Acquire before the consumer starts, retain through active work and idle
 * intake, and release only after a local claim fence and complete drain.
 * Protection never substitutes for BullMQ locks or durable source leases. */
export async function createVideoProtectionLease({ env = process.env, request = fetch, now = Date.now, onUnsafe, automaticTimer = true }: Options = {}) {
  check(env.ECS_AGENT_URI, 'Scale-in protection requires ECS_AGENT_URI');
  check(env.ECS_CONTAINER_METADATA_URI_V4, 'ECS_TASK_METADATA_REQUIRED');
  const endpoint = localEndpoint(env.ECS_AGENT_URI, '/task-protection/v1/state');
  const metadata = localEndpoint(env.ECS_CONTAINER_METADATA_URI_V4, '/task');
  const read = async (url: string, options: RequestInit = {}) => {
    const response = await request(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(5000) });
    const body = await response.json() as any;
    check(response.ok && !body.error && !body.failure, 'ECS_PROTECTION_RESPONSE_UNAVAILABLE'); return body;
  };
  const task = await read(metadata), arn = String(task.TaskARN || '');
  check(new RegExp('^arn:aws:ecs:' + (env.AWS_REGION || 'us-east-1') + ':' + (env.VIDEO_WORKER_EXPECTED_ACCOUNT || '906446637180') + ':task/arc-cluster/[a-f0-9]{32}$').test(arn), 'EXACT_ECS_TASK_IDENTITY_REQUIRED');
  if (env.VIDEO_WORKER_R4_CONTROL_ENABLED === 'true') {
    check(task.ServiceName === env.VIDEO_WORKER_EXPECTED_SERVICE && task.Family === env.VIDEO_WORKER_EXPECTED_FAMILY, 'EXACT_SERVICE_MANAGED_TASK_REQUIRED');
    check(Array.isArray(task.Containers) && task.Containers.filter((c: any) => c.Name === 'video-worker' && typeof c.DockerId === 'string').length === 1, 'EXACT_WORKER_CONTAINER_REQUIRED');
  }
  const minutes = Number(env.VIDEO_TASK_PROTECTION_MINUTES || 2880), reserve = 15 * 60000;
  check(Number.isSafeInteger(minutes) && minutes >= 120 && minutes <= 2880, 'BOUNDED_PROTECTION_LEASE_REQUIRED');
  const state = { taskArn: arn, protected: false, expiresAt: 0, checkedAt: 0, unsafe: true, code: 'INITIAL_PROTECTION_UNVERIFIED', released: false, releasing: false };
  let busy: Promise<void> | null = null, timer: NodeJS.Timeout | undefined;
  const observe = async (enabled: boolean) => {
    const p = (await read(endpoint)).protection;
    check(p?.TaskArn === arn && p.ProtectionEnabled === enabled, 'EXACT_PROTECTION_READBACK_REQUIRED');
    const expires = enabled ? Date.parse(p.ExpirationDate) : 0;
    check(!enabled || Number.isFinite(expires) && expires > now() + reserve && expires <= now() + minutes * 60000 + 60000, 'PROTECTION_EXPIRY_UNSAFE');
    Object.assign(state, { protected: enabled, expiresAt: expires, checkedAt: now(), unsafe: false, code: 'VERIFIED' });
  };
  const update = async (enabled: boolean) => {
    // A lost PUT acknowledgement permits one exact GET, never a second PUT.
    try { await read(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ProtectionEnabled: enabled, ...(enabled ? { ExpiresInMinutes: minutes } : {}) }) }); } catch { /* exact positive GET decides */ }
    await observe(enabled);
  };
  await update(true);
  async function renew() {
    check(!state.released && !state.releasing, 'PROTECTION_LEASE_RELEASED');
    if (busy) return busy;
    busy = (async () => {
      try { await update(true); }
      catch {
        state.unsafe = true; state.code = state.expiresAt - now() <= reserve ? 'PROTECTION_NEAR_EXPIRY_HOLD_SCALE_IN' : 'PROTECTION_RENEWAL_UNKNOWN_HOLD_SCALE_IN';
        await onUnsafe?.(state.code);
      }
    })().finally(() => { busy = null; });
    return busy;
  }
  const snapshot = () => ({ ...state, unsafe: state.unsafe || state.releasing || now() - state.checkedAt > 65000 || state.expiresAt - now() <= reserve });
  if (automaticTimer) { timer = setInterval(() => { void renew().catch(async () => { state.unsafe = true; state.code = 'PROTECTION_RENEWAL_EXCEPTION'; await onUnsafe?.(state.code); }).catch(() => { /* state remains unsafe even if the local pause callback also fails */ }); }, 60000); timer.unref(); }
  return { taskArn: arn, metadata: task, snapshot, renew,
    assertClaimsAllowed: () => check(!snapshot().unsafe && !state.released && state.protected, 'PROTECTION_NOT_CURRENT_NO_NEW_CLAIMS'),
    release: async (proof?: DrainProof) => {
      check(proof?.intakeFenced && proof.activeJobs === 0 && proof.consumerClosed, 'DRAINED_CLAIM_FENCE_BEFORE_UNPROTECT');
      check(!state.releasing && !state.released, 'PROTECTION_RELEASE_ALREADY_CONSUMED');
      state.releasing = true; if (timer) clearInterval(timer); await busy;
      try { await update(false); state.released = true; } catch { state.unsafe = true; state.code = 'PROTECTION_RELEASE_UNRESOLVED'; await onUnsafe?.(state.code); throw Error(state.code); }
    },
    stopTimer: () => { if (timer) clearInterval(timer); },
  };
}
// Compatibility helper for the old injected call surface; the actual worker
// now holds a single lease outside individual job handlers.
export async function startVideoTaskProtection(options: { env?: NodeJS.ProcessEnv; request?: Fetch; onRenewalFailure?: () => Promise<unknown> } = {}) {
  if ((options.env || process.env).VIDEO_TASK_SCALE_IN_PROTECTION_ENABLED !== 'true') return async (_proof?: DrainProof) => {};
  const lease = await createVideoProtectionLease({ ...options, onUnsafe: options.onRenewalFailure });
  // No compatibility caller may manufacture a drained proof implicitly.
  return (proof?: DrainProof) => lease.release(proof);
}

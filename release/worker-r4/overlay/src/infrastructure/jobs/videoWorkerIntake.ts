/** Local, synchronous claim fence. Redis/endpoint failure closes intake; it
 * cannot make a still-running encode fail a process-liveness probe. */
export function createVideoWorkerIntake() {
  let started = false, running = true, closing = false, redisReady = false, fatal = false, held = false, reason = 'BOOTSTRAPPING';
  const jobs = new Set<string>();
  return {
    start: () => { started = true; },
    redis: (ready: boolean) => { redisReady = ready; if (!ready) reason = 'REDIS_UNAVAILABLE'; },
    hold: (code: string) => { held = true; reason = code; },
    fatal: () => { fatal = true; reason = 'WORKER_PROCESS_FAILED'; },
    begin: (id: string) => { if (!started || !running || closing || fatal || held || !redisReady || jobs.size || jobs.has(id)) throw Error('INTAKE_FENCED_NO_ENCODE'); jobs.add(id); },
    finish: (id: string) => { if (!jobs.delete(id)) throw Error('UNKNOWN_LOCAL_JOB_COMPLETION'); },
    drain: () => { closing = true; reason = 'DRAINING'; },
    stopped: () => { running = false; },
    snapshot: () => ({ started, running, closing, fatal, held, redisReady, reason, activeJobs: jobs.size,
      live: started && !fatal && running, ready: started && running && !closing && !fatal && !held && redisReady }),
  };
}

// BullMQ emits recoverable Redis errors on the Worker as well as its client.
// Install before awaiting a connection so these errors positively fence intake.
// The pinned BullMQ QueueBase catches/logs unhandled error events; that logging
// alone is not a readiness fence. Standard EventEmitter callers also need this
// listener to avoid its unhandled-error behaviour.
export function watchVideoWorkerErrors(
  consumer: { on: (event: 'error', handler: (error: Error) => void) => unknown; pause: (doNotWaitActive?: boolean) => Promise<void> },
  intake: ReturnType<typeof createVideoWorkerIntake>,
  report: () => void = () => {},
) {
  consumer.on('error', () => {
    intake.redis(false);
    void consumer.pause(true).catch(() => {});
    report();
  });
}

export function videoWorkerHealth(intake: ReturnType<typeof createVideoWorkerIntake>, protection: () => { unsafe: boolean } | null) {
  return (url: string | undefined) => {
    const state = intake.snapshot(), lease = protection();
    const ready = state.ready && !lease?.unsafe;
    return { status: (url === '/ready' ? ready : state.live) ? 200 : 503,
      body: { live: state.live, ready, activeJobs: state.activeJobs, intakeFenced: !ready, reason: state.reason } };
  };
}

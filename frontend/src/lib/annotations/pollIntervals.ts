// Browser→server poll cadences for run dashboards.
//
// Overridable per-deployment via NEXT_PUBLIC env vars so self-hosted / sovereign
// installs can dial down chatter (the reconciler is the real liveness signal;
// these polls are just the UI catching up). Values are milliseconds.

const ms = (v: string | undefined, fallback: number): number => {
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** A run that's actively processing (running / pending) — refresh fast. */
export const ACTIVE_POLL_MS = ms(process.env.NEXT_PUBLIC_RUN_POLL_ACTIVE_MS, 5000);

/** A live run that's caught up ("watching") — refresh slowly. The reconciler
 *  re-pends it server-side; this poll only needs to notice the next cycle. */
export const WATCHING_POLL_MS = ms(process.env.NEXT_PUBLIC_RUN_POLL_WATCHING_MS, 30000);

/** Pick the cadence for a run from its current state. */
export function runPollIntervalMs(opts: { status?: string | null }): number {
  const active = opts.status === 'running' || opts.status === 'pending';
  return active ? ACTIVE_POLL_MS : WATCHING_POLL_MS;
}

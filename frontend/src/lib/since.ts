/** Time since a moment, as briefly as a clock would say it: `40s`, `5m`, `2h`, `3d`. */
export function since(iso: string | null | undefined) {
  if (!iso) return '—';
  // The backend's timestamps are UTC; some arrive without saying so.
  const utc = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`;
  const s = Math.max(0, (Date.now() - new Date(utc).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

/** Fail loudly on states the code believes impossible — a thrown invariant, not a console log. */
export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Invariant: ${msg}`);
}

// Banker's rounding (round half to even) for fractional pence -> integer pence.
// Used everywhere we collapse a `real` cost into an `integer` storage column.
// See DECISIONS.md for why this rule was chosen.
export function bankersRoundToPence(x: number): number {
  if (!Number.isFinite(x)) {
    throw new Error(`Cannot round non-finite value: ${x}`);
  }
  const floor = Math.floor(x);
  const frac = x - floor;
  if (frac < 0.5) return floor;
  if (frac > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

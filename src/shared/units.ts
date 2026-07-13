// Shared between main and renderer — kept minimal so both Vite builds can import.
export const UNITS = ['each', 'mm', 'm', 'g', 'kg', 'ml', 'L', 'cost_pool'] as const;
export type Unit = (typeof UNITS)[number];

// Pairs of units measuring the same physical thing at different scales.
// Used by the component editor to auto-convert stock & cost when you change
// a component's unit between, say, mm and m. The factor expresses how many
// of the smaller unit fit in the bigger unit.
export const UNIT_CONVERSIONS: ReadonlyArray<{
  small: Unit;
  big: Unit;
  factor: number;
}> = [
  { small: 'mm', big: 'm', factor: 1000 },
  { small: 'g', big: 'kg', factor: 1000 },
  { small: 'ml', big: 'L', factor: 1000 },
];

// If `from` and `to` are linked by a UNIT_CONVERSIONS entry, returns the
// multiplier that converts a *quantity* in `from` to a quantity in `to`.
// e.g. quantityConversionFactor('mm', 'm') = 1/1000.
export function quantityConversionFactor(from: Unit, to: Unit): number | null {
  if (from === to) return 1;
  for (const c of UNIT_CONVERSIONS) {
    if (c.small === from && c.big === to) return 1 / c.factor;
    if (c.big === from && c.small === to) return c.factor;
  }
  return null;
}

export const STOCK_MOVEMENT_REASONS = [
  'purchase',
  'production',
  'adjustment',
  'waste',
  'opening',
] as const;
export type StockMovementReason = (typeof STOCK_MOVEMENT_REASONS)[number];

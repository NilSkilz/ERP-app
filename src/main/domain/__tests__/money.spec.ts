import { describe, expect, it } from 'vitest';
import { bankersRoundToPence } from '../money.js';

describe('bankersRoundToPence', () => {
  it('rounds positive non-halves to nearest', () => {
    expect(bankersRoundToPence(1.2)).toBe(1);
    expect(bankersRoundToPence(1.7)).toBe(2);
  });

  it('rounds positive halves to nearest even', () => {
    expect(bankersRoundToPence(0.5)).toBe(0);
    expect(bankersRoundToPence(1.5)).toBe(2);
    expect(bankersRoundToPence(2.5)).toBe(2);
    expect(bankersRoundToPence(3.5)).toBe(4);
  });

  it('rounds negatives toward nearest even', () => {
    expect(bankersRoundToPence(-0.5)).toBe(0);
    expect(bankersRoundToPence(-1.5)).toBe(-2);
    expect(bankersRoundToPence(-2.5)).toBe(-2);
  });

  it('handles integers as identity', () => {
    expect(bankersRoundToPence(0)).toBe(0);
    expect(bankersRoundToPence(42)).toBe(42);
    expect(bankersRoundToPence(-7)).toBe(-7);
  });

  it('throws on non-finite', () => {
    expect(() => bankersRoundToPence(NaN)).toThrow();
    expect(() => bankersRoundToPence(Infinity)).toThrow();
  });
});

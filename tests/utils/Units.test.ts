import { formatUnits, parseUnits } from '../../src/utils/units';

// KCAL has 10 decimals and SOUL 8; the anchors are fees and deposits that real transactions
// settled at, so a conversion mistake here would misprice what a wallet shows.
describe('parseUnits', () => {
  it('converts decimal amounts into atoms exactly', () => {
    expect(parseUnits('0.00426', 10)).toBe(42_600_000n);
    expect(parseUnits('12500.010925', 10)).toBe(125_000_109_250_000n);
    expect(parseUnits('0.002', 8)).toBe(200_000n);
    expect(parseUnits('1', 8)).toBe(100_000_000n);
    expect(parseUnits('.5', 8)).toBe(50_000_000n);
    expect(parseUnits('-1.5', 2)).toBe(-150n);
    expect(parseUnits(3, 8)).toBe(300_000_000n);
    expect(parseUnits(0.25, 2)).toBe(25n);
    expect(parseUnits(7n, 8)).toBe(700_000_000n);
    expect(parseUnits('0', 0)).toBe(0n);
  });

  it('rejects amounts it cannot represent exactly', () => {
    expect(() => parseUnits('0.001', 2)).toThrow('more than 2 decimal places');
    expect(() => parseUnits('1e-7', 8)).toThrow('Not a decimal amount');
    expect(() => parseUnits('abc', 8)).toThrow('Not a decimal amount');
    expect(() => parseUnits('', 8)).toThrow('Not a decimal amount');
    expect(() => parseUnits(1e-7, 8)).toThrow('Not a decimal amount');
    expect(() => parseUnits(Number.NaN, 8)).toThrow('Not a finite amount');
    expect(() => parseUnits('1', -1)).toThrow('decimals');
  });
});

describe('formatUnits', () => {
  it('renders atoms as decimal strings without trailing zeros', () => {
    expect(formatUnits(42_600_000n, 10)).toBe('0.00426');
    expect(formatUnits(125_000_109_250_000n, 10)).toBe('12500.010925');
    expect(formatUnits(200_000n, 8)).toBe('0.002');
    expect(formatUnits(100_000_000n, 8)).toBe('1');
    expect(formatUnits(0n, 8)).toBe('0');
    expect(formatUnits(-150n, 2)).toBe('-1.5');
    expect(formatUnits(5n, 0)).toBe('5');
  });

  it('round-trips through parseUnits', () => {
    for (const atoms of [1n, 42_600_000n, 123_456_789_012_345n, -7n]) {
      expect(parseUnits(formatUnits(atoms, 10), 10)).toBe(atoms);
    }
  });
});

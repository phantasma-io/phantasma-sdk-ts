import { toWholeNumber } from '../../src/ledger/ledger-commands';
import { formatUnits } from '../../src/utils/units';

// The SDK converts atoms to a decimal string in two places on purpose, and this pins the difference
// so that neither one drifts and nobody adds a third. `toWholeNumber` is what a Ledger device shows:
// always every decimal place, so amounts line up. `formatUnits` is the general conversion and trims
// trailing zeros. Both are exact, because neither goes through a floating-point number. The test
// below
// says so by deriving one from the other.
describe('atom-to-decimal conversion, device display versus general purpose', () => {
  it('keeps every decimal place a device column needs', () => {
    expect(toWholeNumber('0', 8)).toBe('0.00000000');
    expect(toWholeNumber('7', 8)).toBe('0.00000007');
    expect(toWholeNumber('100000000', 8)).toBe('1.00000000');
    expect(toWholeNumber('12345', 2)).toBe('123.45');
  });

  it('stays exact past the range a number can hold', () => {
    // 1.2345678901234567890123456789e29 atoms: a `number` loses the low digits of this long before
    // the decimal point is placed, which is why the conversion is done on the digits themselves.
    expect(toWholeNumber('123456789012345678901234567890', 10)).toBe(
      '12345678901234567890.1234567890'
    );
  });

  it('agrees with formatUnits on the value, differing only in trailing zeros', () => {
    for (const [atoms, decimals] of [
      [0n, 8],
      [7n, 8],
      [42_600_000n, 10],
      [100_000_000n, 8],
      [1_234_500n, 2],
      [123456789012345678901234567890n, 10],
    ] as const) {
      const padded = toWholeNumber(atoms.toString(), decimals);
      const [whole, fraction = ''] = formatUnits(atoms, decimals).split('.');
      expect(padded).toBe(`${whole}.${fraction.padEnd(decimals, '0')}`);
    }
  });
});

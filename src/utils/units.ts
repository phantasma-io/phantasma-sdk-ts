/**
 * Converts token amounts between decimals and atoms. The chain counts every token in its smallest
 * unit, called an atom. KCAL has 10 decimals, SOUL has 8, and every other token has what its
 * `decimals` field says. People read and write decimal strings. Both directions here are exact,
 * because no floating point is involved.
 *
 * The other SDKs call this pair `UnitConversion.ToDecimal` and `UnitConversion.ToBigInteger`. These
 * names are the ones a TypeScript caller expects.
 *
 * Two older helpers in this SDK convert in the same direction and stay.
 * `PhantasmaAPI.convertDecimals` works in floating point and is deprecated in favour of
 * `formatUnits`. The Ledger module's `toWholeNumber` keeps every decimal place a display needs, and
 * it is left alone.
 */

const MAX_DECIMALS = 77; // 10^77 is the largest power of ten below 2^256

/** Converts a decimal amount such as "1.5", 2 or 3n into atoms of a token with `decimals`
 * decimals. */
export function parseUnits(value: string | number | bigint, decimals: number): bigint {
  assertDecimals(decimals);
  const scale = 10n ** BigInt(decimals);
  if (typeof value === 'bigint') return value * scale;
  const text = typeof value === 'number' ? numberToDecimalString(value) : value.trim();
  const match = /^([+-])?(\d+)?(?:\.(\d+))?$/.exec(text);
  if (!match || (match[2] === undefined && match[3] === undefined)) {
    throw new RangeError(`Not a decimal amount: ${JSON.stringify(value)}`);
  }
  const [, sign, whole = '0', fraction = ''] = match;
  if (fraction.length > decimals) {
    throw new RangeError(`${text} has more than ${decimals} decimal places`);
  }
  const atoms = BigInt(whole) * scale + BigInt(fraction.padEnd(decimals, '0') || '0');
  return sign === '-' ? -atoms : atoms;
}

/** Renders atoms of a token with `decimals` decimals as a decimal string. Trailing zeros are
 * dropped. */
export function formatUnits(atoms: bigint, decimals: number): string {
  assertDecimals(decimals);
  const negative = atoms < 0n;
  const magnitude = negative ? -atoms : atoms;
  const scale = 10n ** BigInt(decimals);
  const whole = (magnitude / scale).toString();
  const fraction = (magnitude % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
    throw new RangeError(`decimals must be an integer between 0 and ${MAX_DECIMALS}`);
  }
}

// Number.toString switches to exponent notation for very small and very large magnitudes. The
// parser rejects that notation on purpose. An amount that cannot be written out in full should not
// be parsed at all.
function numberToDecimalString(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`Not a finite amount: ${value}`);
  return value.toString();
}

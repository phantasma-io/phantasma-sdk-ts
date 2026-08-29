import { CreateTokenSeriesTxHelper } from '../../src/types/carbon/blockchain/tx-helpers/create-token-series-tx-helper';
import { CreateTokenTxHelper } from '../../src/types/carbon/blockchain/tx-helpers/create-token-tx-helper';

// What a contract call answers with is part of the wire contract, and the two creation calls do not
// answer alike: Token.CreateToken returns a u64 token id, Token.CreateTokenSeries a u32 series id.
// Reading either at the other's width silently returns a wrong id instead of failing, so both
// widths are pinned here against results in the little-endian form the chain writes.
describe('creation call results', () => {
  const hexOf = (value: bigint, bytes: number) =>
    Array.from({ length: bytes }, (_, i) =>
      Number((value >> BigInt(8 * i)) & 0xffn)
        .toString(16)
        .padStart(2, '0')
    ).join('');

  it('reads a created token id across the whole 64-bit range', () => {
    expect(CreateTokenTxHelper.parseResult(hexOf(1n, 8))).toBe(1n);
    // An id above 2^32 is the case a 32-bit read gets wrong while looking healthy: it would return
    // the low half, here 1, for a token that is actually the 4294967297th.
    expect(CreateTokenTxHelper.parseResult(hexOf(4_294_967_297n, 8))).toBe(4_294_967_297n);
    // And one no `number` can hold at all.
    expect(CreateTokenTxHelper.parseResult(hexOf(2n ** 63n + 5n, 8))).toBe(2n ** 63n + 5n);
  });

  it('reads a created series id as the 32-bit value it is', () => {
    expect(CreateTokenSeriesTxHelper.parseResult(hexOf(7n, 4))).toBe(7);
    expect(CreateTokenSeriesTxHelper.parseResult(hexOf(4_294_967_295n, 4))).toBe(4_294_967_295);
  });
});

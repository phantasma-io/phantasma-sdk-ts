import { CarbonBinaryReader } from '../../src/types/carbon-serialization';
import { Bytes32 } from '../../src/types/carbon/bytes32';
import { IntX } from '../../src/types/carbon/int-x';
import { GasConfig } from '../../src/types/carbon/blockchain/gas-config';
import { SignedTxMsg } from '../../src/types/carbon/blockchain/signed-tx-msg';
import { TxMsg } from '../../src/types/carbon/blockchain/tx-msg';
import { SeriesInfoBuilder } from '../../src/types/carbon/blockchain/modules/builders/series-info-builder';
import { TokenInfoBuilder } from '../../src/types/carbon/blockchain/modules/builders/token-info-builder';
import { TokenMetadataBuilder } from '../../src/types/carbon/blockchain/modules/builders/token-metadata-builder';
import { TokenSchemasBuilder } from '../../src/types/carbon/blockchain/modules/builders/token-schemas-builder';
import { PhantasmaNftMintInfo } from '../../src/types/carbon/blockchain/modules/phantasma-nft-mint-info';
import { CreateTokenSeriesTxHelper } from '../../src/types/carbon/blockchain/tx-helpers/create-token-series-tx-helper';
import { CreateTokenTxHelper } from '../../src/types/carbon/blockchain/tx-helpers/create-token-tx-helper';
import { MintNonFungibleTxHelper } from '../../src/types/carbon/blockchain/tx-helpers/mint-non-fungible-tx-helper';
import { MintPhantasmaNonFungibleTxHelper } from '../../src/types/carbon/blockchain/tx-helpers/mint-phantasma-non-fungible-tx-helper';
import { PhantasmaKeys } from '../../src/types/phantasma-keys';

// Every `buildTxAndSign` helper follows one rule: a message whose `maxGas` the caller already set
// is signed as it stands, and only an unplanned one is priced. The rule is read from the MESSAGE,
// not from the options argument, because the builders are what write the caller's limits into the
// message; this file holds all four helpers to that one rule.

function mainnetConfig(): GasConfig {
  return new GasConfig({
    version: 1,
    maxNameLength: 255,
    maxTokenSymbolLength: 255,
    feeShift: 0,
    maxStructureSize: 1_048_576,
    feeMultiplier: 10_000n,
    gasTokenId: 1n,
    dataTokenId: 2n,
    minimumGasOffer: 10n,
    dataEscrowPerRow: 200_000n,
    gasFeeTransfer: 10n,
    gasFeeQuery: 10n,
    gasFeePerByte: 250_000n,
    gasBurnRatioMul: 1n,
    gasBurnRatioShift: 0,
    minimumGasBill: 10_000_000n,
    policyFeeCreateTokenBase: 100_000_000_000_000n,
    policyFeeCreateTokenSymbol: 100_000_000_000_000n,
    policyFeeCreateTokenSeries: 25_000_000_000_000n,
    policyFeeRegisterName: 100_000_000_000_000_000n,
    legacyDataEscrowPerRow: 2n,
  });
}

const KEYS = PhantasmaKeys.fromWIF('KwPpBSByydVKqStGHAnZzQofCqhDmD2bfRgc9BmZqM3ZmsdWJw4d');
const owner = new Bytes32(KEYS.publicKey);
const receiver = new Bytes32(new Uint8Array(32).fill(7));
const config = mainnetConfig();

// A gas offer no plan would ever produce, so "honoured" and "replanned" cannot be confused.
const FIXED_MAX_GAS = 999_000_000n;
const FIXED_MAX_DATA = 7_000_000n;

const sent = (bytes: Uint8Array): TxMsg => SignedTxMsg.read(new CarbonBinaryReader(bytes)).msg;

const tokenInfo = () =>
  TokenInfoBuilder.build(
    'GPX',
    IntX.fromI64(0n),
    false,
    2,
    owner,
    TokenMetadataBuilder.buildAndSerialize({
      name: 'Planning probe',
      icon: 'data:image/png;base64,iVBORw0KGgo=',
      url: 'https://example.invalid/p',
      description: 'x',
    }),
    null
  );

const seriesInfo = () =>
  SeriesInfoBuilder.build(
    TokenSchemasBuilder.prepareStandard(false).seriesMetadata,
    7n,
    0,
    0,
    owner,
    []
  );

const phantasmaMint = () => ({
  tokenId: 9n,
  sender: owner,
  to: receiver,
  tokens: [
    new PhantasmaNftMintInfo({
      phantasmaSeriesId: IntX.fromBigInt(5n),
      rom: new Uint8Array(64),
      ram: new Uint8Array(),
    }),
  ],
});

// Each entry signs the same helper twice: once with the caller's own limits, once with none.
const helpers: Array<{
  name: string;
  withLimits: () => Uint8Array;
  unplanned: () => Uint8Array;
}> = [
  {
    name: 'CreateTokenTxHelper',
    withLimits: () =>
      CreateTokenTxHelper.buildTxAndSign(tokenInfo(), KEYS, config, {
        maxGas: FIXED_MAX_GAS,
        maxData: FIXED_MAX_DATA,
      }),
    unplanned: () => CreateTokenTxHelper.buildTxAndSign(tokenInfo(), KEYS, config),
  },
  {
    name: 'CreateTokenSeriesTxHelper',
    withLimits: () =>
      CreateTokenSeriesTxHelper.buildTxAndSign(9n, seriesInfo(), KEYS, config, {
        maxGas: FIXED_MAX_GAS,
        maxData: FIXED_MAX_DATA,
      }),
    unplanned: () => CreateTokenSeriesTxHelper.buildTxAndSign(9n, seriesInfo(), KEYS, config),
  },
  {
    name: 'MintNonFungibleTxHelper',
    withLimits: () =>
      MintNonFungibleTxHelper.buildTxAndSign(
        9n,
        1,
        KEYS,
        receiver,
        new Uint8Array(64),
        new Uint8Array(),
        config,
        {
          maxGas: FIXED_MAX_GAS,
          maxData: FIXED_MAX_DATA,
        }
      ),
    unplanned: () =>
      MintNonFungibleTxHelper.buildTxAndSign(
        9n,
        1,
        KEYS,
        receiver,
        new Uint8Array(64),
        new Uint8Array(),
        config
      ),
  },
  {
    name: 'MintPhantasmaNonFungibleTxHelper',
    withLimits: () =>
      MintPhantasmaNonFungibleTxHelper.buildTxAndSign(phantasmaMint(), KEYS, config, {
        maxGas: FIXED_MAX_GAS,
        maxData: FIXED_MAX_DATA,
      }),
    unplanned: () => MintPhantasmaNonFungibleTxHelper.buildTxAndSign(phantasmaMint(), KEYS, config),
  },
];

describe('buildTxAndSign limits', () => {
  it.each(helpers)("$name signs the caller's own limits unchanged", ({ withLimits }) => {
    const msg = sent(withLimits());
    expect(msg.maxGas).toBe(FIXED_MAX_GAS);
    expect(msg.maxData).toBe(FIXED_MAX_DATA);
  });

  it.each(helpers)('$name plans a message that carries no offer', ({ unplanned }) => {
    const msg = sent(unplanned());
    expect(msg.maxGas).toBeGreaterThan(0n);
    expect(msg.maxGas).not.toBe(FIXED_MAX_GAS);
  });
});

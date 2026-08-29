import { jest } from '@jest/globals';
import { Bytes32 } from '../../src/types/carbon/bytes32';
import { SmallString } from '../../src/types/carbon/small-string';
import { TxTypes } from '../../src/types/carbon/tx-types';
import { TxMsg } from '../../src/types/carbon/blockchain/tx-msg';
import { TxMsgTransferFungible } from '../../src/types/carbon/blockchain/tx-msg-transfer-fungible';
import { PhantasmaKeys } from '../../src/types/phantasma-keys';
import { FeePlanner, GasConfigSource } from '../../src/rpc/fee-planner';
import { GasConfigResult } from '../../src/rpc/interfaces/gas-config';
import { PhantasmaAPI } from '../../src/rpc/phantasma';

// The getGasConfig response of the mainnet gas-model-v2 configuration (special resolution #79).
const mainnetResult: GasConfigResult = {
  gasModelVersion: 2,
  blockRateTarget: 2000,
  expiryWindow: 3_600_000,
  unitsPerBlockDataByte: 25,
  gasConfig: {
    version: 1,
    maxNameLength: 255,
    maxTokenSymbolLength: 255,
    feeShift: 0,
    maxStructureSize: 1_048_576,
    feeMultiplier: '10000',
    gasTokenId: '1',
    dataTokenId: '2',
    minimumGasOffer: '10',
    dataEscrowPerRow: '200000',
    gasFeeTransfer: '10',
    gasFeeQuery: '10',
    gasFeeCreateTokenBase: '10000000000',
    gasFeeCreateTokenSymbol: '10000000000',
    gasFeeCreateTokenSeries: '2500000000',
    gasFeePerByte: '250000',
    gasFeeRegisterName: '10000000000000',
    gasBurnRatioMul: '1',
    gasBurnRatioShift: 0,
    minimumGasBill: '10000000',
    gasProducerRatioMul: '0',
    gasProducerRatioShift: 0,
    gasDappRatioMul: '0',
    gasDappRatioShift: 0,
    policyFeeCreateTokenBase: '100000000000000',
    policyFeeCreateTokenSymbol: '100000000000000',
    policyFeeCreateTokenSeries: '25000000000000',
    policyFeeRegisterName: '100000000000000000',
    legacyDataEscrowPerRow: '2',
  },
};

class StubSource implements GasConfigSource {
  calls = 0;
  async getGasConfig(): Promise<GasConfigResult> {
    this.calls += 1;
    return mainnetResult;
  }
}

const KEY = PhantasmaKeys.fromWIF('KwPpBSByydVKqStGHAnZzQofCqhDmD2bfRgc9BmZqM3ZmsdWJw4d');

function kcalTransfer(): TxMsg {
  const pub = new Bytes32(KEY.publicKey);
  const msg = new TxMsg(
    TxTypes.TransferFungible,
    1_787_000_000_000n,
    0n,
    0n,
    pub,
    SmallString.empty
  );
  msg.msg = new TxMsgTransferFungible(pub, 1n, 10_000_000n);
  return msg;
}

describe('FeePlanner', () => {
  afterEach(() => jest.useRealTimers());

  it('reads the gas config once and prices messages with it', async () => {
    const source = new StubSource();
    const planner = new FeePlanner(source);

    const first = await planner.plan(kcalTransfer());
    const second = await planner.plan(kcalTransfer());
    expect(first.expectedGasBill).toBe(42_600_000n);
    expect(second.maxGas).toBe(42_600_000n);
    expect(source.calls).toBe(1);
  });

  it('reads the config again when asked, when invalidated, and when the cache expires', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-28T12:00:00Z'));
    const source = new StubSource();
    const planner = new FeePlanner(source, { configTtlMs: 1_000 });

    await planner.config();
    await planner.config();
    expect(source.calls).toBe(1);

    await planner.plan(kcalTransfer(), { refreshConfig: true });
    expect(source.calls).toBe(2);

    planner.invalidate();
    await planner.config();
    expect(source.calls).toBe(3);

    jest.setSystemTime(new Date('2026-08-28T12:00:02Z'));
    await planner.config();
    expect(source.calls).toBe(4);
  });

  it('plans against a config the caller holds without touching the source', async () => {
    const source = new StubSource();
    const planner = new FeePlanner(source);
    const config = await planner.config();
    const plan = planner.planWith(config, kcalTransfer());
    expect(plan.expectedGasBill).toBe(42_600_000n);
    expect(source.calls).toBe(1);
  });

  it('is owned by the RPC client, one per client', () => {
    const api = new PhantasmaAPI('http://127.0.0.1:1/rpc', null, 'simnet');
    const other = new PhantasmaAPI('http://127.0.0.1:2/rpc', null, 'simnet');
    expect(api.fees).toBeInstanceOf(FeePlanner);
    expect(api.fees).toBe(api.fees);
    expect(api.fees).not.toBe(other.fees);
  });
});

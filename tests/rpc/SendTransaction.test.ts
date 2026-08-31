import { Bytes32 } from '../../src/types/carbon/bytes32';
import { CarbonBinaryReader, CarbonBinaryWriter } from '../../src/types/carbon-serialization';
import { IntX } from '../../src/types/carbon/int-x';
import { SmallString } from '../../src/types/carbon/small-string';
import { TxTypes } from '../../src/types/carbon/tx-types';
import { ModuleId } from '../../src/types/carbon/blockchain/module-id';
import { SignedTxMsg } from '../../src/types/carbon/blockchain/signed-tx-msg';
import { TxMsg } from '../../src/types/carbon/blockchain/tx-msg';
import { TxMsgCall } from '../../src/types/carbon/blockchain/tx-msg-call';
import { GovernanceContractMethods } from '../../src/types/carbon/blockchain/modules/governance-contract-methods';
import { TokenInfoBuilder } from '../../src/types/carbon/blockchain/modules/builders/token-info-builder';
import { TokenMetadataBuilder } from '../../src/types/carbon/blockchain/modules/builders/token-metadata-builder';
import { CreateTokenTxHelper } from '../../src/types/carbon/blockchain/tx-helpers/create-token-tx-helper';
import { NativeTxHelper } from '../../src/types/carbon/blockchain/tx-helpers/native-tx-helper';
import { PhantasmaKeys } from '../../src/types/phantasma-keys';
import { hexToBytes } from '../../src/utils/index';
import { GasConfigResult } from '../../src/rpc/interfaces/gas-config';
import { Token } from '../../src/rpc/interfaces/token';
import { PhantasmaAPI } from '../../src/rpc/phantasma';
import {
  preflightTransaction,
  TransactionPreflightError,
} from '../../src/rpc/transaction-preflight';

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

// A client whose network calls are canned: the gas config, the token lookups a pre-flight makes,
// and the broadcast, which records what it was given.
class StubApi extends PhantasmaAPI {
  sent: string[] = [];
  tokens = new Map<string, Token>();
  sendResult: unknown = 'HASH';
  lookups = 0;
  /** What the node answers for something that is not there; overridden to simulate a broken node. */
  lookupError = 'Token symbol not found';

  constructor() {
    super('http://127.0.0.1:1/rpc', null, 'simnet');
  }
  override async getGasConfig(): Promise<GasConfigResult> {
    return mainnetResult;
  }
  /** True when the node answers at all; false simulates one that cannot serve `getToken`. */
  reachable = true;
  override async getToken(
    symbol: string,
    _extended?: boolean,
    carbonTokenId: bigint = 0n
  ): Promise<Token> {
    this.lookups += 1;
    if (!this.reachable) return { error: this.lookupError } as unknown as Token;
    // A live node resolves by id without looking at the symbol; that path is the pre-flight's
    // control, and it answers for the gas token whatever the caller's symbol turns out to be.
    if (carbonTokenId !== 0n) return { symbol: 'KCAL' } as Token;
    return this.tokens.get(symbol) ?? ({ error: this.lookupError } as unknown as Token);
  }
  override async sendCarbonTransaction(txData: string): Promise<string> {
    this.sent.push(txData);
    return this.sendResult as string;
  }
}

const OWNER = PhantasmaKeys.fromWIF('KwPpBSByydVKqStGHAnZzQofCqhDmD2bfRgc9BmZqM3ZmsdWJw4d');
const PAYER = PhantasmaKeys.fromWIF('KwVG94yjfVg1YKFyRxAGtug93wdRbmLnqqrFV6Yd2CiA9KZDAp4H');
const owner = new Bytes32(OWNER.publicKey);
const payer = new Bytes32(PAYER.publicKey);

function transfer(gasPayer?: Bytes32, maxGas?: bigint): TxMsg {
  return NativeTxHelper.transferFungible({
    from: owner,
    to: payer,
    tokenId: 1n,
    amount: 5n,
    gasPayer,
    maxGas,
  });
}

function createToken(symbol: string): TxMsg {
  const info = TokenInfoBuilder.build(
    symbol,
    IntX.fromI64(0n),
    false,
    2,
    owner,
    TokenMetadataBuilder.buildAndSerialize({
      name: 'Send probe',
      icon: 'data:image/png;base64,iVBORw0KGgo=',
      url: 'https://example.invalid/p',
      description: 'x',
    }),
    null
  );
  return CreateTokenTxHelper.buildTx(info, owner);
}

function registerName(name: string): TxMsg {
  const msg = new TxMsg(TxTypes.Call, 1_787_000_000_000n, 0n, 0n, owner, SmallString.empty);
  const call = new TxMsgCall();
  call.moduleId = ModuleId.Governance;
  call.methodId = GovernanceContractMethods.RegisterName;
  const w = new CarbonBinaryWriter();
  owner.write(w);
  new SmallString(name).write(w);
  call.args = w.toUint8Array();
  msg.msg = call;
  return msg;
}

function decodeSent(api: StubApi): SignedTxMsg {
  return SignedTxMsg.read(new CarbonBinaryReader(hexToBytes(api.sent[0])));
}

describe('PhantasmaAPI.sendTransaction', () => {
  it('plans an unplanned message, signs it and broadcasts the envelope', async () => {
    const api = new StubApi();
    const msg = transfer();
    const hash = await api.sendTransaction(msg, OWNER);

    expect(hash).toBe('HASH');
    expect(api.sent).toHaveLength(1);
    const sent = decodeSent(api);
    expect(sent.msg.maxGas).toBe(42_600_000n);
    expect(sent.witnesses).toHaveLength(1);
    expect(msg.maxGas).toBe(0n);
  });

  it('sends a message the caller already planned as it is', async () => {
    const api = new StubApi();
    await api.sendTransaction(transfer(undefined, 55_000_000n), [OWNER]);
    expect(decodeSent(api).msg.maxGas).toBe(55_000_000n);
  });

  it('collects every witness of a gas-payer transfer', async () => {
    const api = new StubApi();
    await api.sendTransaction(transfer(payer), [OWNER, PAYER]);
    const sent = decodeSent(api);
    expect(sent.witnesses.map((w) => w.address.toHex())).toEqual([payer.toHex(), owner.toHex()]);
    expect(hexToBytes(api.sent[0]).length).toBe(106 + 32 + 128);
  });

  // CreateToken consumes its policy fee before checking the symbol, so a taken symbol is refused
  // here, before anything is signed or sent.
  it('refuses to create a token whose symbol is taken', async () => {
    const api = new StubApi();
    api.tokens.set('TAKEN', { symbol: 'TAKEN' } as Token);

    await expect(api.sendTransaction(createToken('TAKEN'), OWNER)).rejects.toThrow(
      TransactionPreflightError
    );
    expect(api.sent).toHaveLength(0);

    await api.sendTransaction(createToken('FRESH'), OWNER);
    expect(api.sent).toHaveLength(1);
  });

  // The pre-flight covers token creation and nothing else. A name registration is sent without a
  // lookup: the node reports a free name as an error and a taken one as an address, so there is no
  // answer that means "free" to check against, and new names cannot be registered on this chain
  // anyway.
  it('sends a name registration without looking anything up', async () => {
    const api = new StubApi();

    await api.sendTransaction(registerName('alice'), OWNER);
    expect(api.sent).toHaveLength(1);
    expect(api.lookups).toBe(0);
  });

  // A free symbol is established, not inferred from the error text: the node refuses to answer
  // about FRESH, so the check asks it for a token that certainly exists. That answer proves the
  // lookup works and is being truthful, which is what makes the refusal about FRESH mean "absent".
  // Whatever the error says is irrelevant - including "Method not found", the JSON-RPC name of
  // error -32601, which contains the words "not found" and means the question was never asked.
  it('establishes a free symbol from a control lookup, not from the error text', async () => {
    const api = new StubApi();

    for (const error of ['Method not found', 'backend unavailable', 'Token symbol not found']) {
      api.lookupError = error;
      await api.sendTransaction(createToken('FRESH'), OWNER);
    }
    expect(api.sent).toHaveLength(3);
  });

  // And the case the whole check exists for: a node that cannot answer at all. Nothing is
  // established, so nothing is signed - the policy fee is not spent on a guess.
  it('refuses when the lookup cannot answer even about a token that exists', async () => {
    const api = new StubApi();
    api.reachable = false;

    for (const error of ['Method not found', 'backend unavailable', 'Token symbol not found']) {
      api.lookupError = error;
      await expect(api.sendTransaction(createToken('FRESH'), OWNER)).rejects.toThrow(
        /Could not establish whether token symbol FRESH is taken/
      );
    }
    expect(api.sent).toHaveLength(0);
  });

  // `sendTransaction` acts on one verdict only. A caller who wants to stop on the others reads the
  // verdict itself and sends separately - which is the whole reason the check reports one instead
  // of deciding. This is that path, and it is the one a wallet uses to warn before spending the fee.
  it('hands the verdict to a caller who wants to decide for itself', async () => {
    const api = new StubApi();
    api.lookupError = 'Method not found';

    expect(await preflightTransaction(api, createToken('FRESH'))).toEqual({
      verdict: 'free',
      subject: 'token symbol FRESH',
    });

    // A source that cannot offer a control token has nothing to check the refusal against, so it
    // says so rather than picking a side. `controlTokenId` is optional for exactly this reason.
    const noControl = { getToken: (symbol: string) => api.getToken(symbol) };
    expect(await preflightTransaction(noControl, createToken('FRESH'))).toEqual({
      verdict: 'unknown',
      subject: 'token symbol FRESH',
      reason: 'Method not found',
    });

    await api.sendTransaction(createToken('FRESH'), OWNER, { preflight: false });
    expect(api.sent).toHaveLength(1);
  });

  // A gas-payer envelope always carries two signatures, even when one account pays for its own
  // transfer: the number of witness slots comes from the message, never from the signer list.
  it('sends a gas-payer transfer whose payer and owner are the same account', async () => {
    const api = new StubApi();
    const msg = NativeTxHelper.transferFungible({
      from: owner,
      to: payer,
      tokenId: 1n,
      amount: 5n,
      gasPayer: owner,
    });

    await api.sendTransaction(msg, OWNER);

    const sent = decodeSent(api);
    expect(sent.witnesses).toHaveLength(2);
    expect(sent.witnesses[0].signature.equals(sent.witnesses[1].signature)).toBe(true);
    expect(hexToBytes(api.sent[0]).length).toBe(106 + 32 + 128);
    expect(sent.msg.maxGas).toBe(66_600_000n);
  });

  it('surfaces a broadcast rejection as an error', async () => {
    const api = new StubApi();
    api.sendResult = { error: 'mempool full' };
    await expect(api.sendTransaction(transfer(), OWNER)).rejects.toThrow('mempool full');
  });
});

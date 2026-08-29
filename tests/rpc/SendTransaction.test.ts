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
import { TransactionPreflightError } from '../../src/rpc/transaction-preflight';

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

// A client whose network calls are canned: the gas config, the token and name lookups a
// pre-flight makes, and the broadcast, which records what it was given.
class StubApi extends PhantasmaAPI {
  sent: string[] = [];
  tokens = new Map<string, Token>();
  names = new Map<string, string>();
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
  override async getToken(symbol: string): Promise<Token> {
    this.lookups += 1;
    return this.tokens.get(symbol) ?? ({ error: this.lookupError } as unknown as Token);
  }
  override async lookUpName(name: string): Promise<string> {
    this.lookups += 1;
    return this.names.get(name) ?? ({ error: this.lookupError } as unknown as string);
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

  it('refuses to register a name that is taken, and skips the check when told to', async () => {
    const api = new StubApi();
    api.names.set('alice', 'P2K...');

    await expect(api.sendTransaction(registerName('alice'), OWNER)).rejects.toThrow(
      'already registered'
    );
    expect(api.sent).toHaveLength(0);

    await api.sendTransaction(registerName('alice'), OWNER, { preflight: false });
    expect(api.sent).toHaveLength(1);
    expect(api.lookups).toBe(1);
  });

  // The pre-flight exists to refuse a transaction the chain will refuse. An RPC error that is not
  // the chain saying "there is nothing here" means the check did not happen, and signing on an
  // unknown chain state is the one outcome it must never produce.
  it('refuses to sign when the lookup itself fails', async () => {
    const api = new StubApi();
    api.lookupError = 'backend unavailable';

    await expect(api.sendTransaction(createToken('FRESH'), OWNER)).rejects.toThrow(
      /Could not check whether the token symbol FRESH is taken/
    );
    await expect(api.sendTransaction(registerName('bob'), OWNER)).rejects.toThrow(
      /Could not check whether the name bob is registered/
    );
    expect(api.sent).toHaveLength(0);

    // The same transactions go through once the node answers the way it does for a free name.
    api.lookupError = 'name not registered';
    await api.sendTransaction(registerName('bob'), OWNER);
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

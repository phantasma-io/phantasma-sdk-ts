import { Address } from '../types/address.js';
import { CarbonBinaryReader } from '../types/carbon-serialization.js';
import { SmallString } from '../types/carbon/small-string.js';
import { TxTypes } from '../types/carbon/tx-types.js';
import { ModuleId } from '../types/carbon/blockchain/module-id.js';
import { GovernanceContractMethods } from '../types/carbon/blockchain/modules/governance-contract-methods.js';
import { TokenContractMethods } from '../types/carbon/blockchain/modules/token-contract-methods.js';
import { TokenInfo } from '../types/carbon/blockchain/modules/token-info.js';
import { TxMsg } from '../types/carbon/blockchain/tx-msg.js';
import { TxMsgCall } from '../types/carbon/blockchain/tx-msg-call.js';
import { Token } from './interfaces/token.js';
import { isRpcErrorResult } from './rpc-result.js';

/** A transaction that the chain would reject after charging for it, caught before signing. */
export class TransactionPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransactionPreflightError';
  }
}

/** The lookups a pre-flight needs - a `PhantasmaAPI`, or anything shaped like one. */
export interface PreflightSource {
  getToken(symbol: string): Promise<Token>;
  lookUpName(name: string): Promise<string>;
}

/**
 * The chain reports "this does not exist yet" as an ordinary RPC error, which is the answer a
 * pre-flight is looking for, and it reports a failed lookup the same way. Only these messages mean
 * the former; every other error is a lookup that did not happen and must not be read as a free
 * symbol or name.
 */
const NOT_FOUND_MESSAGES = [/not found/i, /not registered/i];

function isNotFound(result: unknown): boolean {
  return isRpcErrorResult(result) && NOT_FOUND_MESSAGES.some((p) => p.test(result.error));
}

/**
 * Checks the chain state a message depends on before it is signed. CreateToken and RegisterName are
 * charged their policy fee - the largest single price in the protocol, set by governance and read
 * from `getGasConfig` - before the contract looks at the symbol or the name, so a symbol that is
 * already taken or a name that is already registered costs that fee and produces nothing. Refusing
 * the transaction here costs a single lookup instead. The message's own validity (flags, metadata,
 * schemas) is enforced by the builders; this is the part only the chain can answer.
 *
 * The check fails closed. If the lookup itself fails - the node is unreachable through this client,
 * answers an error this SDK does not recognise, or is behind a proxy that rewrites errors - the
 * transaction is refused rather than signed on an unknown chain state.
 */
export async function preflightTransaction(source: PreflightSource, msg: TxMsg): Promise<void> {
  if (msg.type !== TxTypes.Call) return;
  const call = msg.msg as TxMsgCall;

  if (call.moduleId === ModuleId.Token && call.methodId === TokenContractMethods.CreateToken) {
    const symbol = TokenInfo.read(new CarbonBinaryReader(call.args)).symbol.data;
    if (!symbol) return;
    const token = await source.getToken(symbol);
    if (isNotFound(token)) return;
    if (isRpcErrorResult(token)) {
      throw new TransactionPreflightError(
        `Could not check whether the token symbol ${symbol} is taken: ${token.error}`
      );
    }
    throw new TransactionPreflightError(`Token symbol ${symbol} is already taken`);
  }

  if (
    call.moduleId === ModuleId.Governance &&
    call.methodId === GovernanceContractMethods.RegisterName
  ) {
    const reader = new CarbonBinaryReader(call.args);
    reader.read32();
    const name = SmallString.read(reader).data;
    const owner = await source.lookUpName(name);
    if (isNotFound(owner)) return;
    if (isRpcErrorResult(owner)) {
      throw new TransactionPreflightError(
        `Could not check whether the name ${name} is registered: ${owner.error}`
      );
    }
    if (owner && owner !== Address.nullText) {
      throw new TransactionPreflightError(`Name ${name} is already registered`);
    }
  }
}

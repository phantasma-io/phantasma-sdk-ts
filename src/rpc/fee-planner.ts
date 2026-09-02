import { TxTypes } from '../types/carbon/tx-types.js';
import { GasConfig } from '../types/carbon/blockchain/gas-config.js';
import { TxMsg } from '../types/carbon/blockchain/tx-msg.js';
import { TxMsgBurnNonFungible } from '../types/carbon/blockchain/tx-msg-burn-non-fungible.js';
import { TxMsgBurnNonFungibleGasPayer } from '../types/carbon/blockchain/tx-msg-burn-non-fungible-gas-payer.js';
import { InfusedAsset } from '../types/carbon/blockchain/tx-helpers/native-fee-estimator.js';
import {
  FeePlan,
  FeePlanOptions,
  planFees,
} from '../types/carbon/blockchain/tx-helpers/fee-plan.js';
import { gasConfigFromRpc, GasConfigResult } from './interfaces/gas-config.js';

/** Where a planner reads the chain's gas config from - a `PhantasmaAPI`, or anything shaped like one. */
export interface GasConfigSource {
  getGasConfig(): Promise<GasConfigResult>;
  /**
   * What an NFT holds at its own address, for planning its burn. Optional: a source without it can
   * plan every message but a burn, for which the caller must then state `infusions`.
   */
  infusedAssets?(tokenId: bigint, instanceId: bigint): Promise<InfusedAsset[]>;
}

export interface FeePlannerOptions {
  /**
   * How long a fetched gas config is reused before it is read again. Prices change only by
   * governance resolution, but a stale price under-offers every transaction until it is noticed,
   * so the default is short: 60 seconds.
   */
  configTtlMs?: number;
}

export interface PlanRequestOptions extends FeePlanOptions {
  /** Read the gas config again before planning, ignoring the cache. */
  refreshConfig?: boolean;
}

/**
 * Chain parameters the fee flow needs that are not part of the on-chain `GasConfig`: they describe
 * the node's admission rules rather than its prices, and arrive in the same `getGasConfig` answer.
 */
export interface ChainFeeParams {
  /**
   * The longest lifetime the chain admits for a transaction, in milliseconds - it refuses an expiry
   * at or beyond `now + expiryWindow`. Feed it to `expiryWithin` when a person sits between building
   * a transaction and signing it.
   */
  expiryWindow: number;
  /** Target time between blocks, in milliseconds. */
  blockRateTarget: number;
  /** Gas model the node runs: 1 = the original fee model, 2 = gas model v2. */
  gasModelVersion: number;
}

/**
 * Plans transaction fees against one chain: reads that chain's gas config from its RPC client,
 * keeps it for a short while, and prices messages with it. A `PhantasmaAPI` owns one as
 * `api.fees`, so a process talking to several chains has one planner per chain and no shared
 * state.
 */
export class FeePlanner {
  private readonly ttlMs: number;
  private cached?: { config: GasConfig; params: ChainFeeParams; fetchedAt: number };

  constructor(
    private readonly source: GasConfigSource,
    options: FeePlannerOptions = {}
  ) {
    this.ttlMs = options.configTtlMs ?? 60_000;
  }

  /** The chain's gas config, read from the source when the cached one is missing or expired. */
  async config(options: { refresh?: boolean } = {}): Promise<GasConfig> {
    return (await this.read(options)).config;
  }

  /**
   * The chain's admission parameters, from the same answer and the same cache as {@link config}.
   */
  async chainParams(options: { refresh?: boolean } = {}): Promise<ChainFeeParams> {
    return (await this.read(options)).params;
  }

  private async read(options: { refresh?: boolean }): Promise<{
    config: GasConfig;
    params: ChainFeeParams;
  }> {
    const now = Date.now();
    if (!options.refresh && this.cached && now - this.cached.fetchedAt < this.ttlMs) {
      return this.cached;
    }
    const result = await this.source.getGasConfig();
    const entry = {
      config: gasConfigFromRpc(result),
      params: {
        expiryWindow: result.expiryWindow,
        blockRateTarget: result.blockRateTarget,
        gasModelVersion: result.gasModelVersion,
      },
      fetchedAt: now,
    };
    this.cached = entry;
    return entry;
  }

  /** Forgets the cached config; the next plan reads it again. */
  invalidate(): void {
    this.cached = undefined;
  }

  /** Plans a message against the chain's current prices. See {@link planFees}. */
  async plan(msg: TxMsg, options: PlanRequestOptions = {}): Promise<FeePlan> {
    const { refreshConfig, ...planOptions } = options;
    const config = await this.config({ refresh: refreshConfig });
    return planFees(msg, config, await this.withInfusions(msg, planOptions));
  }

  // A burn returns whatever the NFT's own address holds, and the chain charges for each returned
  // asset. That set is chain state the message does not carry and has no costlier bound, so the
  // pure planner demands it; here, with a chain to ask, it is read unless the caller stated it (an
  // empty list states that the NFT holds nothing).
  private async withInfusions(msg: TxMsg, options: FeePlanOptions): Promise<FeePlanOptions> {
    if (options.infusions !== undefined) return options;
    let burn: TxMsgBurnNonFungible | TxMsgBurnNonFungibleGasPayer;
    switch (msg.type) {
      case TxTypes.BurnNonFungible:
        burn = msg.msg as TxMsgBurnNonFungible;
        break;
      case TxTypes.BurnNonFungible_GasPayer:
        burn = msg.msg as TxMsgBurnNonFungibleGasPayer;
        break;
      default:
        return options;
    }
    if (!this.source.infusedAssets) {
      throw new Error(
        "This planner's source cannot read what a burned NFT holds: pass infusions (empty when it holds nothing) or plan through a PhantasmaAPI"
      );
    }
    return {
      ...options,
      infusions: await this.source.infusedAssets(burn.tokenId, burn.instanceId),
    };
  }

  /** Plans a message against a config the caller already holds - no network, no cache. */
  planWith(config: GasConfig, msg: TxMsg, options: FeePlanOptions = {}): FeePlan {
    return planFees(msg, config, options);
  }
}

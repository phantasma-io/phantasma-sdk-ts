import { GasConfig } from '../types/carbon/blockchain/gas-config.js';
import { TxMsg } from '../types/carbon/blockchain/tx-msg.js';
import { InfusedAsset } from '../types/carbon/blockchain/tx-helpers/native-fee-estimator.js';
import {
  burnedInstances,
  FeePlan,
  FeePlanOptions,
  planFees,
} from '../types/carbon/blockchain/tx-helpers/fee-plan.js';
import { gasConfigFromRpc, GasConfigResult } from './interfaces/gas-config.js';

/** Where a planner reads the chain's gas config from. A `PhantasmaAPI` is one, and so is anything
 * shaped like one. */
export interface GasConfigSource {
  getGasConfig(): Promise<GasConfigResult>;
  /**
   * What an NFT holds at its own address, needed to plan its burn. The method is optional. A source
   * without it can plan every message except a burn, and for a burn the caller must then state
   * `infusions`.
   */
  infusedAssets?(tokenId: bigint, instanceId: bigint): Promise<InfusedAsset[]>;
}

export interface FeePlannerOptions {
  /**
   * How long a fetched gas config is reused before it is read again. Prices change only by
   * governance resolution. A stale price under-offers every transaction until someone notices, so
   * the default is short, 60 seconds.
   */
  configTtlMs?: number;
}

export interface PlanRequestOptions extends FeePlanOptions {
  /** Read the gas config again before planning, ignoring the cache. */
  refreshConfig?: boolean;
}

/**
 * Chain parameters the fee flow needs that are not part of the on-chain `GasConfig`. They describe
 * the node's admission rules, and they arrive in the same `getGasConfig` answer as the prices.
 */
export interface ChainFeeParams {
  /**
   * The longest lifetime the chain admits for a transaction, in milliseconds. The chain refuses an
   * expiry at or beyond `now + expiryWindow`. Pass this value to `expiryWithin` when a person sits
   * between building a transaction and signing it.
   */
  expiryWindow: number;
  /** Target time between blocks, in milliseconds. */
  blockRateTarget: number;
  /** Gas model the node runs: 1 = the original fee model, 2 = gas model v2. */
  gasModelVersion: number;
}

/**
 * Plans transaction fees against one chain. It reads that chain's gas config from its RPC client,
 * keeps the config for a short while, and prices messages with it. A `PhantasmaAPI` owns one as
 * `api.fees`. A process talking to several chains therefore has one planner per chain and shares no
 * state between them.
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
  // asset. That set is chain state the message does not carry, and it has no costlier bound, so the
  // pure planner demands it. Here there is a chain to ask, so it is read unless the caller stated
  // it. An empty list states that the NFTs hold nothing.
  //
  // A message may burn several instances. A wallet burning a selection sends a `Call_Multi` of
  // burns. Each instance is read at its own address, because the fee follows every returned asset
  // separately.
  private async withInfusions(msg: TxMsg, options: FeePlanOptions): Promise<FeePlanOptions> {
    if (options.infusions !== undefined) return options;
    const burned = burnedInstances(msg);
    if (burned.length === 0) return options;
    const read = this.source.infusedAssets;
    if (!read) {
      throw new Error(
        "This planner's source cannot read what a burned NFT holds: pass infusions (empty when it holds nothing) or plan through a PhantasmaAPI"
      );
    }
    const infusions: InfusedAsset[] = [];
    for (const instance of burned) {
      infusions.push(...(await read.call(this.source, instance.tokenId, instance.instanceId)));
    }
    return { ...options, infusions };
  }

  /** Plans a message against a config the caller already holds. It touches no network and no cache. */
  planWith(config: GasConfig, msg: TxMsg, options: FeePlanOptions = {}): FeePlan {
    return planFees(msg, config, options);
  }
}

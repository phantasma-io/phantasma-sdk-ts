import { GasConfig } from '../types/carbon/blockchain/gas-config.js';
import { TxMsg } from '../types/carbon/blockchain/tx-msg.js';
import {
  FeePlan,
  FeePlanOptions,
  planFees,
} from '../types/carbon/blockchain/tx-helpers/fee-plan.js';
import { gasConfigFromRpc, GasConfigResult } from './interfaces/gas-config.js';

/** Where a planner reads the chain's gas config from - a `PhantasmaAPI`, or anything shaped like one. */
export interface GasConfigSource {
  getGasConfig(): Promise<GasConfigResult>;
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
    return planFees(msg, config, planOptions);
  }

  /** Plans a message against a config the caller already holds - no network, no cache. */
  planWith(config: GasConfig, msg: TxMsg, options: FeePlanOptions = {}): FeePlan {
    return planFees(msg, config, options);
  }
}

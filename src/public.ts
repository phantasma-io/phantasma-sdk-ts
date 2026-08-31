export { PhantasmaAPI } from './rpc/phantasma.js';
export { getRpcErrorMessage, isRpcErrorResult, unwrapRpcResult } from './rpc/rpc-result.js';
export type {
  JsonRpcErrorObject,
  JsonRpcErrorResponse,
  JsonRpcParam,
  JsonRpcResponse,
  JsonRpcSuccessResponse,
  RpcErrorResult,
  RpcResult,
} from './rpc/rpc-result.js';
export type {
  ABIContract,
  ABIEvent,
  ABIMethod,
  ABIParameter,
  Account,
  AccountTransactions,
  Archive,
  Auction,
  Balance,
  Block,
  BuildInfoResult,
  Chain,
  Channel,
  CursorPaginatedResult,
  Dapp,
  Event as RpcEvent,
  EventExtended,
  EventExtendedTyped,
  ExtendedEventData,
  Governance,
  Interop,
  KeyValue,
  Leaderboard,
  LeaderboardRow,
  Nexus as RpcNexus,
  NFT,
  Oracle,
  Organization,
  OrganizationMember,
  Paginated,
  Peer,
  PhantasmaVmConfig,
  Platform,
  Receipt,
  RpcAddressType,
  Script,
  SendRawTx,
  SignatureResult,
  SpecialResolutionArguments,
  SpecialResolutionArgumentsByMethod,
  SpecialResolutionCall,
  SpecialResolutionData,
  Stake,
  Storage,
  Swap,
  Token,
  TokenData,
  TokenExternal,
  TokenPrice,
  TokenSchemasResult,
  TokenSeries,
  TokenSeriesResult,
  TransactionData,
  Validator,
  VmNamedVariableSchemaResult,
  VmStructSchemaResult,
  VmValue,
  VmVariableSchemaResult,
} from './rpc/interfaces/index.js';
export { vmStructSchemaFromRpcResult, vmVariableSchemaFromRpcResult } from './rpc/helpers/index.js';

export {
  ContractTxHelper,
  buildContractArtifactBundle,
  buildContractArtifactManifest,
  coerceContractBytes,
  normalizeContractName,
  ExecutionState,
  Transaction,
} from './tx/index.js';
export type {
  BuildContractArtifactBundleParams,
  BuildContractArtifactManifestParams,
  ContractArtifactBundle,
  ContractArtifactFileEntry,
  ContractArtifactManifest,
  ContractBinaryInput,
  ContractScriptBuildParams,
  ContractTransactionBuildParams,
  ContractTransactionSignParams,
} from './tx/index.js';

export {
  Contracts,
  Decoder,
  EventKind,
  Opcode,
  ScriptBuilder,
  TypeAuction,
  VMObject,
  VMType,
  decodeVMObject,
  getChainValueEventData,
  getGasEventData,
  getInfusionEventData,
  getMarketEventData,
  getString,
  getTokenEventData,
  getTransactionSettleEventData,
} from './vm/index.js';
export type {
  ChainValueEventData,
  GasEventData,
  InfusionEventData,
  MarketEventData,
  TokenEventData,
  TransactionSettleEventData,
} from './vm/index.js';

export {
  AccountTrigger,
  Address,
  AddressKind,
  Base16,
  CarbonBinaryReader,
  CarbonBinaryWriter,
  ConsensusMode,
  ContractEvent,
  ContractInterface,
  ContractMethod,
  ContractParameter,
  CustomSerializer,
  Describer,
  DomainSettings,
  Ed25519Signature,
  Entropy,
  OrganizationTrigger,
  PBinaryReader,
  PBinaryWriter,
  PhantasmaKeys,
  PollChoice,
  PollPresence,
  PollState,
  PollValue,
  PollVote,
  Serialization,
  Stack,
  StakeReward,
  Timestamp,
  TokenTrigger,
  TriggerResult,
  bigIntToTwosComplementLE,
  readBlob,
  twosComplementLEToBigInt,
  writeBlob,
} from './types/index.js';
export type { CustomReader, CustomWriter } from './types/index.js';

export {
  Bytes16,
  Bytes32,
  Bytes64,
  CarbonBlob,
  CarbonTokenFlags,
  CreateTokenSeriesTxHelper,
  CreateTokenTxHelper,
  FieldType,
  IntX,
  MetadataField,
  MintNonFungibleTxHelper,
  MintPhantasmaNonFungibleTxHelper,
  ModuleId,
  NativeTxHelper,
  NftRomBuilder,
  PhantasmaNftRomBuilder,
  PhantasmaNftMintInfo,
  PhantasmaNftMintResult,
  SeriesInfo,
  SeriesInfoBuilder,
  SignedTxMsg,
  SmallString,
  StandardMeta,
  TokenContractMethods,
  TokenHelper,
  TokenInfo,
  TokenInfoBuilder,
  TokenMetadataBuilder,
  TokenSchemas,
  TokenSchemasBuilder,
  TokenSchemasJson,
  TokenSeriesMetadataBuilder,
  TxMsg,
  TxMsgBurnFungible,
  TxMsgBurnFungibleGasPayer,
  TxMsgBurnNonFungible,
  TxMsgBurnNonFungibleGasPayer,
  TxMsgCall,
  TxMsgCallMulti,
  TxMsgMintFungible,
  TxMsgMintNonFungible,
  TxMsgPhantasma,
  TxMsgPhantasmaRaw,
  TxMsgSigner,
  TxMsgSpecialResolution,
  TxMsgTrade,
  TxMsgTransferFungible,
  TxMsgTransferFungibleGasPayer,
  TxMsgTransferNonFungibleMulti,
  TxMsgTransferNonFungibleMultiGasPayer,
  TxMsgTransferNonFungibleSingle,
  TxMsgTransferNonFungibleSingleGasPayer,
  TxTypes,
  TokenListing,
  VmDynamicStruct,
  VmDynamicVariable,
  VmNamedDynamicVariable,
  VmNamedVariableSchema,
  VmStructArray,
  VmStructFlags,
  VmStructSchema,
  VmType,
  VmVariableSchema,
  Witness,
  findMetadataField,
  nftDefaultMetadataFields,
  parseTokenSchemasJson,
  pushMetadataField,
  seriesDefaultMetadataFields,
  standardMetadataFields,
} from './types/carbon/index.js';
export type { MetadataValueInput } from './types/carbon/index.js';

export {
  ANONYMOUS_NAME,
  ENTRY_CONTEXT_NAME,
  GENESIS_NAME,
  NULL_NAME,
  arrayNumberToUint8Array,
  bigIntToByteArray,
  bytesToHex,
  decodeBase16,
  encodeBase16,
  formatUnits,
  getDifficulty,
  hexStringToUint8Array,
  hexToBytes,
  isReservedIdentifier,
  isValidIdentifier,
  isValidTicker,
  numberToByteArray,
  parseUnits,
  reverseHex,
  setLogger,
  stringToUint8Array,
  uint8ArrayToBytes,
  uint8ArrayToNumberArray,
  uint8ArrayToString,
  uint8ArrayToStringDefault,
} from './utils/index.js';
export type { Logger } from './utils/index.js';

export {
  generateNewSeed,
  generateNewSeedWords,
  generateNewWif,
  getAddressFromWif,
  getPrivateKeyFromWif,
  getPublicKeyFromPrivateKey,
  getWifFromPrivateKey,
  signData,
  verifyData,
} from './tx/utils.js';

export { EasyConnect } from './link/easy-connect.js';
export { EasyScript, Nexus } from './link/easy-script.js';
export { PhantasmaLink } from './link/phantasma-link.js';
export { ProofOfWork } from './link/interfaces/proof-of-work.js';
export type { LinkAccount, LinkFile } from './link/index.js';
export type { PrebuiltTransactionSignResult } from './link/phantasma-link.js';
// Phantasma Link v5 (new generation). Namespaced because v5 defines its own `SignatureKind`
// (string union) distinct from the contract `SignatureKind` enum exported flatly above.
export * as PhantasmaLinkV5 from './link/v5/index.js';

export { Signature, SignatureKind } from './interfaces/signature.js';
export { NativeContractKind } from './interfaces/contract.js';
export { TokenFlags, TokenSeriesMode } from './interfaces/token.js';
export {
  getAddressFromLedger,
  getAddressFromPrivateKey,
  getAddressFromPublicKey,
  getAddressPublicKeyFromPublicKey,
} from './ledger/index.js';
export type { CarbonBlobLike } from './interfaces/carbon/carbon-blob-like.js';
export type { ContractDescriptor } from './interfaces/contract.js';
export type { KeyPair } from './interfaces/key-pair.js';
export type { Ledger } from './ledger/interfaces/ledger.js';
export type { Serializable } from './interfaces/serializable.js';
export type { StackLike } from './interfaces/stack.js';
export type { TokenDescriptor } from './interfaces/token.js';
export type { TxSigner } from './types/carbon/blockchain/extensions/tx-signer.js';

// Fee planning: the chain's prices, the planner that reads them, and the calculator underneath.
// Sizing an actual message is `SignedTxMsg.envelopeBytes`, so the byte-count helper the calculator
// exposes for callers who hold only a serialized length is deliberately not re-exported here.
export { GasConfig } from './types/carbon/blockchain/gas-config.js';
export { gasConfigFromRpc } from './rpc/interfaces/gas-config.js';
export type { GasConfigData, GasConfigResult } from './rpc/interfaces/gas-config.js';
export { FeePlanner } from './rpc/fee-planner.js';
export type {
  ChainFeeParams,
  FeePlannerOptions,
  GasConfigSource,
  PlanRequestOptions,
} from './rpc/fee-planner.js';
export {
  DEFAULT_TX_EXPIRY_MS,
  estimateNativeFee,
  expiryWithin,
  NativeFeeKind,
  planFees,
  summarizeFeePlan,
} from './types/carbon/blockchain/tx-helpers/index.js';
export type {
  BurnFungibleParams,
  BurnNonFungibleParams,
  FeePlan,
  FeePlanOptions,
  FeePlanSummary,
  FeePlanSummaryDecimals,
  FeeQuote,
  MintFungibleParams,
  NativeFeeEstimate,
  NativeFeeParams,
  NativeTxParties,
  PhantasmaNftMintParams,
  PlanAndSignOptions,
  TransferFungibleParams,
  TransferNonFungibleParams,
  TxLimits,
} from './types/carbon/blockchain/tx-helpers/index.js';
// Sending: the one-step path and the chain-state checks it runs before signing.
export { TransactionPreflightError, preflightTransaction } from './rpc/transaction-preflight.js';
export type {
  PreflightResult,
  PreflightSource,
  PreflightVerdict,
} from './rpc/transaction-preflight.js';
export type { SendTransactionOptions } from './rpc/phantasma.js';
export { GovernanceContractMethods } from './types/carbon/blockchain/modules/governance-contract-methods.js';

import {
  Address,
  CarbonBlobLike,
  ContractDescriptor,
  ContractInterface,
  Ed25519Signature,
  FeeOptionsLike,
  IAccount,
  ICarbonBlob,
  IContract,
  IFeeOptions,
  IFile,
  IKeyPair,
  ILedger,
  IStack,
  IToken,
  KeyPair,
  Ledger,
  LinkAccount,
  LinkFile,
  PhantasmaKeys,
  Stack,
  StackLike,
  TokenDescriptor,
  TokenFlags,
} from '../../src/core/index';

describe('interface compatibility', () => {
  it('keeps legacy key-pair types separate from canonical key-pair types', () => {
    const keys = PhantasmaKeys.generate();

    const canonical: KeyPair = keys;
    const legacy: IKeyPair = {
      PrivateKey: keys.privateKey,
      PublicKey: keys.publicKey,
      Sign: (msg) => Ed25519Signature.generate(keys, msg),
    };

    expect(Address.fromKey(canonical).text).toBe(keys.address.text);
    expect(Address.fromKey(legacy).text).toBe(keys.address.text);
  });

  it('exports canonical aliases while preserving old I-prefixed interfaces', () => {
    const stack = new Stack<number>();
    const canonicalStack: StackLike<number> = stack;
    const legacyStack: IStack<number> = stack;

    const file: LinkFile = { name: 'readme.txt', hash: 'abc', size: 3, date: '2026-05-11' };
    const legacyFile: IFile = file;
    const account: LinkAccount = {
      alias: 'main',
      name: 'Main',
      address: Address.nullText,
      avatar: '',
      platform: 'phantasma',
      external: '',
      balances: [],
      files: [legacyFile],
    };
    const legacyAccount: IAccount = account;

    const blob: CarbonBlobLike = { write: () => undefined, read: () => undefined };
    const legacyBlob: ICarbonBlob = blob;

    const feeOptions: FeeOptionsLike = {
      feeMultiplier: 1n,
      calculateMaxGas: () => 1n,
    };
    const legacyFeeOptions: IFeeOptions = feeOptions;

    const ledger: Ledger = {
      device: { enabled: false },
      publicKey: '',
      address: '',
      signature: '',
    };
    const legacyLedger: ILedger = ledger;

    const contract: ContractDescriptor = {
      name: 'account',
      abi: ContractInterface.empty,
    };
    const legacyContract: IContract = {
      Name: contract.name,
      ABI: contract.abi,
    };

    const token: TokenDescriptor = {
      name: 'Soul',
      symbol: 'SOUL',
      owner: Address.nullAddress,
      flags: TokenFlags.Transferable,
      maxSupply: 0n as unknown as BigInteger,
      decimals: 8,
      script: new Uint8Array(),
      abi: ContractInterface.empty,
    };
    const legacyToken: IToken = {
      Name: token.name,
      Symbol: token.symbol,
      Owner: token.owner,
      Flags: token.flags,
      MaxSupply: token.maxSupply,
      Decimals: token.decimals,
      Script: token.script,
      ABI: token.abi,
    };

    expect(canonicalStack).toBe(legacyStack);
    expect(legacyAccount.files[0]).toBe(legacyFile);
    expect(legacyBlob).toBe(blob);
    expect(legacyFeeOptions.calculateMaxGas()).toBe(1n);
    expect(legacyLedger).toBe(ledger);
    expect(legacyContract.ABI).toBe(contract.abi);
    expect(legacyToken.Symbol).toBe(token.symbol);
  });
});

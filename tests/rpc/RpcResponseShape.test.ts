import type {
  Account,
  AccountTransactions,
  Archive,
  Auction,
  Balance,
  Block,
  BuildInfoResult,
  Chain,
  Contract,
  CursorPaginatedResult,
  Leaderboard,
  Nexus,
  NFT,
  Organization,
  OrganizationMember,
  Paginated,
  PhantasmaVmConfig,
  Script,
  Token,
  TokenData,
  TokenSeriesResult,
  TransactionData,
} from '../../src/rpc/interfaces/index.js';
import type { PhantasmaAPI } from '../../src/rpc/phantasma.js';

function expectType<T>(value: T): void {
  // Compile-time assertion helper.
  void value;
}

describe('RPC response model shape', () => {
  it('exposes accurate method return types for the full public RPC surface', () => {
    expectType<Promise<Account>>(undefined as unknown as ReturnType<PhantasmaAPI['getAccount']>);
    expectType<Promise<Account[]>>(undefined as unknown as ReturnType<PhantasmaAPI['getAccounts']>);
    expectType<Promise<string>>(undefined as unknown as ReturnType<PhantasmaAPI['lookUpName']>);
    expectType<Promise<number>>(undefined as unknown as ReturnType<PhantasmaAPI['getBlockHeight']>);
    expectType<Promise<number>>(
      undefined as unknown as ReturnType<PhantasmaAPI['getBlockTransactionCountByHash']>
    );
    expectType<Promise<Block>>(undefined as unknown as ReturnType<PhantasmaAPI['getBlockByHash']>);
    expectType<Promise<Block>>(
      undefined as unknown as ReturnType<PhantasmaAPI['getBlockByHeight']>
    );
    expectType<Promise<Block>>(undefined as unknown as ReturnType<PhantasmaAPI['getLatestBlock']>);
    expectType<Promise<TransactionData>>(
      undefined as unknown as ReturnType<PhantasmaAPI['getTransactionByBlockHashAndIndex']>
    );
    expectType<Promise<Paginated<AccountTransactions>>>(
      undefined as unknown as ReturnType<PhantasmaAPI['getAddressTransactions']>
    );
    expectType<Promise<number>>(
      undefined as unknown as ReturnType<PhantasmaAPI['getAddressTransactionCount']>
    );
    expectType<Promise<string>>(
      undefined as unknown as ReturnType<PhantasmaAPI['sendRawTransaction']>
    );
    expectType<Promise<string>>(
      undefined as unknown as ReturnType<PhantasmaAPI['sendCarbonTransaction']>
    );
    expectType<Promise<Script>>(
      undefined as unknown as ReturnType<PhantasmaAPI['invokeRawScript']>
    );
    expectType<Promise<TransactionData>>(
      undefined as unknown as ReturnType<PhantasmaAPI['getTransaction']>
    );
    expectType<Promise<Chain[]>>(undefined as unknown as ReturnType<PhantasmaAPI['getChains']>);
    expectType<Promise<Chain>>(undefined as unknown as ReturnType<PhantasmaAPI['getChain']>);
    expectType<Promise<Nexus>>(undefined as unknown as ReturnType<PhantasmaAPI['getNexus']>);
    expectType<Promise<Contract[]>>(
      undefined as unknown as ReturnType<PhantasmaAPI['getContracts']>
    );
    expectType<Promise<Contract>>(undefined as unknown as ReturnType<PhantasmaAPI['getContract']>);
    expectType<Promise<Contract>>(
      undefined as unknown as ReturnType<PhantasmaAPI['getContractByAddress']>
    );
    expectType<Promise<Organization>>(
      undefined as unknown as ReturnType<PhantasmaAPI['getOrganization']>
    );
    expectType<Promise<CursorPaginatedResult<Organization[]>>>(
      undefined as unknown as ReturnType<PhantasmaAPI['getOrganizations']>
    );
    expectType<Promise<CursorPaginatedResult<OrganizationMember[]>>>(
      undefined as unknown as ReturnType<PhantasmaAPI['getOrganizationMembers']>
    );
    expectType<Promise<OrganizationMember>>(
      undefined as unknown as ReturnType<PhantasmaAPI['getOrganizationMember']>
    );
    expectType<Promise<Leaderboard>>(
      undefined as unknown as ReturnType<PhantasmaAPI['getLeaderboard']>
    );
    expectType<Promise<Token[]>>(undefined as unknown as ReturnType<PhantasmaAPI['getTokens']>);
    expectType<Promise<Token>>(undefined as unknown as ReturnType<PhantasmaAPI['getToken']>);
    expectType<Promise<TokenData>>(
      undefined as unknown as ReturnType<PhantasmaAPI['getTokenData']>
    );
    expectType<Promise<Balance>>(
      undefined as unknown as ReturnType<PhantasmaAPI['getTokenBalance']>
    );
    expectType<Promise<CursorPaginatedResult<TokenSeriesResult[]>>>(
      undefined as unknown as ReturnType<PhantasmaAPI['getTokenSeries']>
    );
    expectType<Promise<TokenSeriesResult>>(
      undefined as unknown as ReturnType<PhantasmaAPI['getTokenSeriesById']>
    );
    expectType<Promise<CursorPaginatedResult<NFT[]>>>(
      undefined as unknown as ReturnType<PhantasmaAPI['getTokenNFTs']>
    );
    expectType<Promise<CursorPaginatedResult<NFT[]>>>(
      undefined as unknown as ReturnType<PhantasmaAPI['getAccountNFTs']>
    );
    expectType<Promise<CursorPaginatedResult<Balance[]>>>(
      undefined as unknown as ReturnType<PhantasmaAPI['getAccountFungibleTokens']>
    );
    expectType<Promise<CursorPaginatedResult<Token[]>>>(
      undefined as unknown as ReturnType<PhantasmaAPI['getAccountOwnedTokens']>
    );
    expectType<Promise<CursorPaginatedResult<TokenSeriesResult[]>>>(
      undefined as unknown as ReturnType<PhantasmaAPI['getAccountOwnedTokenSeries']>
    );
    expectType<Promise<Paginated<Auction[]>>>(
      undefined as unknown as ReturnType<PhantasmaAPI['getAuctions']>
    );
    expectType<Promise<Auction>>(undefined as unknown as ReturnType<PhantasmaAPI['getAuction']>);
    expectType<Promise<Archive>>(undefined as unknown as ReturnType<PhantasmaAPI['getArchive']>);
    expectType<Promise<boolean>>(undefined as unknown as ReturnType<PhantasmaAPI['writeArchive']>);
    expectType<Promise<NFT>>(undefined as unknown as ReturnType<PhantasmaAPI['getNFT']>);
    expectType<Promise<NFT[]>>(undefined as unknown as ReturnType<PhantasmaAPI['getNFTs']>);
    expectType<Promise<BuildInfoResult>>(
      undefined as unknown as ReturnType<PhantasmaAPI['getVersion']>
    );
    expectType<Promise<PhantasmaVmConfig>>(
      undefined as unknown as ReturnType<PhantasmaAPI['getPhantasmaVmConfig']>
    );
  });

  it('matches current NFT responses that expose both Phantasma and Carbon series ids', () => {
    // GetNFT and GetTokenData now return `series` as the Phantasma series id
    // and `carbonSeriesId` as the Carbon series id. Consumers need both.
    const nft: NFT = {
      id: '114421489078208846865781686677703916747957676095726331975539104623084882729589',
      series: '0',
      carbonTokenId: '4',
      carbonSeriesId: '1',
      carbonNftAddress: '000000000000000000000000000000010400000000000000010000004A230000',
      mint: '9034',
      chainName: 'main',
      ownerAddress: 'P2KCAUqELn3ooqVNvQGnoBdoth23ZUiMka67D6LQboyubzY',
      creatorAddress: 'S3d9nBL5LAUFhQ14Wzyb3JJRrXXB6atUuoL1uibkT3bttjw',
      ram: '',
      rom: '2201002B183A7B884BF571F1DAEBFF646F909D432D1CF49F30AFD3FE81F4F69BDE4E20100D1564',
      status: 'Active',
      infusion: [
        { key: 'KCAL', value: '132618509' },
        { key: 'SOUL', value: '11457923943' },
      ],
      properties: [],
    };

    const tokenData: TokenData = {
      id: nft.id,
      series: nft.series,
      carbonTokenId: nft.carbonTokenId,
      carbonSeriesId: nft.carbonSeriesId,
      carbonNftAddress: nft.carbonNftAddress,
      mint: nft.mint,
      chainName: nft.chainName,
      ownerAddress: nft.ownerAddress,
      creatorAddress: nft.creatorAddress,
      ram: nft.ram,
      rom: nft.rom,
      status: nft.status,
      infusion: nft.infusion,
      properties: nft.properties,
    };

    expect(tokenData.carbonSeriesId).toBe('1');
  });

  it('matches current token and token-series REST responses', () => {
    // Token metadata and series supply fields are part of the REST shape used
    // by marketplace/indexer consumers; the SDK DTO must not force stale fields.
    const token: Token = {
      symbol: 'CROWN',
      name: 'Phantasma Crown',
      decimals: 0,
      currentSupply: '10998',
      maxSupply: '0',
      burnedSupply: '595',
      address: 'S3d79FvexQeerRioAY3pGYpNPFx7oJkMV4KazdTHdGDA5iy',
      owner: 'P2KDRaLytwJFMpVzS6M7GXU9EaoMsii4knnY83xVmQkNioy',
      flags: 'Transferable, Burnable',
      script: '',
      series: [],
      carbonId: '4',
      metadata: [
        { key: '_brn', value: '595' },
        { key: 'name', value: 'Phantasma Crown' },
      ],
    };

    const series: TokenSeriesResult = {
      seriesId: '0',
      carbonTokenId: '4',
      carbonSeriesId: '1',
      ownerAddress: 'P2KDRaLytwJFMpVzS6M7GXU9EaoMsii4knnY83xVmQkNioy',
      maxMint: '0',
      mintCount: '11593',
      currentSupply: '10998',
      maxSupply: '0',
      metadata: [
        { key: 'mode', value: '0' },
        { key: 'rom', value: '' },
      ],
    };

    expect(token.metadata?.[1]?.value).toBe('Phantasma Crown');
    expect(series.mintCount).toBe('11593');
  });

  it('matches current paginated token, account, and auction result wrappers', () => {
    const tokenNfts: CursorPaginatedResult<NFT[]> = {
      result: [
        {
          id: '102027540816489236327796452815702733520646114324490783683230488899035835189818',
          series: '0',
          carbonTokenId: '4',
          carbonSeriesId: '1',
          carbonNftAddress: '0000000000000000000000000000000104000000000000000100000000010000',
          mint: '256',
          chainName: 'main',
          ownerAddress: 'P2K6uy85nCLx7ZobQG6zXnfU8eWCTPQZYuXeG9XN6ARpnLu',
          creatorAddress: 'S3d9nBL5LAUFhQ14Wzyb3JJRrXXB6atUuoL1uibkT3bttjw',
          ram: '',
          rom: '2201002E9810C70F79094880582D35CAB313F59DF95D3DAAC82CE92E359E9EB82F4B0EDDF2805E',
          status: 'Active',
          infusion: [],
          properties: [],
        },
      ],
      cursor: 'AQAAAG4EAAAAAAAAAAEAAAAAAQAA',
    };
    const fungibles: CursorPaginatedResult<Token[]> = {
      result: [
        {
          symbol: 'CROWN',
          name: 'Phantasma Crown',
          decimals: 0,
          currentSupply: '10998',
          maxSupply: '0',
          burnedSupply: '595',
          address: 'S3d79FvexQeerRioAY3pGYpNPFx7oJkMV4KazdTHdGDA5iy',
          owner: 'P2KDRaLytwJFMpVzS6M7GXU9EaoMsii4knnY83xVmQkNioy',
          flags: 'Transferable, Burnable',
          series: [],
          carbonId: '4',
        },
      ],
    };
    const auctions: Paginated<Auction[]> = {
      page: 1,
      pageSize: 1,
      total: 4,
      totalPages: 4,
      result: [
        {
          creatorAddress: 'P2KHYbKErE7CUqoZ1LdYphdMiDsFsYbc1d5ft25nqnHB7VB',
          chainAddress: 'S3d7TbZxtNPdXy11hfmBLJLYn67gZTG2ibL7fJBcVdihWU4',
          startDate: 1779036958,
          endDate: 1784220955,
          baseSymbol: 'CROWN',
          quoteSymbol: 'SOUL',
          tokenId: '111675641287447033104762662227858669334618237795768244758086596088470721744380',
          price: '840000000000',
          endPrice: '0',
          extensionPeriod: '0',
          type: 'Fixed',
          rom: '',
          ram: '',
          listingFee: '0',
          currentWinner: '',
        },
      ],
    };

    expect(tokenNfts.result?.[0]?.id).toBeDefined();
    expect(fungibles.result?.[0]?.script).toBeUndefined();
    expect(auctions.result[0]?.baseSymbol).toBe('CROWN');
  });

  it('matches current contract, chain, nexus, organization, leaderboard, archive, and config responses', () => {
    const contract: Contract = {
      name: 'account',
      address: 'S3dGz1deZweAiMVPHL328X3pVNpANQVjgX4MoRGpbNNAfrB',
      script: '0B',
      methods: [
        {
          name: 'RegisterName',
          returnType: 'None',
          parameters: [{ name: 'target', type: 'Object' }],
        },
      ],
      events: [],
    };
    const chain: Chain = { height: 0 };
    const nexus: Nexus = { protocol: 0 };
    const organization: Organization = {
      name: 'masters',
      owner: 'Powner',
      carbonOwner: '0xowner',
      metadata: [{ key: 'role', value: 'validators' }],
      memberCount: '2',
    };
    const organizationMember: OrganizationMember = {
      address: 'Pmember',
      carbonAddress: '0xmember',
      isMember: true,
      memberTime: 123,
    };
    const leaderboard: Leaderboard = {};
    const archive: Archive = { time: 0, size: 0, blockCount: 0 };
    const config: PhantasmaVmConfig = {
      isStored: true,
      featureLevel: 5,
      gasConstructor: '1',
      gasNexus: '1',
      gasOrganization: '1',
      gasAccount: '1',
      gasLeaderboard: '1',
      gasStandard: '1',
      gasOracle: '1',
      fuelPerContractDeploy: '1',
    };
    const version: BuildInfoResult = {
      version: '3.0.0',
      commit: 'abc123',
      buildTimeUtc: '2026-05-17T00:00:00Z',
    };

    expect(contract.owner).toBeUndefined();
    expect(chain.height).toBe(0);
    expect(nexus.protocol).toBe(0);
    expect(organization.metadata?.[0]?.key).toBe('role');
    expect(organization.memberCount).toBe('2');
    expect(organizationMember.isMember).toBe(true);
    expect(leaderboard.rows).toBeUndefined();
    expect(archive.blockCount).toBe(0);
    expect(config.fuelPerContractDeploy).toBe('1');
    expect(version.commit).toBe('abc123');
  });

  it('matches script and account transaction response envelopes', () => {
    const script: Script = {
      events: [],
      result: '',
      error: '',
      results: [],
      oracles: [],
    };
    const accountTransactions: Paginated<AccountTransactions> = {
      page: 1,
      pageSize: 1,
      total: 0,
      totalPages: 0,
      result: {
        address: 'P2KCAUqELn3ooqVNvQGnoBdoth23ZUiMka67D6LQboyubzY',
        txs: [],
      },
    };

    expect(script.results).toEqual([]);
    expect(accountTransactions.result.txs).toEqual([]);
  });

  it('matches current account responses that omit deprecated fields', () => {
    // Current GetAccount responses may omit the deprecated `txs` field and the
    // optional relay balance field. The SDK should not type them as mandatory.
    const account: Account = {
      address: 'P2KCAUqELn3ooqVNvQGnoBdoth23ZUiMka67D6LQboyubzY',
      name: '',
      stakes: {
        amount: '0',
        time: 0,
        unclaimed: '0',
      },
      stake: '0',
      unclaimed: '0',
      validator: '',
      storage: {
        available: 0,
        used: 0,
        avatar: '',
        archives: [],
      },
      balances: [],
    };

    expect(account.address).toMatch(/^P/);
  });

  it('matches current transaction, event, signature, and block responses', () => {
    // Transaction signatures are emitted with lowercase `kind` and `data`.
    // Blocks may omit empty block-level event/oracle arrays from JSON output.
    const transaction: TransactionData = {
      hash: 'C28EF8AA80ECDEFBA4A7F8B841BFF7EC4A5E86692221AFE00C5118D40B576F0F',
      chainAddress: 'S3d7TbZxtNPdXy11hfmBLJLYn67gZTG2ibL7fJBcVdihWU4',
      timestamp: 1778789444,
      blockHeight: 8814948,
      blockHash: '0063FB314FC01CD38DA0D7B566055B3A2CB5F0FB41DEC19436C8B4AC1B18760B',
      script: '',
      carbonTxType: 0,
      carbonTxData:
        '00000000020000007400000042000000000000000100000002000000070000005C00000003000000330000000000000054415A00000000000000000000000000100000003B000000000000004300000000000000000000000000100000003C0000000000000054455354544F4B454E0000000000000000000000000010000000',
      payload: '52657061697220756E6C696D6974656420736D616C6C2066756E6769626C6520746F6B656E73',
      debugComment: '',
      events: [
        {
          address: 'P2KJPYSJ4kkixUFpDKJDXGH7T8pmxb7TKA7LrbmH3Psyv2s',
          contract: 'governance',
          kind: 'SpecialResolution',
          name: 'SpecialResolution',
          data: '4200000000000000',
        },
      ],
      extendedEvents: [
        {
          address: 'P2KJPYSJ4kkixUFpDKJDXGH7T8pmxb7TKA7LrbmH3Psyv2s',
          contract: 'governance',
          kind: 'SpecialResolution',
          data: {
            resolutionId: 66,
            description: 'Repair unlimited small fungible tokens',
            calls: [],
          },
        },
      ],
      result: '',
      fee: '0',
      state: 'Halt',
      signatures: [
        {
          kind: 'Ed25519',
          data: '9216A4024F135656C1A9BA0DD90A42C2B84E771ECAD9DDCEE8434470AB424FA9E3BF623DF6EA1D67E5C1FFC5C00973AF9238D9718156820A78DA1D3594056405',
        },
      ],
      sender: 'P2KJPYSJ4kkixUFpDKJDXGH7T8pmxb7TKA7LrbmH3Psyv2s',
      gasPayer: 'P2KJPYSJ4kkixUFpDKJDXGH7T8pmxb7TKA7LrbmH3Psyv2s',
      gasTarget: 'S3d7TbZxtNPdXy11hfmBLJLYn67gZTG2ibL7fJBcVdihWU4',
      gasPrice: '1',
      gasLimit: '18446744073709551615',
      expiration: 0,
    };

    // Pre-gas-model-v2 block: the producerAddress key is omitted, so the optional stays undefined.
    const block: Block = {
      hash: transaction.blockHash,
      previousHash: 'B155ED33B5E34F40FCBFD7EC9B2537C2243E0F33D520CC3D2C71298487E7100A',
      timestamp: transaction.timestamp,
      height: transaction.blockHeight,
      chainAddress: transaction.chainAddress,
      protocol: 19,
      txs: [transaction],
      validatorAddress: transaction.sender,
      reward: '0',
    };

    // Gas-model-v2 block: producerAddress is present and distinct in meaning from validatorAddress.
    const v2Block: Block = {
      ...block,
      producerAddress: transaction.sender,
    };

    expect(block.txs[0]?.signatures[0]?.kind).toBe('Ed25519');
    expect(block.producerAddress).toBeUndefined();
    expect(v2Block.producerAddress).toBe(transaction.sender);
    const transactionWithoutDebugComment: TransactionData = { ...transaction };
    delete transactionWithoutDebugComment.debugComment;
    expect(transactionWithoutDebugComment.debugComment).toBeUndefined();
  });
});

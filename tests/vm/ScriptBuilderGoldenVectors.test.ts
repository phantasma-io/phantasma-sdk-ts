import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

import { Address, PhantasmaKeys, ScriptBuilder, Timestamp } from '../../src/core';

const FIXTURE = path.join(process.cwd(), 'tests', 'fixtures', 'vm_script_builder_vectors.tsv');
const SCRIPT_BUILDER_FIXTURE_SHA256 =
  '81907a6b1df095b84599d8f8d709623e20dadeca2082ab9dffef114c7d0015e0';

describe('ScriptBuilder golden vectors', () => {
  test('fixture hash is locked', () => {
    const digest = createHash('sha256').update(fs.readFileSync(FIXTURE)).digest('hex');
    expect(digest).toBe(SCRIPT_BUILDER_FIXTURE_SHA256);
  });

  test.each(scriptVectorRows())('matches %s', (caseId, source, expectedHex, notes) => {
    expect(source).toBe('csharp_sdk');
    expect(scriptBuilderVector(caseId)).toBe(expectedHex);
    expect(notes).toBeTruthy();
  });
});

function scriptVectorRows(): string[][] {
  return fs
    .readFileSync(FIXTURE, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('case_id\t'))
    .map((line) => line.split('\t'));
}

function scriptBuilderVector(caseId: string): string {
  // Deterministic, non-funded fixture keys used only to reproduce the shared
  // Gen2 C# golden scripts.
  const mainKeys = PhantasmaKeys.fromWIF('L5UEVHBjujaR1721aZM5Zm5ayjDyamMZS9W35RE9Y9giRkdf3dVx');
  const helperKeys = PhantasmaKeys.fromWIF('KxMn2TgXukYaNXx7tEdjh7qB2YaMgeuKy47j4rvKigHhBuZWeP3r');
  const address = helperKeys.Address;
  const nullAddress = Address.Null;

  switch (caseId) {
    case 'consensus_single_vote':
      return new ScriptBuilder()
        .BeginScript()
        .AllowGas(mainKeys.Address, nullAddress, 10000n, 210000n)
        .CallContract('consensus', 'SingleVote', [
          mainKeys.Address.Text,
          'system.nexus.protocol.version',
          0n,
        ])
        .SpendGas(mainKeys.Address)
        .EndScript();
    case 'gas_transfer_spend':
      return new ScriptBuilder()
        .BeginScript()
        .AllowGas(address, nullAddress, 100000n, 21000n)
        .TransferTokens('SOUL', address, nullAddress, 100000000n)
        .SpendGas(address)
        .EndScript();
    case 'mint_tokens':
      return new ScriptBuilder()
        .BeginScript()
        .MintTokens('SOUL', address, nullAddress, 1n)
        .EndScript();
    case 'transfer_balance':
      return new ScriptBuilder()
        .BeginScript()
        .TransferBalance('KCAL', address, nullAddress)
        .EndScript();
    case 'transfer_nft':
      return new ScriptBuilder()
        .BeginScript()
        .TransferNFT('ART', address, nullAddress, 42n)
        .EndScript();
    case 'cross_transfer_token':
      return new ScriptBuilder()
        .BeginScript()
        .CrossTransferToken(nullAddress, 'SOUL', address, nullAddress, 1n)
        .EndScript();
    case 'cross_transfer_nft':
      return new ScriptBuilder()
        .BeginScript()
        .CrossTransferNFT(nullAddress, 'ART', address, nullAddress, 7n)
        .EndScript();
    case 'stake_unstake':
      return new ScriptBuilder().BeginScript().Stake(address, 7n).Unstake(address, 8n).EndScript();
    case 'call_nft':
      return new ScriptBuilder().BeginScript().CallNFT('ART', 7n, 'mint', [address]).EndScript();
    case 'runtime_array_timestamp':
      return new ScriptBuilder()
        .BeginScript()
        .CallInterop('Runtime.Test', [['alpha', 7n], new Timestamp(1778330400)])
        .EndScript();
    default:
      throw new Error(`unhandled script vector: ${caseId}`);
  }
}

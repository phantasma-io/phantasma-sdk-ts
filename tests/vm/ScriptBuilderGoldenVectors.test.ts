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
  const address = helperKeys.address;
  const nullAddress = Address.nullAddress;

  switch (caseId) {
    case 'consensus_single_vote':
      return new ScriptBuilder()
        .beginScript()
        .allowGas(mainKeys.address, nullAddress, 10000n, 210000n)
        .callContract('consensus', 'SingleVote', [
          mainKeys.address.text,
          'system.nexus.protocol.version',
          0n,
        ])
        .spendGas(mainKeys.address)
        .endScript();
    case 'gas_transfer_spend':
      return new ScriptBuilder()
        .beginScript()
        .allowGas(address, nullAddress, 100000n, 21000n)
        .transferTokens('SOUL', address, nullAddress, 100000000n)
        .spendGas(address)
        .endScript();
    case 'mint_tokens':
      return new ScriptBuilder()
        .beginScript()
        .mintTokens('SOUL', address, nullAddress, 1n)
        .endScript();
    case 'transfer_balance':
      return new ScriptBuilder()
        .beginScript()
        .transferBalance('KCAL', address, nullAddress)
        .endScript();
    case 'transfer_nft':
      return new ScriptBuilder()
        .beginScript()
        .transferNft('ART', address, nullAddress, 42n)
        .endScript();
    case 'cross_transfer_token':
      return new ScriptBuilder()
        .beginScript()
        .crossTransferToken(nullAddress, 'SOUL', address, nullAddress, 1n)
        .endScript();
    case 'cross_transfer_nft':
      return new ScriptBuilder()
        .beginScript()
        .crossTransferNft(nullAddress, 'ART', address, nullAddress, 7n)
        .endScript();
    case 'stake_unstake':
      return new ScriptBuilder().beginScript().stake(address, 7n).unstake(address, 8n).endScript();
    case 'call_nft':
      return new ScriptBuilder().beginScript().callNft('ART', 7n, 'mint', [address]).endScript();
    case 'runtime_array_timestamp':
      return new ScriptBuilder()
        .beginScript()
        .callInterop('Runtime.Test', [['alpha', 7n], new Timestamp(1778330400)])
        .endScript();
    default:
      throw new Error(`unhandled script vector: ${caseId}`);
  }
}

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(root, 'node_modules', '.cache');
fs.mkdirSync(tempRoot, { recursive: true });
const tempDir = fs.mkdtempSync(path.join(tempRoot, 'phantasma-sdk-public-types-'));
const tscBin = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');

const compilerArgs = [
  tscBin,
  '--ignoreConfig',
  '--noEmit',
  '--pretty',
  'false',
  '--strict',
  '--skipLibCheck',
  '--target',
  'ES2020',
  '--module',
  'NodeNext',
  '--moduleResolution',
  'NodeNext',
  '--types',
  'node',
];

function writeFile(name, source) {
  const file = path.join(tempDir, name);
  fs.writeFileSync(file, source);
  return file;
}

function runTsc(file) {
  return spawnSync(process.execPath, [...compilerArgs, file], {
    cwd: root,
    encoding: 'utf8',
  });
}

function expectTscSuccess(file) {
  const result = runTsc(file);
  if (result.status !== 0) {
    throw new Error(
      `Expected ${path.basename(file)} to compile:\n${result.stdout}${result.stderr}`
    );
  }
}

function expectTscFailure(file, expectedText) {
  const result = runTsc(file);
  const output = `${result.stdout}${result.stderr}`;
  if (result.status === 0 || !output.includes(expectedText)) {
    throw new Error(
      `Expected ${path.basename(file)} to fail with ${expectedText}:\n${output || '<no output>'}`
    );
  }
}

const publicConsumer = writeFile(
  'public-consumer.ts',
  `
import {
  Address,
  ContractInterface,
  PhantasmaKeys,
  ScriptBuilder,
  Transaction,
  type ContractDescriptor,
  type KeyPair,
  type LinkAccount,
  type StackLike,
} from 'phantasma-sdk-ts/public';

const keys = PhantasmaKeys.generate();
const keyPair: KeyPair = keys;
const address = Address.fromPublicKey(keyPair.publicKey);
const script = new ScriptBuilder().beginScript().emitVarString(address.text).endScript();
const tx = new Transaction('testnet', 'main', script, new Date('2026-01-01T00:00:00Z'), '');
const decoded = Transaction.fromBytes(tx.toByteArray(false));

const values: number[] = [];
const stack: StackLike<number> = {
  push(item) {
    values.push(item);
  },
  pop() {
    return values.pop();
  },
  peek() {
    return values[values.length - 1];
  },
  size() {
    return values.length;
  },
};

const account: LinkAccount = {
  alias: 'main',
  name: 'Main',
  address: Address.nullText,
  avatar: '',
  platform: 'phantasma',
  external: '',
  balances: [],
  files: [],
};

const contract: ContractDescriptor = { name: 'account', abi: ContractInterface.Empty };

void decoded;
void stack;
void account;
void contract;
`
);

const legacyRootConsumer = writeFile(
  'legacy-root-consumer.ts',
  `
import type { IKeyPair } from 'phantasma-sdk-ts';

const legacy: IKeyPair | null = null;
void legacy;
`
);

const deepImportConsumer = writeFile(
  'deep-import-consumer.ts',
  `
import { Transaction as NewTransaction } from 'phantasma-sdk-ts/tx/transaction';
import { ScriptBuilder as NewScriptBuilder } from 'phantasma-sdk-ts/vm';
import { Address as NewAddress } from 'phantasma-sdk-ts/types/address';
import { Bytes32 as NewBytes32 } from 'phantasma-sdk-ts/types/carbon/bytes32';
import { PhantasmaLink as NewPhantasmaLink } from 'phantasma-sdk-ts/link/phantasma-link';
import { Transaction as LegacyTransaction } from 'phantasma-sdk-ts/core/tx/Transaction';
import { ScriptBuilder as LegacyScriptBuilder } from 'phantasma-sdk-ts/core/vm';
import { Address as LegacyAddress } from 'phantasma-sdk-ts/core/types/Address';

const script = new NewScriptBuilder().beginScript().emitVarString('deep-imports').endScript();
const tx = new NewTransaction('testnet', 'main', script, new Date('2026-01-01T00:00:00Z'), '');
const legacyTx = LegacyTransaction.fromBytes(tx.toByteArray(false));
const legacyScript = new LegacyScriptBuilder().beginScript().emitVarString('legacy').endScript();

void legacyTx;
void legacyScript;
void NewAddress.nullText;
void NewBytes32;
void NewPhantasmaLink;
void LegacyAddress.NullText;
`
);

const legacyPublicConsumer = writeFile(
  'legacy-public-consumer.ts',
  `
import type { IKeyPair } from 'phantasma-sdk-ts/public';

const legacy: IKeyPair | null = null;
void legacy;
`
);

try {
  expectTscSuccess(publicConsumer);
  expectTscSuccess(legacyRootConsumer);
  expectTscSuccess(deepImportConsumer);
  expectTscFailure(legacyPublicConsumer, "has no exported member named 'IKeyPair'");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

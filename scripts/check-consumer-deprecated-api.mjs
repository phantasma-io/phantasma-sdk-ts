import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const workDir = path.join(root, 'node_modules', '.cache', 'sdk-deprecated-consumer-check');
const declarationsDir = path.join(workDir, 'types');

fs.rmSync(workDir, { recursive: true, force: true });
fs.mkdirSync(workDir, { recursive: true });

buildDeclarations();

writeFile(
  'tsconfig.json',
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        baseUrl: root,
        paths: {
          'phantasma-sdk-ts': [path.join(declarationsDir, 'index.d.ts')],
          'phantasma-sdk-ts/*': [path.join(declarationsDir, '*')],
        },
        types: ['node'],
        typeRoots: [path.join(root, 'node_modules', '@types')],
      },
      include: ['*.ts'],
    },
    null,
    2
  )
);

writeFile(
  'eslint.config.mjs',
  `
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';

const tsconfigRootDir = path.dirname(fileURLToPath(import.meta.url));

export default [
  {
    files: ['*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      '@typescript-eslint/no-deprecated': 'error',
    },
  },
];
`
);

writeFile(
  'modern-consumer.ts',
  `
import {
  Address,
  ContractInterface,
  ContractMethod,
  Ed25519Signature,
  PBinaryWriter,
  PhantasmaKeys,
  ScriptBuilder,
  SignatureKind,
  Transaction,
  VMObject,
  VMType,
} from 'phantasma-sdk-ts/public';

const keys = PhantasmaKeys.generate();
const script = new ScriptBuilder().beginScript().emitVarString('modern').endScript();
const tx = new Transaction('simnet', 'main', script, new Date(), '');
tx.signWithKeys(keys);
const encoded = tx.toStringEncoded(true);
const decoded = Transaction.fromHex(encoded);
decoded.verifySignature(keys.address);
const sig = Ed25519Signature.generate(keys, tx.getUnsignedBytes());
const kind: SignatureKind = sig.kind;
const bytes: Uint8Array = sig.bytes;
const vm = VMObject.fromBytes(new Uint8Array([0]));
vm.type = VMType.String;
vm.data = 'x';
vm.asString();
const contract = new ContractInterface([new ContractMethod('getName', VMType.String, 0, [])], []);
const methods = contract.methods;
const count = contract.methodCount;
contract.findMethod('getName');
Address.nullAddress.toByteArray();
const writer = new PBinaryWriter();
tx.serializeData(writer);
void [decoded, kind, bytes, vm, methods, count, writer];
`
);

writeFile(
  'legacy-consumer.ts',
  `
import {
  Address,
  ContractInterface,
  ContractMethod,
  Ed25519Signature,
  PBinaryWriter,
  PhantasmaKeys,
  ScriptBuilder,
  SignatureKind,
  Transaction,
  VMObject,
  VMType,
} from 'phantasma-sdk-ts/public';

const keys = PhantasmaKeys.generate();
const script = new ScriptBuilder().BeginScript().EmitVarString('legacy').EndScript();
const tx = new Transaction('simnet', 'main', script, new Date(), '');
tx.signWithKeys(keys);
const encoded = tx.ToStringEncoded(true);
const decoded = Transaction.FromBytes(encoded);
decoded.VerifySignature(keys.Address);
const sig = Ed25519Signature.Generate(keys, tx.GetUnsignedBytes());
const kind: SignatureKind = sig.Kind;
const bytes: Uint8Array = sig.Bytes;
const vm = VMObject.FromBytes(new Uint8Array([0]));
vm.Type = VMType.String;
vm.Data = 'x';
vm.AsString();
const contract = new ContractInterface([new ContractMethod('getName', VMType.String, 0, [])], []);
const methods = contract.Methods;
const count = contract.MethodCount;
contract.FindMethod('getName');
Address.Null.ToByteArray();
const writer = new PBinaryWriter();
tx.SerializeData(writer);
void [decoded, kind, bytes, vm, methods, count, writer];
`
);

runExpectedClean('modern-consumer.ts');
runExpectedDeprecated('legacy-consumer.ts');

function buildDeclarations() {
  const tscBin = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  const declarationJsOutDir = path.join(workDir, 'cjs');
  const result = spawnSync(
    process.execPath,
    [
      tscBin,
      '-p',
      path.join(root, 'tsconfig.cjs.json'),
      '--emitDeclarationOnly',
      '--declarationDir',
      declarationsDir,
      '--outDir',
      declarationJsOutDir,
    ],
    {
      cwd: root,
      encoding: 'utf8',
    }
  );

  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error('Failed to build fresh SDK declarations for deprecated API consumer check');
  }
}

function writeFile(name, content) {
  fs.writeFileSync(path.join(workDir, name), content.trimStart());
}

function runEslint(fileName) {
  const eslintBin = path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');
  return spawnSync(
    process.execPath,
    [eslintBin, '--config', path.join(workDir, 'eslint.config.mjs'), '--format', 'json', fileName],
    {
      cwd: workDir,
      encoding: 'utf8',
    }
  );
}

function runExpectedClean(fileName) {
  const result = runEslint(fileName);
  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`${fileName} unexpectedly reported deprecated API usage`);
  }
}

function runExpectedDeprecated(fileName) {
  const result = runEslint(fileName);
  if (result.status === 0) {
    throw new Error(`${fileName} did not report deprecated API usage`);
  }

  let reports;
  try {
    reports = JSON.parse(result.stdout);
  } catch {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`${fileName} did not produce parseable ESLint JSON`);
  }

  const messages = reports.flatMap((report) =>
    report.messages.filter((message) => message.ruleId === '@typescript-eslint/no-deprecated')
  );
  if (messages.length < 10) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`${fileName} reported too few deprecated API diagnostics: ${messages.length}`);
  }
}

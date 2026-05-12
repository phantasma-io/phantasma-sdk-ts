import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const requiredRootExports = [
  'PhantasmaAPI',
  'PhantasmaTS',
  'PhantasmaLink',
  'EasyConnect',
  'isRpcErrorResult',
  'unwrapRpcResult',
];
const requiredPublicExports = [
  'Address',
  'Base16',
  'Bytes32',
  'isRpcErrorResult',
  'PhantasmaAPI',
  'PhantasmaKeys',
  'ScriptBuilder',
  'Transaction',
  'TxMsg',
  'unwrapRpcResult',
  'VMObject',
];
const excludedPublicExports = ['PhantasmaTS', 'IKeyPair', 'IContract', 'IToken', 'ISerializable'];
const deepImportChecks = [
  ['phantasma-sdk-ts/core/tx/Transaction', ['Transaction']],
  ['phantasma-sdk-ts/core/vm', ['ScriptBuilder', 'VMObject']],
  ['phantasma-sdk-ts/core/types/Address', ['Address']],
  ['phantasma-sdk-ts/core/types/Carbon/Bytes32', ['Bytes32']],
  ['phantasma-sdk-ts/tx/transaction', ['Transaction']],
  ['phantasma-sdk-ts/vm', ['ScriptBuilder', 'VMObject']],
  ['phantasma-sdk-ts/types/address', ['Address']],
  ['phantasma-sdk-ts/types/carbon/bytes32', ['Bytes32']],
  [
    'phantasma-sdk-ts/types/carbon/blockchain/modules/token-contract-methods',
    ['TokenContractMethods'],
  ],
  ['phantasma-sdk-ts/link/phantasma-link', ['PhantasmaLink']],
  ['phantasma-sdk-ts/ledger/ledger-utils', ['getPublicKey']],
  ['phantasma-sdk-ts/rpc/rpc-result', ['isRpcErrorResult', 'unwrapRpcResult']],
];
const forbiddenDeepImports = [
  'phantasma-sdk-ts/scripts/check-package-exports',
  'phantasma-sdk-ts/tsconfig.base',
];

function assertExports(moduleName, moduleApi, requiredExports) {
  for (const name of requiredExports) {
    if (!(name in moduleApi)) {
      throw new Error(`${moduleName} is missing export ${name}`);
    }
  }
}

function assertNoExports(moduleName, moduleApi, excludedExports) {
  for (const name of excludedExports) {
    if (name in moduleApi) {
      throw new Error(`${moduleName} unexpectedly exports ${name}`);
    }
  }
}

function isPackagePathNotExported(error) {
  return (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED'
  );
}

function assertNotExported(moduleName) {
  try {
    require(moduleName);
  } catch (error) {
    if (!isPackagePathNotExported(error)) {
      throw error;
    }
    return;
  }
  throw new Error(`CommonJS ${moduleName} should not be exported`);
}

async function assertNotExportedEsm(moduleName) {
  try {
    await import(moduleName);
  } catch (error) {
    if (!isPackagePathNotExported(error)) {
      throw error;
    }
    return;
  }
  throw new Error(`ESM ${moduleName} should not be exported`);
}

function exercisePublicApi(publicApi) {
  const keys = publicApi.PhantasmaKeys.generate();
  const address = publicApi.Address.fromPublicKey(keys.publicKey);
  if (address.text !== keys.address.text) {
    throw new Error('public entrypoint Address.fromPublicKey did not match generated key address');
  }

  const script = new publicApi.ScriptBuilder().beginScript().emitVarString('exports').endScript();
  const tx = new publicApi.Transaction(
    'testnet',
    'main',
    script,
    new Date('2026-01-01T00:00:00Z'),
    ''
  );
  const decoded = publicApi.Transaction.fromBytes(tx.toByteArray(false));
  if (decoded.toStringEncoded(false) !== tx.toStringEncoded(false)) {
    throw new Error('public entrypoint Transaction.fromBytes did not round-trip');
  }

  const rpcError = { error: 'public rpc error' };
  if (!publicApi.isRpcErrorResult(rpcError)) {
    throw new Error('public entrypoint isRpcErrorResult did not detect an RPC error');
  }
  try {
    publicApi.unwrapRpcResult(rpcError);
  } catch {
    return;
  }
  throw new Error('public entrypoint unwrapRpcResult did not throw on an RPC error');
}

const cjsRoot = require('phantasma-sdk-ts');
const cjsPublic = require('phantasma-sdk-ts/public');
const esmRoot = await import('phantasma-sdk-ts');
const esmPublic = await import('phantasma-sdk-ts/public');

assertExports('CommonJS root export', cjsRoot, requiredRootExports);
assertExports('ESM root export', esmRoot, requiredRootExports);
assertExports('CommonJS public export', cjsPublic, requiredPublicExports);
assertExports('ESM public export', esmPublic, requiredPublicExports);
assertNoExports('CommonJS public export', cjsPublic, excludedPublicExports);
assertNoExports('ESM public export', esmPublic, excludedPublicExports);
exercisePublicApi(cjsPublic);
exercisePublicApi(esmPublic);

for (const [moduleName, requiredExports] of deepImportChecks) {
  assertExports(`CommonJS ${moduleName}`, require(moduleName), requiredExports);
  assertExports(`ESM ${moduleName}`, await import(moduleName), requiredExports);
}

for (const moduleName of forbiddenDeepImports) {
  assertNotExported(moduleName);
  await assertNotExportedEsm(moduleName);
}

import fs from 'fs';
import path from 'path';

const root = process.cwd();
const allowedCompatibilityTest = path.normalize('tests/api/DeprecatedCompatibility.test.ts');

const deprecatedPatterns = [
  /\bAddress\.(?:NullText|LengthInBytes|MaxPlatformNameLength|Null|FromPublickKey|FromText|Parse|IsValidAddress|FromBytes|FromKey|FromHash|FromWif)\b/,
  /\bTransaction\.(?:FromBytes|Unserialize)\b/,
  /\bVMObject\.(?:GetVMType|IsVMType|ValidateStructKey|FromArray|CastTo|FromObject|FromEnum|FromStruct|FromBytes)\b/,
  /\bEntropy\.GetRandomBytes\b/,
  /\bEd25519Signature\.Generate\b/,
  /\b(?:GetAddressFromPrivateKey|GetAddressFromPublicKey|GetAddressPublicKeyFromPublicKey|GetAddressFromLedeger)\b/,
  /\b(?:Bip44Path|ErrorDescriptions|GetErrorMessage|GetDevice|GetApplicationName|GetVersion|GetBip44PathMessage|ChunkString|SplitMessageIntoChunks|DecodeSignature|SignLedger)\b/,
  /\b(?:GetPrivateKeyFromMnemonic|GetPrivateKeyFromSeed|GetPoltergeistMnemonic|GetBip44Path)\b/,
  /\b(?:PrivateToDer|PublicToDer|PublicToPem|SignBytes|GetHash|GetPublicFromPrivate)\b/,
  /\b(?:Sign|Verify)\s*\(/,
  /\b(?:GetDateAsUTCSeconds|GetExpirationDate|EncodeSendTxWithSignature|EncodeSendTxWithoutSignature)\b/,
  /\b(?:LeftPad|ToWholeNumber|GetLedgerDeviceInfo|GetLedgerAccountSigner|GetLedgerSignerData|GetBalanceFromLedger|GetBalanceFromPrivateKey|GetBalanceFromMnemonic|SignEncodedTx)\b/,
  /\bTokenContract_Methods\b/,
  /\bSerialization\.(?:RegisterType|SerializeEnum|Serialize|SerializeObject|Unserialize|UnserializeObject)\b/,
  /\bCarbonBlob\.(?:New|NewFromBytes|NewFromBytesEx|Serialize)\b/,
  /\bAddress\.(?:NullText|LengthInBytes|MaxPlatformNameLength|Null)\b/,
  /\.(?:Text|IsSystem|IsInterop|IsUser|IsNull)\b/,
  /\.(?:GetPublicKey|ToByteArray|Verify|VerifyMultiple|ToHex)\b/,
  /\.(?:ToByteAray|VerifySignature|VerifySignatures|GetUnsignedBytes|GetSignatureInfo|ToStringEncoded)\b/,
  /\.(?:BeginScript|GetScript|EndScript|EmitThorw|EmitPush|EmitPop|EmitExtCall|EmitBigInteger|EmitAddress|RawString|EmitLoad|EmitLoadBytes|EmitLoadArray|EmitLoadISerializable|EmitLoadVMObject|EmitLoadEnum|EmitLoadAddress|EmitLoadTimestamp|EmitLoadVarInt|EmitMove|EmitCopy|EmitLabel|EmitJump|EmitCall|EmitConditionalJump|InsertMethodArgs|CallInterop|CallContract|AllowGas|SpendGas|MintTokens|TransferTokens|TransferBalance|TransferNFT|CrossTransferToken|CrossTransferNFT|Stake|Unstake|CallNFT|EmitTimestamp|EmitByteArray|EmitVarString|EmitVarInt|EmitUInt32|EmitBytes|ByteToHex|AppendByte|AppendBytes|AppendUshort|AppendHexEncoded)\b/,
  /\.(?:GetChildren|AsTimestamp|AsByteArray|AsString|ToString|AsNumber|AsEnum|GetArrayType|AsType|AsBool|ToArray|ToObjectType|ToObject|ToStruct|SetValue|CastViaReflection|SetKey|Copy|SetType|SerializeObjectCall)\b/,
  /\b(?:IsEmpty|Size)\b/,
];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.isFile() && fullPath.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function stripStringsAndLineComments(line) {
  if (/^\s*(?:\/\*|\*)/u.test(line)) {
    return '';
  }
  return line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '').replace(/\/\/.*$/u, '');
}

const files = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'tests'))];
const violations = [];

for (const file of files) {
  const rel = path.relative(root, file);
  if (path.normalize(rel) === allowedCompatibilityTest) {
    continue;
  }

  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/u);
  let deprecationWindow = 0;
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (rawLine.includes('@deprecated')) {
      deprecationWindow = 10;
      continue;
    }

    const codeLine = stripStringsAndLineComments(rawLine);
    const hasDeprecatedUsage = deprecatedPatterns.some((pattern) => pattern.test(codeLine));
    if (hasDeprecatedUsage && deprecationWindow <= 0) {
      violations.push(`${rel}:${i + 1}: ${rawLine.trim()}`);
    }

    if (deprecationWindow > 0) {
      deprecationWindow--;
    }
  }
}

if (violations.length > 0) {
  console.error('Deprecated API names must not be used outside compatibility wrappers/tests:');
  for (const violation of violations) {
    console.error(`  ${violation}`);
  }
  process.exit(1);
}

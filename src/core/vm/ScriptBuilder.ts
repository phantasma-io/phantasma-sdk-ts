import base58 from 'bs58';
import { ISerializable } from '../interfaces/index.js';
import { bigIntToTwosComplementLE } from '../types/CarbonSerialization.js';
import { Address, PBinaryWriter, Serialization, Timestamp } from '../types/index.js';
import { numberToByteArray, stringToUint8Array, bytesToHex } from '../utils/index.js';
import { Opcode } from './Opcode.js';
import { VMObject } from './VMObject.js';
import { VMType } from './VMType.js';
import { Contracts } from './Contracts.js';

type byte = number;

const MaxRegisterCount = 32;

type ScriptLoadValue = unknown;

function isSerializableLike(obj: unknown): obj is ISerializable {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'UnserializeData' in obj &&
    'SerializeData' in obj &&
    typeof (obj as ISerializable).UnserializeData === 'function' &&
    typeof (obj as ISerializable).SerializeData === 'function'
  );
}

export class ScriptBuilder {
  _labelLocations: { [id: string]: number } = {};
  _jumpLocations: { [id: number]: string } = {};

  public str: string;

  public writer: PBinaryWriter;

  public NullAddress = 'S1111111111111111111111111111111111';

  public static ScriptBuilder(): ScriptBuilder {
    return new ScriptBuilder();
  }

  public constructor() {
    this.str = '';
    this.writer = new PBinaryWriter();
  }

  public BeginScript() {
    this.str = '';
    this.writer = new PBinaryWriter();
    return this;
  }

  public GetScript(): string {
    return bytesToHex(this.writer.toUint8Array());
  }

  public EndScript(): string {
    this.Emit(Opcode.RET);
    return bytesToHex(this.writer.toUint8Array()).toUpperCase();
  }

  public Emit(opcode: Opcode, bytes?: number[]): this {
    this.AppendByte(opcode);
    if (bytes) {
      this.EmitBytes(bytes);
    }
    return this;
  }

  public EmitThorw(reg: byte): this {
    this.Emit(Opcode.THROW);
    this.AppendByte(reg);
    return this;
  }

  public EmitPush(reg: byte): this {
    this.Emit(Opcode.PUSH);
    this.AppendByte(reg);
    return this;
  }

  public EmitPop(reg: byte): this {
    this.Emit(Opcode.POP);
    this.AppendByte(reg);
    return this;
  }

  public EmitExtCall(method: string, reg: byte = 0): this {
    this.EmitLoad(reg, method);
    this.Emit(Opcode.EXTCALL);
    this.AppendByte(reg);
    return this;
  }

  public EmitBigInteger(value: string) {
    let bytes: number[] = [];

    if (value == '0') {
      bytes = [0];
    } else if (value.startsWith('-1')) {
      throw new Error('Unsigned bigint serialization not suppoted');
    } else {
      let hex = BigInt(value).toString(16);
      if (hex.length % 2) hex = '0' + hex;
      const len = hex.length / 2;
      let i = 0;
      let j = 0;
      while (i < len) {
        bytes.unshift(parseInt(hex.slice(j, j + 2), 16)); // little endian
        i += 1;
        j += 2;
      }
      bytes.push(0); // add sign at the end
    }
    return this.EmitByteArray(bytes);
  }

  public EmitAddress(textAddress: string) {
    const bytes = [...base58.decode(textAddress.substring(1))];
    return this.EmitByteArray(bytes);
  }

  RawString(value: string) {
    //let bytes = stringToUint8Array(value);
    //console.log(Array.from(bytes))
    //return Array.from(bytes);
    const data = [];
    for (let i = 0; i < value.length; i++) {
      data.push(value.charCodeAt(i));
    }
    return data;
  }

  private EmitLoadBigInt(reg: number, value: bigint): this {
    const bytes = Array.from(bigIntToTwosComplementLE(value));
    this.EmitLoadBytes(reg, bytes, VMType.Number);
    return this;
  }

  public EmitLoad(reg: number, obj: ScriptLoadValue): this {
    switch (typeof obj) {
      case 'string': {
        const bytes = this.RawString(obj);
        this.EmitLoadBytes(reg, bytes, VMType.String);
        break;
      }

      case 'boolean': {
        const bytes = [(obj as boolean) ? 1 : 0];
        this.EmitLoadBytes(reg, bytes, VMType.Bool);
        break;
      }

      case 'bigint': {
        this.EmitLoadBigInt(reg, obj as bigint);
        break;
      }

      case 'number': {
        // obj is BigInteger
        // var bytes = val.ToSignedByteArray();
        // this.emitLoadBytes(reg, bytes, VMType.Number);
        //let bytes = this.RawString(BigInt(obj).toString());
        // this.EmitLoadVarInt(reg, obj);
        const bytes = this.RawString(obj.toString());
        this.EmitLoadBytes(reg, bytes, VMType.String);
        break;
      }

      case 'object':
        if (obj === null) {
          throw Error('Load type object not supported');
        }
        if (obj instanceof Uint8Array) {
          this.EmitLoadBytes(reg, Array.from(obj));
        } else if (obj instanceof VMObject) {
          this.EmitLoadVMObject(reg, obj);
        } else if (Array.isArray(obj)) {
          this.EmitLoadArray(reg, obj);
        } else if (obj instanceof Date || obj instanceof Timestamp) {
          this.EmitLoadTimestamp(reg, obj);
        } else if (obj instanceof Address) {
          this.EmitLoadAddress(reg, obj);
        } else if (isSerializableLike(obj)) {
          this.EmitLoadISerializable(reg, obj);
        } else {
          if (Array.isArray(obj)) {
            this.EmitLoadArray(reg, obj);
          } else {
            throw Error('Load type ' + typeof obj + ' not supported');
          }
        }
        break;
      default:
        throw Error('Load type ' + typeof obj + ' not supported');
    }
    return this;
  }

  public EmitLoadBytes(reg: number, bytes: byte[], type: VMType = VMType.Bytes): this {
    if (bytes.length > 0xffff) throw new Error('tried to load too much data');
    this.Emit(Opcode.LOAD);
    this.AppendByte(reg);
    this.AppendByte(type);

    this.EmitVarInt(bytes.length);
    this.EmitBytes(bytes);
    return this;
  }

  public EmitLoadArray(reg: number, obj: unknown[]): this {
    this.Emit(Opcode.CAST, [reg, reg, VMType.None]);

    for (let i = 0; i < obj.length; i++) {
      const element = obj[i];
      const temp_regVal = reg + 1;
      const temp_regKey = reg + 2;

      this.EmitLoad(temp_regVal, element);
      this.EmitLoad(temp_regKey, BigInt(i));
      this.Emit(Opcode.PUT, [temp_regVal, reg, temp_regKey]);
      //this.EmitLoad(reg, element);
      //this.EmitPush(reg);
      //reg++;
    }

    return this;
  }

  public EmitLoadISerializable(reg: number, obj: ISerializable): this {
    const writer: PBinaryWriter = new PBinaryWriter();
    obj.SerializeData(writer);
    this.EmitLoadBytes(reg, writer.toArray(), VMType.Bytes);
    return this;
  }

  public EmitLoadVMObject(reg: number, obj: VMObject): this {
    const writer: PBinaryWriter = new PBinaryWriter();
    const result = obj.SerializeObjectCall(writer);

    this.Emit(Opcode.LOAD);
    this.AppendByte(reg);
    this.AppendByte(obj.Type);

    if (result == undefined) {
      //console.log("enter");
      if (obj.Data instanceof Map || (obj.Data instanceof Map && obj.Data instanceof VMObject)) {
        const resultData = obj.Data as Map<VMObject, VMObject>;
        this.EmitVarInt(resultData.size);
        for (const entry of resultData) {
          //console.log(entry[0]);
          const key = entry[0];
          const value = entry[1];
          this.EmitLoadVMObject(reg + 1, key);
          this.EmitLoadVMObject(reg + 2, value);
          this.Emit(Opcode.PUT, [reg + 1, reg, reg + 2]);
        }
      } else if (obj.Data instanceof VMObject) {
        const writerNew: PBinaryWriter = new PBinaryWriter();
        obj.Data.SerializeData(writerNew);
        const bytes = writerNew.toUint8Array();
        this.EmitVarInt(bytes.length);
        this.AppendBytes(Array.from(bytes));
      }
    } else {
      //console.log("reg", reg);

      const bytes = Array.from(result);
      //console.log(bytes.length);
      this.EmitVarInt(bytes.length);
      this.AppendBytes(bytes);
    }
    //this.EmitLoadBytes(reg, Array.from(result), obj.Type);
    return this;
  }

  public EmitLoadEnum(reg: number, enumVal: number): this {
    // var temp = Convert.ToUInt32(enumVal);
    // var bytes = BitConverter.GetBytes(temp);

    const bytes = [0, 0, 0, 0];

    for (let i = 0; i < bytes.length; i++) {
      const byte = enumVal & 0xff;
      bytes[i] = byte;
      enumVal = (enumVal - byte) / 256;
    }

    this.EmitLoadBytes(reg, bytes, VMType.Enum);
    return this;
  }

  public EmitLoadAddress(reg: number, obj: Address): this {
    const writer = new PBinaryWriter();
    obj.SerializeData(writer);
    const byteArray = Array.from(writer.toUint8Array());
    this.EmitLoadBytes(reg, byteArray, VMType.Bytes);
    return this;
  }

  public EmitLoadTimestamp(reg: number, obj: Date | Timestamp): this {
    if (obj instanceof Timestamp) {
      const bytes = Array.from(Serialization.Serialize(obj));
      this.EmitLoadBytes(reg, bytes, VMType.Timestamp);
    } else if (obj instanceof Date) {
      const num = (obj.getTime() / 1000) | 0;

      const a = (num & 0xff000000) >> 24;
      const b = (num & 0x00ff0000) >> 16;
      const c = (num & 0x0000ff00) >> 8;
      const d = num & 0x000000ff;

      const bytes = [d, c, b, a];
      this.EmitLoadBytes(reg, bytes, VMType.Timestamp);
    }
    return this;
  }

  public EmitLoadVarInt(reg: number, val: number): this {
    const bytes = numberToByteArray(val);

    this.Emit(Opcode.LOAD);
    this.AppendByte(reg);
    this.AppendByte(VMType.Number);

    this.AppendByte(bytes.length);
    this.EmitBytes(Array.from(bytes));
    return this;
  }

  public EmitMove(src_reg: number, dst_reg: number): this {
    this.Emit(Opcode.MOVE);
    this.AppendByte(src_reg);
    this.AppendByte(dst_reg);
    return this;
  }

  public EmitCopy(src_reg: number, dst_reg: number): this {
    this.Emit(Opcode.COPY);
    this.AppendByte(src_reg);
    this.AppendByte(dst_reg);
    return this;
  }

  public EmitLabel(label: string): this {
    this.Emit(Opcode.NOP);
    this._labelLocations[label] = this.str.length;
    return this;
  }

  public EmitJump(opcode: Opcode, label: string, reg: number = 0): this {
    switch (opcode) {
      case Opcode.JMP:
      case Opcode.JMPIF:
      case Opcode.JMPNOT:
        this.Emit(opcode);
        break;

      default:
        throw new Error('Invalid jump opcode: ' + opcode);
    }

    if (opcode != Opcode.JMP) {
      this.AppendByte(reg);
    }

    const ofs = this.str.length;
    this.AppendUshort(0);
    this._jumpLocations[ofs] = label;
    return this;
  }

  public EmitCall(label: string, regCount: byte): this {
    if (regCount < 1 || regCount > MaxRegisterCount) {
      throw new Error('Invalid number of registers');
    }

    let ofs = this.str.length; //(int)stream.Position;
    ofs += 2;
    this.Emit(Opcode.CALL);
    this.AppendByte(regCount);
    this.AppendUshort(0);

    this._jumpLocations[ofs] = label;
    return this;
  }

  public EmitConditionalJump(opcode: Opcode, src_reg: byte, label: string): this {
    if (opcode != Opcode.JMPIF && opcode != Opcode.JMPNOT) {
      throw new Error('Opcode is not a conditional jump');
    }

    let ofs = this.str.length;
    ofs += 2;

    this.Emit(opcode);
    this.AppendByte(src_reg);
    this.AppendUshort(0);
    this._jumpLocations[ofs] = label;
    return this;
  }

  public InsertMethodArgs(args: ScriptLoadValue[]) {
    const temp_reg = 0;
    for (let i = args.length - 1; i >= 0; i--) {
      const arg = args[i];
      this.EmitLoad(temp_reg, arg);
      this.EmitPush(temp_reg);
    }
  }

  public CallInterop(method: string, args: ScriptLoadValue[]): this {
    this.InsertMethodArgs(args);

    const dest_reg = 0;
    this.EmitLoad(dest_reg, method);

    this.Emit(Opcode.EXTCALL, [dest_reg]);
    return this;
  }

  public CallContract(contractName: string, method: string, args: ScriptLoadValue[]) {
    this.InsertMethodArgs(args);

    const temp_reg = 0;
    this.EmitLoad(temp_reg, method);
    this.EmitPush(temp_reg);

    const src_reg = 0;
    const dest_reg = 1;
    this.EmitLoad(src_reg, contractName);
    this.Emit(Opcode.CTX, [src_reg, dest_reg]);

    this.Emit(Opcode.SWITCH, [dest_reg]);
    return this;
  }

  //#region ScriptBuilderExtensions

  public AllowGas(
    from: string | Address,
    to: string | Address,
    gasPrice: number | bigint,
    gasLimit: number | bigint
  ): this {
    return this.CallContract(Contracts.GasContractName, 'AllowGas', [from, to, gasPrice, gasLimit]);
  }

  public SpendGas(address: string | Address): this {
    return this.CallContract(Contracts.GasContractName, 'SpendGas', [address]);
  }

  public MintTokens(
    symbol: string,
    from: string | Address,
    to: string | Address,
    amount: number | bigint
  ): this {
    return this.CallInterop('Runtime.MintTokens', [from, to, symbol, amount]);
  }

  public TransferTokens(
    symbol: string,
    from: string | Address,
    to: string | Address,
    amount: number | bigint
  ): this {
    return this.CallInterop('Runtime.TransferTokens', [from, to, symbol, amount]);
  }

  public TransferBalance(symbol: string, from: string | Address, to: string | Address): this {
    return this.CallInterop('Runtime.TransferBalance', [from, to, symbol]);
  }

  public TransferNFT(
    symbol: string,
    from: string | Address,
    to: string | Address,
    tokenId: number | bigint
  ): this {
    return this.CallInterop('Runtime.TransferToken', [from, to, symbol, tokenId]);
  }

  public CrossTransferToken(
    destinationChain: string | Address,
    symbol: string,
    from: string | Address,
    to: string | Address,
    amount: number | bigint
  ): this {
    return this.CallInterop('Runtime.SendTokens', [destinationChain, from, to, symbol, amount]);
  }

  public CrossTransferNFT(
    destinationChain: string | Address,
    symbol: string,
    from: string | Address,
    to: string | Address,
    tokenId: number | bigint
  ): this {
    return this.CallInterop('Runtime.SendToken', [destinationChain, from, to, symbol, tokenId]);
  }

  public Stake(address: string | Address, amount: number | bigint): this {
    return this.CallContract('stake', 'Stake', [address, amount]);
  }

  public Unstake(address: string | Address, amount: number | bigint): this {
    return this.CallContract('stake', 'Unstake', [address, amount]);
  }

  public CallNFT(
    symbol: string,
    seriesId: number | bigint,
    method: string,
    args: ScriptLoadValue[] = []
  ): this {
    return this.CallContract(`${symbol}#${seriesId.toString()}`, method, args);
  }

  //#endregion

  public EmitTimestamp(obj: Date): this {
    const num = (obj.getTime() / 1000) | 0;

    const a = (num & 0xff000000) >> 24;
    const b = (num & 0x00ff0000) >> 16;
    const c = (num & 0x0000ff00) >> 8;
    const d = num & 0x000000ff;

    const bytes = [d, c, b, a];
    this.AppendBytes(bytes);
    return this;
  }

  public EmitByteArray(bytes: number[]) {
    this.EmitVarInt(bytes.length);
    this.EmitBytes(bytes);
    return this;
  }

  public EmitVarString(text: string): this {
    const bytes = this.RawString(text);
    this.EmitVarInt(bytes.length);
    this.EmitBytes(bytes);
    return this;
  }

  public EmitVarInt(value: number): this {
    if (value < 0) throw 'negative value invalid';

    if (value < 0xfd) {
      this.AppendByte(value);
    } else if (value <= 0xffff) {
      const B = (value & 0x0000ff00) >> 8;
      const A = value & 0x000000ff;

      // VM variable integers append the least significant byte first.
      this.AppendByte(0xfd);
      this.AppendByte(A);
      this.AppendByte(B);
    } else if (value <= 0xffffffff) {
      const C = (value & 0x00ff0000) >> 16;
      const B = (value & 0x0000ff00) >> 8;
      const A = value & 0x000000ff;

      // VM variable integers append the least significant byte first.
      this.AppendByte(0xfe);
      this.AppendByte(A);
      this.AppendByte(B);
      this.AppendByte(C);
    } else {
      const D = (value & 0xff000000) >> 24;
      const C = (value & 0x00ff0000) >> 16;
      const B = (value & 0x0000ff00) >> 8;
      const A = value & 0x000000ff;

      // VM variable integers append the least significant byte first.
      this.AppendByte(0xff);
      this.AppendByte(A);
      this.AppendByte(B);
      this.AppendByte(C);
      this.AppendByte(D);
    }
    return this;
  }

  public EmitUInt32(value: number): this {
    if (value < 0) throw 'negative value invalid';

    const D = (value & 0xff000000) >> 24;
    const C = (value & 0x00ff0000) >> 16;
    const B = (value & 0x0000ff00) >> 8;
    const A = value & 0x000000ff;

    // VM integers append the least significant byte first.
    this.AppendByte(0xff);
    this.AppendByte(A);
    this.AppendByte(B);
    this.AppendByte(C);
    this.AppendByte(D);

    return this;
  }

  EmitBytes(bytes: byte[]): this {
    for (let i = 0; i < bytes.length; i++) this.AppendByte(bytes[i]);

    // writer.Write(bytes);
    return this;
  }

  //Custom Modified
  ByteToHex(byte: number) {
    const result = ('0' + (byte & 0xff).toString(16)).slice(-2);
    return result;
  }

  AppendByte(byte: number) {
    this.str += this.ByteToHex(byte);
    this.writer.writeByte(byte);
  }

  //Custom Modified
  AppendBytes(bytes: byte[]) {
    for (let i = 0; i < bytes.length; i++) {
      this.AppendByte(bytes[i]);
    }
  }

  AppendUshort(ushort: number) {
    this.str += this.ByteToHex(ushort & 0xff) + this.ByteToHex((ushort >> 8) & 0xff);
    this.writer.writeUnsignedShort(ushort);
  }

  AppendHexEncoded(bytes: string): this {
    this.str += bytes;
    this.writer.writeBytes(Array.from(stringToUint8Array(bytes)));
    return this;
  }
}

import base58 from 'bs58';
import {
  isSerializableLike,
  serializeSerializable,
  type ISerializable,
  type SerializableLike,
} from '../interfaces/index.js';
import { bigIntToTwosComplementLE } from '../types/carbon-serialization.js';
import { Address, PBinaryWriter, Serialization, Timestamp } from '../types/index.js';
import { numberToByteArray, stringToUint8Array, bytesToHex } from '../utils/index.js';
import { Opcode } from './opcode.js';
import { VMObject } from './vm-object.js';
import { VMType } from './vm-type.js';
import { Contracts } from './contracts.js';

type byte = number;

const MaxRegisterCount = 32;

type ScriptLoadValue = unknown;

export class ScriptBuilder {
  _labelLocations: { [id: string]: number } = {};
  _jumpLocations: { [id: number]: string } = {};

  public str: string;

  public writer: PBinaryWriter;

  public NullAddress = 'S1111111111111111111111111111111111';

  public static create(): ScriptBuilder {
    return new ScriptBuilder();
  }

  /** @deprecated Use `ScriptBuilder.create()` instead. This alias will be removed in v1.0. */
  public static ScriptBuilder(): ScriptBuilder {
    return ScriptBuilder.create();
  }

  public constructor() {
    this.str = '';
    this.writer = new PBinaryWriter();
  }

  public beginScript() {
    this.str = '';
    this.writer = new PBinaryWriter();
    return this;
  }

  public getScript(): string {
    return bytesToHex(this.writer.toUint8Array());
  }

  public endScript(): string {
    this.emit(Opcode.RET);
    return bytesToHex(this.writer.toUint8Array()).toUpperCase();
  }

  public emit(opcode: Opcode, bytes?: number[]): this {
    this.appendByte(opcode);
    if (bytes) {
      this.emitBytes(bytes);
    }
    return this;
  }

  public emitThrow(reg: byte): this {
    this.emit(Opcode.THROW);
    this.appendByte(reg);
    return this;
  }

  public emitPush(reg: byte): this {
    this.emit(Opcode.PUSH);
    this.appendByte(reg);
    return this;
  }

  public emitPop(reg: byte): this {
    this.emit(Opcode.POP);
    this.appendByte(reg);
    return this;
  }

  public emitExtCall(method: string, reg: byte = 0): this {
    this.emitLoad(reg, method);
    this.emit(Opcode.EXTCALL);
    this.appendByte(reg);
    return this;
  }

  public emitBigInteger(value: string) {
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
    return this.emitByteArray(bytes);
  }

  public emitAddress(textAddress: string) {
    const bytes = [...base58.decode(textAddress.substring(1))];
    return this.emitByteArray(bytes);
  }

  rawString(value: string) {
    //let bytes = stringToUint8Array(value);
    //console.log(Array.from(bytes))
    //return Array.from(bytes);
    const data = [];
    for (let i = 0; i < value.length; i++) {
      data.push(value.charCodeAt(i));
    }
    return data;
  }

  private emitLoadBigInt(reg: number, value: bigint): this {
    const bytes = Array.from(bigIntToTwosComplementLE(value));
    this.emitLoadBytes(reg, bytes, VMType.Number);
    return this;
  }

  public emitLoad(reg: number, obj: ScriptLoadValue): this {
    switch (typeof obj) {
      case 'string': {
        const bytes = this.rawString(obj);
        this.emitLoadBytes(reg, bytes, VMType.String);
        break;
      }

      case 'boolean': {
        const bytes = [(obj as boolean) ? 1 : 0];
        this.emitLoadBytes(reg, bytes, VMType.Bool);
        break;
      }

      case 'bigint': {
        this.emitLoadBigInt(reg, obj as bigint);
        break;
      }

      case 'number': {
        // obj is BigInteger
        // var bytes = val.ToSignedByteArray();
        // this.emitLoadBytes(reg, bytes, VMType.Number);
        //let bytes = this.rawString(BigInt(obj).toString());
        // this.emitLoadVarInt(reg, obj);
        const bytes = this.rawString(obj.toString());
        this.emitLoadBytes(reg, bytes, VMType.String);
        break;
      }

      case 'object':
        if (obj === null) {
          throw Error('Load type object not supported');
        }
        if (obj instanceof Uint8Array) {
          this.emitLoadBytes(reg, Array.from(obj));
        } else if (obj instanceof VMObject) {
          this.emitLoadVmObject(reg, obj);
        } else if (Array.isArray(obj)) {
          this.emitLoadArray(reg, obj);
        } else if (obj instanceof Date || obj instanceof Timestamp) {
          this.emitLoadTimestamp(reg, obj);
        } else if (obj instanceof Address) {
          this.emitLoadAddress(reg, obj);
        } else if (isSerializableLike(obj)) {
          this.emitLoadSerializable(reg, obj);
        } else {
          if (Array.isArray(obj)) {
            this.emitLoadArray(reg, obj);
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

  public emitLoadBytes(reg: number, bytes: byte[], type: VMType = VMType.Bytes): this {
    if (bytes.length > 0xffff) throw new Error('tried to load too much data');
    this.emit(Opcode.LOAD);
    this.appendByte(reg);
    this.appendByte(type);

    this.emitVarInt(bytes.length);
    this.emitBytes(bytes);
    return this;
  }

  public emitLoadArray(reg: number, obj: unknown[]): this {
    this.emit(Opcode.CAST, [reg, reg, VMType.None]);

    for (let i = 0; i < obj.length; i++) {
      const element = obj[i];
      const temp_regVal = reg + 1;
      const temp_regKey = reg + 2;

      this.emitLoad(temp_regVal, element);
      this.emitLoad(temp_regKey, BigInt(i));
      this.emit(Opcode.PUT, [temp_regVal, reg, temp_regKey]);
      //this.emitLoad(reg, element);
      //this.emitPush(reg);
      //reg++;
    }

    return this;
  }

  public emitLoadSerializable(reg: number, obj: SerializableLike): this {
    const writer: PBinaryWriter = new PBinaryWriter();
    serializeSerializable(obj, writer);
    this.emitLoadBytes(reg, writer.toArray(), VMType.Bytes);
    return this;
  }

  public emitLoadVmObject(reg: number, obj: VMObject): this {
    const writer: PBinaryWriter = new PBinaryWriter();
    const result = obj.serializeObjectCall(writer);

    this.emit(Opcode.LOAD);
    this.appendByte(reg);
    this.appendByte(obj.type);

    if (result == undefined) {
      //console.log("enter");
      if (obj.data instanceof Map || (obj.data instanceof Map && obj.data instanceof VMObject)) {
        const resultData = obj.data as Map<VMObject, VMObject>;
        this.emitVarInt(resultData.size);
        for (const entry of resultData) {
          //console.log(entry[0]);
          const key = entry[0];
          const value = entry[1];
          this.emitLoadVmObject(reg + 1, key);
          this.emitLoadVmObject(reg + 2, value);
          this.emit(Opcode.PUT, [reg + 1, reg, reg + 2]);
        }
      } else if (obj.data instanceof VMObject) {
        const writerNew: PBinaryWriter = new PBinaryWriter();
        serializeSerializable(obj.data, writerNew);
        const bytes = writerNew.toUint8Array();
        this.emitVarInt(bytes.length);
        this.appendBytes(Array.from(bytes));
      }
    } else {
      //console.log("reg", reg);

      const bytes = Array.from(result);
      //console.log(bytes.length);
      this.emitVarInt(bytes.length);
      this.appendBytes(bytes);
    }
    //this.emitLoadBytes(reg, Array.from(result), obj.Type);
    return this;
  }

  public emitLoadEnum(reg: number, enumVal: number): this {
    // var temp = Convert.ToUInt32(enumVal);
    // var bytes = BitConverter.GetBytes(temp);

    const bytes = [0, 0, 0, 0];

    for (let i = 0; i < bytes.length; i++) {
      const byte = enumVal & 0xff;
      bytes[i] = byte;
      enumVal = (enumVal - byte) / 256;
    }

    this.emitLoadBytes(reg, bytes, VMType.Enum);
    return this;
  }

  public emitLoadAddress(reg: number, obj: Address): this {
    const writer = new PBinaryWriter();
    obj.serializeData(writer);
    const byteArray = Array.from(writer.toUint8Array());
    this.emitLoadBytes(reg, byteArray, VMType.Bytes);
    return this;
  }

  public emitLoadTimestamp(reg: number, obj: Date | Timestamp): this {
    if (obj instanceof Timestamp) {
      const bytes = Array.from(Serialization.serialize(obj));
      this.emitLoadBytes(reg, bytes, VMType.Timestamp);
    } else if (obj instanceof Date) {
      const num = (obj.getTime() / 1000) | 0;

      const a = (num & 0xff000000) >> 24;
      const b = (num & 0x00ff0000) >> 16;
      const c = (num & 0x0000ff00) >> 8;
      const d = num & 0x000000ff;

      const bytes = [d, c, b, a];
      this.emitLoadBytes(reg, bytes, VMType.Timestamp);
    }
    return this;
  }

  public emitLoadVarInt(reg: number, val: number): this {
    const bytes = numberToByteArray(val);

    this.emit(Opcode.LOAD);
    this.appendByte(reg);
    this.appendByte(VMType.Number);

    this.appendByte(bytes.length);
    this.emitBytes(Array.from(bytes));
    return this;
  }

  public emitMove(src_reg: number, dst_reg: number): this {
    this.emit(Opcode.MOVE);
    this.appendByte(src_reg);
    this.appendByte(dst_reg);
    return this;
  }

  public emitCopy(src_reg: number, dst_reg: number): this {
    this.emit(Opcode.COPY);
    this.appendByte(src_reg);
    this.appendByte(dst_reg);
    return this;
  }

  public emitLabel(label: string): this {
    this.emit(Opcode.NOP);
    this._labelLocations[label] = this.str.length;
    return this;
  }

  public emitJump(opcode: Opcode, label: string, reg: number = 0): this {
    switch (opcode) {
      case Opcode.JMP:
      case Opcode.JMPIF:
      case Opcode.JMPNOT:
        this.emit(opcode);
        break;

      default:
        throw new Error('Invalid jump opcode: ' + opcode);
    }

    if (opcode != Opcode.JMP) {
      this.appendByte(reg);
    }

    const ofs = this.str.length;
    this.appendUShort(0);
    this._jumpLocations[ofs] = label;
    return this;
  }

  public emitCall(label: string, regCount: byte): this {
    if (regCount < 1 || regCount > MaxRegisterCount) {
      throw new Error('Invalid number of registers');
    }

    let ofs = this.str.length; //(int)stream.Position;
    ofs += 2;
    this.emit(Opcode.CALL);
    this.appendByte(regCount);
    this.appendUShort(0);

    this._jumpLocations[ofs] = label;
    return this;
  }

  public emitConditionalJump(opcode: Opcode, src_reg: byte, label: string): this {
    if (opcode != Opcode.JMPIF && opcode != Opcode.JMPNOT) {
      throw new Error('Opcode is not a conditional jump');
    }

    let ofs = this.str.length;
    ofs += 2;

    this.emit(opcode);
    this.appendByte(src_reg);
    this.appendUShort(0);
    this._jumpLocations[ofs] = label;
    return this;
  }

  public insertMethodArgs(args: ScriptLoadValue[]) {
    const temp_reg = 0;
    for (let i = args.length - 1; i >= 0; i--) {
      const arg = args[i];
      this.emitLoad(temp_reg, arg);
      this.emitPush(temp_reg);
    }
  }

  public callInterop(method: string, args: ScriptLoadValue[]): this {
    this.insertMethodArgs(args);

    const dest_reg = 0;
    this.emitLoad(dest_reg, method);

    this.emit(Opcode.EXTCALL, [dest_reg]);
    return this;
  }

  public callContract(contractName: string, method: string, args: ScriptLoadValue[]) {
    this.insertMethodArgs(args);

    const temp_reg = 0;
    this.emitLoad(temp_reg, method);
    this.emitPush(temp_reg);

    const src_reg = 0;
    const dest_reg = 1;
    this.emitLoad(src_reg, contractName);
    this.emit(Opcode.CTX, [src_reg, dest_reg]);

    this.emit(Opcode.SWITCH, [dest_reg]);
    return this;
  }

  //#region ScriptBuilderExtensions

  public allowGas(
    from: string | Address,
    to: string | Address,
    gasPrice: number | bigint,
    gasLimit: number | bigint
  ): this {
    return this.callContract(Contracts.GasContractName, 'AllowGas', [from, to, gasPrice, gasLimit]);
  }

  public spendGas(address: string | Address): this {
    return this.callContract(Contracts.GasContractName, 'SpendGas', [address]);
  }

  public mintTokens(
    symbol: string,
    from: string | Address,
    to: string | Address,
    amount: number | bigint
  ): this {
    return this.callInterop('Runtime.MintTokens', [from, to, symbol, amount]);
  }

  public transferTokens(
    symbol: string,
    from: string | Address,
    to: string | Address,
    amount: number | bigint
  ): this {
    return this.callInterop('Runtime.TransferTokens', [from, to, symbol, amount]);
  }

  public transferBalance(symbol: string, from: string | Address, to: string | Address): this {
    return this.callInterop('Runtime.TransferBalance', [from, to, symbol]);
  }

  public transferNft(
    symbol: string,
    from: string | Address,
    to: string | Address,
    tokenId: number | bigint
  ): this {
    return this.callInterop('Runtime.TransferToken', [from, to, symbol, tokenId]);
  }

  public crossTransferToken(
    destinationChain: string | Address,
    symbol: string,
    from: string | Address,
    to: string | Address,
    amount: number | bigint
  ): this {
    return this.callInterop('Runtime.SendTokens', [destinationChain, from, to, symbol, amount]);
  }

  public crossTransferNft(
    destinationChain: string | Address,
    symbol: string,
    from: string | Address,
    to: string | Address,
    tokenId: number | bigint
  ): this {
    return this.callInterop('Runtime.SendToken', [destinationChain, from, to, symbol, tokenId]);
  }

  public stake(address: string | Address, amount: number | bigint): this {
    return this.callContract('stake', 'Stake', [address, amount]);
  }

  public unstake(address: string | Address, amount: number | bigint): this {
    return this.callContract('stake', 'Unstake', [address, amount]);
  }

  public callNft(
    symbol: string,
    seriesId: number | bigint,
    method: string,
    args: ScriptLoadValue[] = []
  ): this {
    return this.callContract(`${symbol}#${seriesId.toString()}`, method, args);
  }

  //#endregion

  public emitTimestamp(obj: Date): this {
    const num = (obj.getTime() / 1000) | 0;

    const a = (num & 0xff000000) >> 24;
    const b = (num & 0x00ff0000) >> 16;
    const c = (num & 0x0000ff00) >> 8;
    const d = num & 0x000000ff;

    const bytes = [d, c, b, a];
    this.appendBytes(bytes);
    return this;
  }

  public emitByteArray(bytes: number[]) {
    this.emitVarInt(bytes.length);
    this.emitBytes(bytes);
    return this;
  }

  public emitVarString(text: string): this {
    const bytes = this.rawString(text);
    this.emitVarInt(bytes.length);
    this.emitBytes(bytes);
    return this;
  }

  public emitVarInt(value: number): this {
    if (value < 0) throw 'negative value invalid';

    if (value < 0xfd) {
      this.appendByte(value);
    } else if (value <= 0xffff) {
      const B = (value & 0x0000ff00) >> 8;
      const A = value & 0x000000ff;

      // VM variable integers append the least significant byte first.
      this.appendByte(0xfd);
      this.appendByte(A);
      this.appendByte(B);
    } else if (value <= 0xffffffff) {
      const C = (value & 0x00ff0000) >> 16;
      const B = (value & 0x0000ff00) >> 8;
      const A = value & 0x000000ff;

      // VM variable integers append the least significant byte first.
      this.appendByte(0xfe);
      this.appendByte(A);
      this.appendByte(B);
      this.appendByte(C);
    } else {
      const D = (value & 0xff000000) >> 24;
      const C = (value & 0x00ff0000) >> 16;
      const B = (value & 0x0000ff00) >> 8;
      const A = value & 0x000000ff;

      // VM variable integers append the least significant byte first.
      this.appendByte(0xff);
      this.appendByte(A);
      this.appendByte(B);
      this.appendByte(C);
      this.appendByte(D);
    }
    return this;
  }

  public emitUInt32(value: number): this {
    if (value < 0) throw 'negative value invalid';

    const D = (value & 0xff000000) >> 24;
    const C = (value & 0x00ff0000) >> 16;
    const B = (value & 0x0000ff00) >> 8;
    const A = value & 0x000000ff;

    // VM integers append the least significant byte first.
    this.appendByte(0xff);
    this.appendByte(A);
    this.appendByte(B);
    this.appendByte(C);
    this.appendByte(D);

    return this;
  }

  emitBytes(bytes: byte[]): this {
    for (let i = 0; i < bytes.length; i++) this.appendByte(bytes[i]);

    // writer.Write(bytes);
    return this;
  }

  //Custom Modified
  byteToHex(byte: number) {
    const result = ('0' + (byte & 0xff).toString(16)).slice(-2);
    return result;
  }

  appendByte(byte: number) {
    this.str += this.byteToHex(byte);
    this.writer.writeByte(byte);
  }

  //Custom Modified
  appendBytes(bytes: byte[]) {
    for (let i = 0; i < bytes.length; i++) {
      this.appendByte(bytes[i]);
    }
  }

  appendUShort(ushort: number) {
    this.str += this.byteToHex(ushort & 0xff) + this.byteToHex((ushort >> 8) & 0xff);
    this.writer.writeUnsignedShort(ushort);
  }

  appendHexEncoded(bytes: string): this {
    this.str += bytes;
    this.writer.writeBytes(Array.from(stringToUint8Array(bytes)));
    return this;
  }

  /** @deprecated Use `beginScript` instead. This alias will be removed in v1.0. */
  public BeginScript(): this {
    return this.beginScript();
  }

  /** @deprecated Use `getScript` instead. This alias will be removed in v1.0. */
  public GetScript(): string {
    return this.getScript();
  }

  /** @deprecated Use `endScript` instead. This alias will be removed in v1.0. */
  public EndScript(): string {
    return this.endScript();
  }

  /** @deprecated Use `emit` instead. This alias will be removed in v1.0. */
  public Emit(opcode: Opcode, bytes?: number[]): this {
    return this.emit(opcode, bytes);
  }

  /** @deprecated Use `emitThrow` instead. This typoed alias will be removed in v1.0. */
  public EmitThorw(reg: byte): this {
    return this.emitThrow(reg);
  }

  /** @deprecated Use `emitPush` instead. This alias will be removed in v1.0. */
  public EmitPush(reg: byte): this {
    return this.emitPush(reg);
  }

  /** @deprecated Use `emitPop` instead. This alias will be removed in v1.0. */
  public EmitPop(reg: byte): this {
    return this.emitPop(reg);
  }

  /** @deprecated Use `emitExtCall` instead. This alias will be removed in v1.0. */
  public EmitExtCall(method: string, reg: byte = 0): this {
    return this.emitExtCall(method, reg);
  }

  /** @deprecated Use `emitBigInteger` instead. This alias will be removed in v1.0. */
  public EmitBigInteger(value: string) {
    return this.emitBigInteger(value);
  }

  /** @deprecated Use `emitAddress` instead. This alias will be removed in v1.0. */
  public EmitAddress(textAddress: string) {
    return this.emitAddress(textAddress);
  }

  /** @deprecated Use `rawString` instead. This alias will be removed in v1.0. */
  public RawString(value: string) {
    return this.rawString(value);
  }

  /** @deprecated Use `emitLoad` instead. This alias will be removed in v1.0. */
  public EmitLoad(reg: number, obj: ScriptLoadValue): this {
    return this.emitLoad(reg, obj);
  }

  /** @deprecated Use `emitLoadBytes` instead. This alias will be removed in v1.0. */
  public EmitLoadBytes(reg: number, bytes: byte[], type: VMType = VMType.Bytes): this {
    return this.emitLoadBytes(reg, bytes, type);
  }

  /** @deprecated Use `emitLoadArray` instead. This alias will be removed in v1.0. */
  public EmitLoadArray(reg: number, obj: unknown[]): this {
    return this.emitLoadArray(reg, obj);
  }

  /** @deprecated Use `emitLoadSerializable` instead. This alias will be removed in v1.0. */
  public EmitLoadISerializable(reg: number, obj: ISerializable): this {
    return this.emitLoadSerializable(reg, obj);
  }

  /** @deprecated Use `emitLoadVmObject` instead. This alias will be removed in v1.0. */
  public EmitLoadVMObject(reg: number, obj: VMObject): this {
    return this.emitLoadVmObject(reg, obj);
  }

  /** @deprecated Use `emitLoadEnum` instead. This alias will be removed in v1.0. */
  public EmitLoadEnum(reg: number, enumVal: number): this {
    return this.emitLoadEnum(reg, enumVal);
  }

  /** @deprecated Use `emitLoadAddress` instead. This alias will be removed in v1.0. */
  public EmitLoadAddress(reg: number, obj: Address): this {
    return this.emitLoadAddress(reg, obj);
  }

  /** @deprecated Use `emitLoadTimestamp` instead. This alias will be removed in v1.0. */
  public EmitLoadTimestamp(reg: number, obj: Date | Timestamp): this {
    return this.emitLoadTimestamp(reg, obj);
  }

  /** @deprecated Use `emitLoadVarInt` instead. This alias will be removed in v1.0. */
  public EmitLoadVarInt(reg: number, val: number): this {
    return this.emitLoadVarInt(reg, val);
  }

  /** @deprecated Use `emitMove` instead. This alias will be removed in v1.0. */
  public EmitMove(src_reg: number, dst_reg: number): this {
    return this.emitMove(src_reg, dst_reg);
  }

  /** @deprecated Use `emitCopy` instead. This alias will be removed in v1.0. */
  public EmitCopy(src_reg: number, dst_reg: number): this {
    return this.emitCopy(src_reg, dst_reg);
  }

  /** @deprecated Use `emitLabel` instead. This alias will be removed in v1.0. */
  public EmitLabel(label: string): this {
    return this.emitLabel(label);
  }

  /** @deprecated Use `emitJump` instead. This alias will be removed in v1.0. */
  public EmitJump(opcode: Opcode, label: string, reg: number = 0): this {
    return this.emitJump(opcode, label, reg);
  }

  /** @deprecated Use `emitCall` instead. This alias will be removed in v1.0. */
  public EmitCall(label: string, regCount: byte): this {
    return this.emitCall(label, regCount);
  }

  /** @deprecated Use `emitConditionalJump` instead. This alias will be removed in v1.0. */
  public EmitConditionalJump(opcode: Opcode, src_reg: byte, label: string): this {
    return this.emitConditionalJump(opcode, src_reg, label);
  }

  /** @deprecated Use `insertMethodArgs` instead. This alias will be removed in v1.0. */
  public InsertMethodArgs(args: ScriptLoadValue[]) {
    return this.insertMethodArgs(args);
  }

  /** @deprecated Use `callInterop` instead. This alias will be removed in v1.0. */
  public CallInterop(method: string, args: ScriptLoadValue[]): this {
    return this.callInterop(method, args);
  }

  /** @deprecated Use `callContract` instead. This alias will be removed in v1.0. */
  public CallContract(contractName: string, method: string, args: ScriptLoadValue[]) {
    return this.callContract(contractName, method, args);
  }

  /** @deprecated Use `allowGas` instead. This alias will be removed in v1.0. */
  public AllowGas(
    from: string | Address,
    to: string | Address,
    gasPrice: number | bigint,
    gasLimit: number | bigint
  ): this {
    return this.allowGas(from, to, gasPrice, gasLimit);
  }

  /** @deprecated Use `spendGas` instead. This alias will be removed in v1.0. */
  public SpendGas(address: string | Address): this {
    return this.spendGas(address);
  }

  /** @deprecated Use `mintTokens` instead. This alias will be removed in v1.0. */
  public MintTokens(
    symbol: string,
    from: string | Address,
    to: string | Address,
    amount: number | bigint
  ): this {
    return this.mintTokens(symbol, from, to, amount);
  }

  /** @deprecated Use `transferTokens` instead. This alias will be removed in v1.0. */
  public TransferTokens(
    symbol: string,
    from: string | Address,
    to: string | Address,
    amount: number | bigint
  ): this {
    return this.transferTokens(symbol, from, to, amount);
  }

  /** @deprecated Use `transferBalance` instead. This alias will be removed in v1.0. */
  public TransferBalance(symbol: string, from: string | Address, to: string | Address): this {
    return this.transferBalance(symbol, from, to);
  }

  /** @deprecated Use `transferNft` instead. This alias will be removed in v1.0. */
  public TransferNFT(
    symbol: string,
    from: string | Address,
    to: string | Address,
    tokenId: number | bigint
  ): this {
    return this.transferNft(symbol, from, to, tokenId);
  }

  /** @deprecated Use `crossTransferToken` instead. This alias will be removed in v1.0. */
  public CrossTransferToken(
    destinationChain: string | Address,
    symbol: string,
    from: string | Address,
    to: string | Address,
    amount: number | bigint
  ): this {
    return this.crossTransferToken(destinationChain, symbol, from, to, amount);
  }

  /** @deprecated Use `crossTransferNft` instead. This alias will be removed in v1.0. */
  public CrossTransferNFT(
    destinationChain: string | Address,
    symbol: string,
    from: string | Address,
    to: string | Address,
    tokenId: number | bigint
  ): this {
    return this.crossTransferNft(destinationChain, symbol, from, to, tokenId);
  }

  /** @deprecated Use `stake` instead. This alias will be removed in v1.0. */
  public Stake(address: string | Address, amount: number | bigint): this {
    return this.stake(address, amount);
  }

  /** @deprecated Use `unstake` instead. This alias will be removed in v1.0. */
  public Unstake(address: string | Address, amount: number | bigint): this {
    return this.unstake(address, amount);
  }

  /** @deprecated Use `callNft` instead. This alias will be removed in v1.0. */
  public CallNFT(
    symbol: string,
    seriesId: number | bigint,
    method: string,
    args: ScriptLoadValue[] = []
  ): this {
    return this.callNft(symbol, seriesId, method, args);
  }

  /** @deprecated Use `emitTimestamp` instead. This alias will be removed in v1.0. */
  public EmitTimestamp(obj: Date): this {
    return this.emitTimestamp(obj);
  }

  /** @deprecated Use `emitByteArray` instead. This alias will be removed in v1.0. */
  public EmitByteArray(bytes: number[]) {
    return this.emitByteArray(bytes);
  }

  /** @deprecated Use `emitVarString` instead. This alias will be removed in v1.0. */
  public EmitVarString(text: string): this {
    return this.emitVarString(text);
  }

  /** @deprecated Use `emitVarInt` instead. This alias will be removed in v1.0. */
  public EmitVarInt(value: number): this {
    return this.emitVarInt(value);
  }

  /** @deprecated Use `emitUInt32` instead. This alias will be removed in v1.0. */
  public EmitUInt32(value: number): this {
    return this.emitUInt32(value);
  }

  /** @deprecated Use `emitBytes` instead. This alias will be removed in v1.0. */
  public EmitBytes(bytes: byte[]): this {
    return this.emitBytes(bytes);
  }

  /** @deprecated Use `byteToHex` instead. This alias will be removed in v1.0. */
  public ByteToHex(byte: number) {
    return this.byteToHex(byte);
  }

  /** @deprecated Use `appendByte` instead. This alias will be removed in v1.0. */
  public AppendByte(byte: number) {
    return this.appendByte(byte);
  }

  /** @deprecated Use `appendBytes` instead. This alias will be removed in v1.0. */
  public AppendBytes(bytes: byte[]) {
    return this.appendBytes(bytes);
  }

  /** @deprecated Use `appendUShort` instead. This alias will be removed in v1.0. */
  public AppendUshort(ushort: number) {
    return this.appendUShort(ushort);
  }

  /** @deprecated Use `appendHexEncoded` instead. This alias will be removed in v1.0. */
  public AppendHexEncoded(bytes: string): this {
    return this.appendHexEncoded(bytes);
  }
}

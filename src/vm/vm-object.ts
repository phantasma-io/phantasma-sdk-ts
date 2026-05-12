import { VMType } from './vm-type.js';
import { Timestamp } from '../types/timestamp.js';
import {
  Address,
  Base16,
  Describer,
  PBinaryReader,
  PBinaryWriter,
  Serialization,
} from '../types/index.js';
import { ISerializable, isSerializableLike, serializeSerializable } from '../interfaces/index.js';
import { uint8ArrayToStringDefault } from '../utils/index.js';
import { twosComplementLEToBigInt } from '../types/carbon-serialization.js';
import { bigIntToTwosComplementLE_phantasma } from '../types/phantasma-big-int-serialization.js';

type VMObjectConstructor<T = Record<string, unknown>> = {
  new (): T;
  name?: string;
} & Record<string, unknown>;

function objectLength(value: unknown): number {
  if (
    value !== null &&
    typeof value === 'object' &&
    'length' in value &&
    typeof (value as { length: unknown }).length === 'number'
  ) {
    return (value as { length: number }).length;
  }
  return 0;
}

export class VMObject implements ISerializable {
  public Type: VMType;
  public Data: unknown;
  public get isEmpty(): boolean {
    return this.Data == null || this.Data == undefined;
  }
  private _localSize = 0;
  private static readonly TimeFormat: string = 'MM/dd/yyyy HH:mm:ss';

  public getChildren(): Map<VMObject, VMObject> | null {
    return this.Type == VMType.Struct ? (this.Data as Map<VMObject, VMObject>) : null;
  }

  public get size(): number {
    let total = 0;

    if (this.Type == VMType.Object) {
      const children = this.getChildren();
      const values = children?.values;
      for (const entry in values) {
        total += entry.length;
      }
    } else {
      total = this._localSize;
    }

    return total;
  }

  constructor() {
    this.Type = VMType.None;
    this.Data = null;
  }

  private static bytesFromAny(value: unknown): Uint8Array {
    if (value instanceof Uint8Array) {
      return value;
    }
    if (Array.isArray(value)) {
      return Uint8Array.from(value);
    }
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
      return new Uint8Array(value);
    }
    if (typeof value === 'string') {
      return Base16.decodeUint8Array(value);
    }
    throw new Error(`Cannot convert ${typeof value} to bytes`);
  }

  private static bigIntFromAny(value: unknown): bigint {
    if (typeof value === 'bigint') {
      return value;
    }
    if (typeof value === 'number') {
      return BigInt(value);
    }
    if (typeof value === 'string' || value instanceof String) {
      return BigInt(value.toString());
    }
    if (value && typeof (value as { toString?: unknown }).toString === 'function') {
      return BigInt((value as { toString(): string }).toString());
    }
    throw new Error(`Cannot convert ${typeof value} to BigInteger`);
  }

  private static serializeToBytes(value: VMObject): Uint8Array {
    const writer = new PBinaryWriter();
    value.SerializeData(writer);
    return writer.toUint8Array();
  }

  private static base64Encode(bytes: Uint8Array): string {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes).toString('base64');
    }
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }

  private getArrayValue(index: number): VMObject | null {
    const children = this.getChildren();
    if (!children) {
      return null;
    }
    for (const [key, value] of children) {
      if (key.Type === VMType.Number && key.asNumber() === BigInt(index)) {
        return value;
      }
    }
    return null;
  }

  public asTimestamp(): Timestamp {
    if (this.Type != VMType.Timestamp) {
      throw new Error(`Invalid cast: expected timestamp, got ${this.Type}`);
    }

    return this.Data as Timestamp;
  }

  public asByteArray(): Uint8Array {
    switch (this.Type) {
      case VMType.Bytes:
        return VMObject.bytesFromAny(this.Data);
      case VMType.Bool:
        return new Uint8Array([(this.Data as unknown as boolean) ? 1 : 0]);
      case VMType.String:
        return new TextEncoder().encode(this.asString() as string);
      case VMType.Number:
        return bigIntToTwosComplementLE_phantasma(this.asNumber());
      case VMType.Enum:
        const num = Number(this.asNumber());
        const bytes = new Uint8Array(4);
        new DataView(bytes.buffer).setUint32(0, num, true);
        return bytes;
      case VMType.Timestamp:
        const time = this.asTimestamp();
        const timestampBytes = new Uint8Array(4);
        new DataView(timestampBytes.buffer).setUint32(0, time.value, true);
        return timestampBytes;
      case VMType.Struct:
        return VMObject.serializeToBytes(this);
      case VMType.Object:
        if (this.Data instanceof Address) {
          return this.Data.toByteArray();
        }
        return VMObject.bytesFromAny(this.Data);
      default:
        throw new Error(`Invalid cast: expected bytes, got ${this.Type}`);
    }
  }

  public asString(): string {
    switch (this.Type) {
      case VMType.String:
        return this.Data?.toString() as string;
      case VMType.Number:
        return this.asNumber().toString();
      case VMType.Bytes:
        return uint8ArrayToStringDefault(this.Data as Uint8Array);
      case VMType.Enum:
        return (this.Data as unknown as number).toString();
      case VMType.Object:
        if (this.Data instanceof Address) {
          return this.Data.text;
        }
        /*if (this.Data instanceof Hash) {
              return this.Data.toString();
          }*/
        return 'Interop:' + this.Data?.constructor.name;
      case VMType.Struct:
        const arrayType = this.getArrayType();
        if (arrayType === VMType.Number) {
          // Gen2 VM strings can be represented as structs keyed by numeric
          // indexes. Preserve that observable conversion before falling back
          // to serialized bytes for non-array structs.
          const children = this.getChildren();
          let sb = '';

          for (let i = 0; i < children!.size; i++) {
            const val = this.getArrayValue(i);
            if (!val) {
              throw new Error(`Invalid cast: expected string, got ${this.Type}`);
            }

            const ch = String.fromCharCode(Number(val.asNumber()));
            sb += ch;
          }

          return sb;
        }
        return VMObject.base64Encode(VMObject.serializeToBytes(this));
      case VMType.Bool:
        return this.Data ? 'true' : 'false';
      case VMType.Timestamp:
        return (this.Data as Timestamp).value.toString();
      default:
        throw new Error(`Invalid cast: expected string, got ${this.Type}`);
    }
  }

  public asNumber(): bigint {
    switch (this.Type) {
      case VMType.None:
        return 0n;

      case VMType.String: {
        const value = this.Data?.toString() ?? '';
        if (!/^[+-]?\d+$/.test(value)) {
          throw new Error(`Cannot convert String '${this.Data}' to BigInteger.`);
        }
        return BigInt(value);
      }

      case VMType.Bytes: {
        // VM numeric byte casts use the same signed little-endian BigInteger
        // bytes emitted by the Gen2 C# VM, including empty and negative forms.
        return twosComplementLEToBigInt(VMObject.bytesFromAny(this.Data));
      }

      case VMType.Enum: {
        return BigInt(Number(this.Data));
      }

      case VMType.Bool: {
        const val = this.Data as unknown as boolean;
        return val ? 1n : 0n;
      }

      case VMType.Number:
        return VMObject.bigIntFromAny(this.Data);

      case VMType.Timestamp:
        return BigInt((this.Data as Timestamp).value);

      case VMType.Object: {
        if (this.Data instanceof Timestamp) {
          return BigInt(this.Data.value);
        }
        if (this.Data instanceof Address) {
          throw new Error(`Invalid cast: expected number, got ${this.Type}`);
        }
        const bytes = VMObject.bytesFromAny(this.Data);
        if (bytes.length === 32) {
          // Gen2 treats non-address 32-byte objects as VM hash-like numeric
          // payloads, but actual Address objects must keep rejecting number casts.
          return twosComplementLEToBigInt(bytes);
        }
        throw new Error(`Invalid cast: expected number, got ${this.Type}`);
      }

      default:
        throw new Error(`Invalid cast: expected number, got ${this.Type}`);
    }
  }

  public asEnum<T>(): T {
    if (!VMObject.isEnum(this.Data)) {
      throw new Error('T must be an enumerated type');
    }

    if (this.Type !== VMType.Enum) {
      this.Data = Number(this.asNumber());
    }

    return this.Data as T;
  }

  public getArrayType(): VMType {
    if (this.Type !== VMType.Struct) {
      return VMType.None;
    }

    const children = this.getChildren();

    let result: VMType = VMType.None;

    for (let i = 0; i < children!.size; i++) {
      const val = this.getArrayValue(i);
      if (!val) {
        return VMType.None;
      }

      if (result === VMType.None) {
        result = val.Type;
      } else if (val.Type !== result) {
        return VMType.None;
      }
    }

    return result;
  }

  public asType(type: VMType): unknown {
    switch (type) {
      case VMType.Bool:
        return this.asBool();
      case VMType.String:
        return this.asString();
      case VMType.Bytes:
        return this.asByteArray();
      case VMType.Number:
        return this.asNumber();
      case VMType.Timestamp:
        return this.asTimestamp();
      default:
        throw 'Unsupported VM cast';
    }
  }

  static isEnum(instance: unknown): boolean {
    if (instance == null) return false;
    const enumLike = instance as Record<string, unknown>;
    const keys = Object.keys(enumLike);
    const values: unknown[] = [];

    for (const key of keys) {
      let value = enumLike[key];

      if (typeof value === 'number') {
        value = value.toString();
      }

      values.push(value);
    }

    for (const key of keys) {
      if (values.indexOf(key) < 0) {
        return false;
      }
    }

    return true;
  }

  /*public asEnum<T>(): T {
        if (isEnum(this.Data)) {
            throw new ArgumentException("T must be an enumerated type");
        }
        if (this.Type != VMType.Enum) {
            const num = this.asNumber();
            this.Data = Number(this.Data);
          }

          return (T) Enum.Parse(typeof T, this.Data.toString());
    }*/

  public asBool(): boolean {
    switch (this.Type) {
      case VMType.String:
        throw new Error(`Invalid cast: expected bool, got ${this.Type}`);
      case VMType.Number:
        return this.asNumber() !== 0n;
      case VMType.Bytes: {
        const bytes = VMObject.bytesFromAny(this.Data);
        if (bytes.length === 1) {
          return bytes[0] !== 0;
        }
        throw new Error(`Invalid cast: expected bool, got ${this.Type}`);
      }
      case VMType.Bool:
        return (this.Data as unknown as boolean) ? true : false;
      default:
        throw new Error(`Invalid cast: expected bool, got ${this.Type}`);
    }
  }

  public static isStructOrClass(type: unknown): boolean {
    return (
      (!VMObject.isPrimitive(type) && VMObject.isValueType(type) && !VMObject.isEnum(type)) ||
      VMObject.isClass(type) ||
      VMObject.isInterface(type)
    );
  }

  public static isSerializable(type: unknown): boolean {
    return (
      type instanceof ISerializable ||
      isSerializableLike(type) ||
      VMObject.isPrimitive(type) ||
      VMObject.isStructOrClass(type) ||
      VMObject.isEnum(type)
    );
  }

  public static isPrimitive(type: unknown): boolean {
    return type === String || type === Number || type === Boolean || type === BigInt;
  }

  public static isValueType(type: unknown): boolean {
    return type === Object;
  }

  public static isClass(type: unknown): boolean {
    return (
      type === Array ||
      type === Map ||
      type === Set ||
      type instanceof Object ||
      (typeof type).toLowerCase() === 'object'
    );
  }

  public static isInterface(type: unknown): boolean {
    return type === Map;
  }

  private static ConvertObjectInternal(fieldValue: unknown, fieldType: unknown): unknown {
    if (
      (VMObject.isStructOrClass(fieldType) && fieldValue instanceof Uint8Array) ||
      fieldValue instanceof Array
    ) {
      const bytes =
        fieldValue instanceof Uint8Array ? fieldValue : Uint8Array.from(fieldValue as number[]);
      fieldValue = Serialization.deserialize<unknown>(bytes, typeof fieldType);
    } else if (VMObject.isEnum(fieldType)) {
      const tempValue: typeof fieldType = fieldValue as keyof typeof fieldType;
      fieldValue = tempValue;
    }
    return fieldValue;
  }

  public toArray(arrayElementType: unknown): unknown[] {
    if (this.Type !== VMType.Struct) {
      throw new Error('not a valid source struct');
    }

    const children = this.getChildren();
    let maxIndex = -1;
    for (const child of children!) {
      if (child[0].Type !== VMType.Number) {
        throw new Error('source contains an element with invalid array index');
      }

      const temp = Number(child[0].asNumber());
      // TODO use a constant for VM max array size
      if (temp >= 1024) {
        throw new Error('source contains an element with a very large array index');
      }

      const index = Math.floor(temp);
      if (index < 0) {
        throw new Error('source contains an array index with negative value');
      }

      maxIndex = Math.max(index, maxIndex);
    }

    const length = maxIndex + 1;
    const array: unknown[] = new Array(length);

    for (const child of children!) {
      const temp = Number(child[0].asNumber());
      const index = Math.floor(temp);

      let val = child[1].toObjectType(arrayElementType);

      val = VMObject.ConvertObjectInternal(val, arrayElementType);

      array[index] = val;
    }

    return array;
  }

  public toObjectType(type: unknown): unknown {
    if (this.Type === VMType.Struct) {
      if (Array.isArray(type)) {
        const elementType = typeof type;
        return this.toArray(elementType);
      } else if (VMObject.isStructOrClass(type)) {
        return this.toStruct(type as VMObjectConstructor);
      } else {
        throw new Error('Unsupported VM struct conversion target');
      }
    } else {
      const temp = this.toObject();
      return temp;
    }
  }

  public toObject(): unknown {
    if (this.Type === VMType.None) {
      throw new Error('not a valid object');
    }

    switch (this.Type) {
      case VMType.Bool:
        return this.asBool();
      case VMType.Bytes:
        return this.asByteArray();
      case VMType.String:
        return this.asString();
      case VMType.Number:
        return this.asNumber();
      case VMType.Timestamp:
        return this.asTimestamp();
      case VMType.Object:
        return this.Data;
      case VMType.Enum:
        return this.Data;
      case VMType.Struct:
        const objs = this.getChildren();

        const result = [];
        for (const obj of objs!) {
          result.push(obj[1].toObject());
        }
        return result;

      default:
        throw new Error(`Cannot cast ${this.Type} to object`);
    }
  }

  public toStruct<T>(structType: VMObjectConstructor<T>): T {
    if (this.Type !== VMType.Struct) {
      throw new Error('not a valid source struct');
    }
    if (!VMObject.isStructOrClass(structType)) {
      throw new Error('not a valid destination struct');
    }

    const localType = new structType() as Record<string, unknown>;
    const dict = this.getChildren();
    if (!dict) {
      throw new Error('not a valid source struct');
    }
    const dictKeys = dict.keys();
    const result = new structType() as Record<string, unknown>;
    let fields2 = Describer.describe(structType, false);

    //console.log("fields", keyof typeof structType);
    fields2 = fields2.map((x) => x.replace('this.', ''));
    for (const field of fields2) {
      field.replace('this.', '');
      const key = VMObject.fromObject(field);
      //const key = field;
      const dictKey = dictKeys.next().value;
      if (dictKey === undefined) {
        continue;
      }
      let val: unknown;
      if (dictKey?.Data?.toString() == key?.Data?.toString()) {
        const localValue = dict.get(dictKey);

        if (localValue && localValue.getChildren() != undefined) {
          result[field] = localValue.toArray(typeof localType[field]);
          continue;
        } else if (localValue) {
          val = localValue.toObject();
        }
        //val = Serialization.deserialize(dict.get(dictKey));
      } else {
        if (!VMObject.isStructOrClass(structType[field])) {
          //console.log(`field not present in source struct: ${field}`);
          //throw new Error(`field not present in source struct: ${field}`);
        }
        //val = null;
      }
      /*if (val !== null && localType[field] !== "Uint8Array") {
        if (VMObject.isSerializable(localType[field])) {
          const temp = new structType[field]();
          const stream = new Uint8Array(val);
          const reader = new PBinaryReader(stream);
          (temp as ISerializable).UnserializeData(reader);
          val = temp;
        }
      }*/

      if (VMObject.isEnum(typeof structType[field]) && !VMObject.isEnum(val)) {
        val = (localType[field] as Record<string, unknown>)?.[val?.toString() ?? ''];
      }

      // If field hasn't been found, val will be 'undefined'.
      // This will override constructors which initialize empty fields correctly.
      // Example: ConsensusPoll initialize empty array 'entries' but code below will convert in into undefined,
      // breaking corresponding test when using ES2020.
      // Adding check here.
      if (val !== undefined) {
        result[field] = val;
      }
    }
    return result as T;
  }

  public static getVmType(type: unknown): VMType {
    const typeName = typeof type === 'string' ? type.toLowerCase() : '';
    if (VMObject.isEnum(type)) {
      return VMType.Enum;
    }
    if (type === Boolean || typeName === 'boolean') {
      return VMType.Bool;
    }
    if (type === String || typeName === 'string') {
      return VMType.String;
    }
    if (type === Uint8Array || typeName === 'uint8array') {
      return VMType.Bytes;
    }
    if (type === 'BigInt' || type === Number || type === BigInt || typeName === 'number') {
      return VMType.Number;
    }
    if (type === Timestamp || type === Number) {
      return VMType.Timestamp;
    }
    if (VMObject.isEnum(type)) {
      return VMType.Enum;
    }

    if (Array.isArray(type)) {
      return VMType.Struct;
    }

    if (VMObject.isClass(type) || VMObject.isValueType(type)) {
      return VMType.Object;
    }
    return VMType.Struct;
  }

  public static isVmType(type: unknown): boolean {
    const result = VMObject.getVmType(type);
    return result !== VMType.None;
  }

  public setValue(value: unknown): VMObject;
  public setValue(val: unknown, type: VMType): VMObject;
  public setValue(val: unknown, type?: VMType): VMObject {
    if (type === undefined) {
      this.Data = val;
      if (val instanceof VMObject) {
        this.Type = val.Type;
        this.Data = val.Data;
      } else if (val instanceof Map) {
        this.Type = VMType.Struct;
      } else if (val instanceof Uint8Array || Array.isArray(val)) {
        this.Type = VMType.Bytes;
      } else if (val instanceof Timestamp) {
        this.Type = VMType.Timestamp;
      } else if (val instanceof Address) {
        this.Type = VMType.Object;
      } else if (isSerializableLike(val)) {
        this.Type = VMType.Object;
      } else if (typeof val === 'bigint' || typeof val === 'number') {
        this.Type = VMType.Number;
        this.Data = BigInt(val);
      } else if (typeof val === 'string' || val instanceof String) {
        this.Type = VMType.String;
        this.Data = val.toString();
      } else if (typeof val === 'boolean' || val instanceof Boolean) {
        this.Type = VMType.Bool;
        this.Data = Boolean(val);
      }
      return this;
    }

    this.Type = type;
    this._localSize = objectLength(val);

    switch (type) {
      case VMType.Bytes:
        this.Data = val;
        break;
      case VMType.Number:
        this.Data = val == null ? 0n : VMObject.bigIntFromAny(val);
        break;
      case VMType.String:
        this.Data = val?.toString() ?? '';
        break;
      case VMType.Enum:
        this.Data = val;
        break;
      case VMType.Timestamp:
        if (val instanceof Timestamp) {
          this.Data = val;
        } else if (Array.isArray(val) || val instanceof Uint8Array) {
          const bytes = VMObject.bytesFromAny(val).slice(0, 4);
          let value = 0;
          for (let i = bytes.length - 1; i >= 0; i--) {
            value = value * 256 + bytes[i];
          }
          this.Data = new Timestamp(value);
        } else {
          this.Data = new Timestamp(Number(val));
        }
        break;
      case VMType.Bool:
        this.Data =
          Array.isArray(val) || val instanceof Uint8Array
            ? VMObject.bytesFromAny(val)[0] !== 0
            : Boolean(val);
        break;
      case VMType.Object:
        this.Data = val;
        break;
      default:
        if (val instanceof Uint8Array) {
          const len = val.length;
          switch (len) {
            case Address.lengthInBytes:
              this.Data = Address.fromBytes(val);
              break;
            /*case Hash.Length:
                        this.Data = Hash.fromBytes(val);
                        break;*/
            /*default:
                        try {
                            this.unserializeData(val);
                        } catch (e) {
                            throw new Error("Cannot decode interop object from bytes with length: " + len);
                        }
                        break;*/
          }
          break;
        } else {
          throw new Error('Cannot set value for vmtype: ' + type);
        }
    }
    return this;
  }

  public static validateStructKey(key: VMObject) {
    if (key.Type == VMType.None || key.Type == VMType.Struct || key.Type == VMType.Object) {
      throw new Error(`Cannot use value of type ${key.Type} as key for struct field`);
    }
  }

  public castViaReflection(
    srcObj: unknown,
    level: number,
    dontConvertSerializables: boolean = true
  ): VMObject {
    if (srcObj === null || srcObj === undefined) {
      throw new Error('invalid cast: null to vm object');
    }
    const srcType = (srcObj as object).constructor.name;
    if (Array.isArray(srcObj)) {
      const children = new Map<VMObject, VMObject>();
      const array = srcObj;
      for (let i = 0; i < array.length; i++) {
        const val = array[i];
        const key = new VMObject();
        key.setValue(i);
        const vmVal = this.castViaReflection(val, level + 1);
        children.set(key, vmVal);
      }
      const result = new VMObject();
      result.setValue(children);
      return result;
    } else {
      let result: VMObject | null;
      const srcVmType = VMObject.getVmType(srcType);
      let isKnownType = srcVmType === VMType.Number || srcVmType === VMType.Timestamp;

      const localType = Object.apply(typeof srcType);

      if (!isKnownType && dontConvertSerializables && VMObject.isSerializable(localType)) {
        isKnownType = true;
      }

      if (VMObject.isStructOrClass(localType) && !isKnownType) {
        const children = new Map<VMObject, VMObject>();
        const fields = Object.keys(srcObj as object);
        if (fields.length > 0) {
          fields.forEach((field) => {
            const key = VMObject.fromObject(field);
            if (!key) {
              throw new Error('invalid struct key');
            }
            VMObject.validateStructKey(key);
            const val = (srcObj as Record<string, unknown>)[field];
            const vmVal = this.castViaReflection(val, level + 1, true);
            children.set(key, vmVal);
          });
          result = new VMObject();
          result.setValue(children);
          result.Type = VMType.Struct;
          return result;
        }
      }

      result = VMObject.fromObject(srcObj);
      if (result != null) {
        return result;
      }
      throw new Error(`invalid cast: Interop.${srcType} to vm object`);
    }
  }

  setKey(key: VMObject, obj: VMObject) {
    VMObject.validateStructKey(key);
    let children: Map<VMObject, VMObject> | null;
    const temp = new VMObject();
    temp.copy(key);
    key = temp;

    if (this.Type == VMType.Struct) {
      children = this.getChildren();
    } else if (this.Type == VMType.None) {
      this.Type = VMType.Struct;
      children = new Map();
      this.Data = children;
      this._localSize = 0;
    } else {
      throw new Error(`Invalid cast from ${this.Type} to struct`);
    }
    const result = new VMObject();
    children?.set(key, result);
    result.copy(obj);
  }

  copy(other: VMObject) {
    if (!other || other.Type == VMType.None) {
      this.Type = VMType.None;
      this.Data = null;
      return;
    }
    this.Type = other.Type;
    if (other.Type == VMType.Struct) {
      const children = new Map<VMObject, VMObject>();
      const otherChildren = other.getChildren();
      otherChildren?.forEach((val: VMObject, key: VMObject) => {
        const temp = new VMObject();
        temp.copy(val);
        children.set(key, temp);
      });
      this.Data = children;
    } else {
      this.Data = other.Data;
    }
  }

  public setType(type: VMType) {
    this.Type = type;
  }

  public static fromArray(array: unknown[]): VMObject {
    const result = new VMObject();
    for (let i = 0; i < array.length; i++) {
      const key = VMObject.fromObject(i);
      const val = VMObject.fromObject(array[i]);
      if (!key || !val) {
        throw new Error('not a valid array item');
      }
      result.setKey(key, val);
    }
    return result;
  }

  public static castTo(srcObj: VMObject, type: VMType): VMObject {
    if (srcObj.Type == type) {
      const result = new VMObject();
      result.copy(srcObj);
      return result;
    }

    switch (type) {
      case VMType.None:
        return new VMObject();

      case VMType.String: {
        const result = new VMObject();
        result.setValue(srcObj.asString(), VMType.String);
        return result;
      }

      case VMType.Timestamp: {
        const result = new VMObject();
        result.setValue(srcObj.asTimestamp().value, VMType.Timestamp);
        return result;
      }

      case VMType.Bool: {
        const result = new VMObject();
        result.setValue(srcObj.asBool(), VMType.Bool);
        return result;
      }

      case VMType.Bytes: {
        const result = new VMObject();
        result.setValue(srcObj.asByteArray(), VMType.Bytes);
        return result;
      }

      case VMType.Number: {
        const result = new VMObject();
        result.setValue(srcObj.asNumber(), VMType.Number);
        return result;
      }

      case VMType.Struct: {
        switch (srcObj.Type) {
          case VMType.String: {
            const text = srcObj.asString();
            const values: number[] = [];
            for (let i = 0; i < text.length; i++) {
              values.push(text.charCodeAt(i));
            }
            return VMObject.fromArray(values);
          }
          case VMType.Enum: {
            const result = new VMObject();
            result.setValue(srcObj.asEnum()); // TODO does this work for all types?
            return result;
          }
          case VMType.Object: {
            const result = new VMObject();
            result.copy(srcObj);
            return result;
          }
          default:
            throw `invalid cast: ${srcObj.Type} to ${type}`;
        }
      }
      default:
        throw `invalid cast: ${srcObj.Type} to ${type}`;
    }
  }

  public static fromObject(obj: unknown): VMObject | null {
    if (obj === null || obj === undefined) {
      throw new Error('not a valid object');
    }
    const objType = (obj as object).constructor.name;

    const type = this.getVmType(objType);
    if (type === VMType.None) {
      throw new Error('not a valid object');
    }

    const result = new VMObject();
    switch (type) {
      case VMType.Bool:
        result.setValue(obj, VMType.Bool);
        break;
      case VMType.Bytes:
        result.setValue(obj, VMType.Bytes);
        break;
      case VMType.String:
        result.setValue(obj, VMType.String);
        break;
      case VMType.Enum:
        result.setValue(obj, VMType.Enum);
        break;
      case VMType.Object:
        result.setValue(obj, VMType.Object);
        break;
      case VMType.Number:
        /*if (objType === Number) {
          obj = BigInt(obj);
        }*/
        result.setValue(obj, VMType.Number);
        break;
      case VMType.Timestamp:
        /*if (objType === "Number") {
          obj = new Timestamp(obj);
        }*/
        result.setValue(obj, VMType.Timestamp);
        break;
      case VMType.Struct:
        result.Type = VMType.Struct;
        if (Array.isArray(obj)) {
          return this.fromArray(obj);
        } else {
          return this.fromStruct(obj);
        }
        break;
      default:
        return null;
    }
    return result;
  }

  public static fromEnum(obj: unknown): VMObject {
    const vm = new VMObject();
    vm.setValue(obj, VMType.Enum);
    return vm;
  }

  public static fromStruct(obj: unknown): VMObject {
    const vm = new VMObject();
    return vm.castViaReflection(obj, 0, false);
  }

  // Serialization
  public static fromBytes(bytes: Uint8Array | Buffer): VMObject {
    const result = new VMObject();
    const reader = new PBinaryReader(bytes);
    result.UnserializeData(reader);
    return result;
  }

  SerializeData(writer: PBinaryWriter) {
    writer.writeByte(this.Type as number);
    if (this.Type == VMType.None) {
      return;
    }

    switch (this.Type) {
      case VMType.Struct: {
        const children = this.getChildren();
        writer.writeVarInt(children!.size);
        for (const child of children!) {
          child[0].SerializeData(writer);
          //console.log(Base16.encodeUint8Array(writer.toUint8Array()));

          child[1].SerializeData(writer);
          ///console.log(Base16.encodeUint8Array(writer.toUint8Array()));
        }

        /*children.forEach((key, value) => {
          key.SerializeData(writer);
          value.SerializeData(writer);
        });*/
        break;
      }

      case VMType.Object: {
        // Object serialization wraps the inner serialized payload in a VM byte
        // array. Address values keep their address serializer, while raw object
        // bytes intentionally roundtrip as Bytes when they are not address-shaped.
        const inner = new PBinaryWriter();
        if (this.Data instanceof Address) {
          this.Data.SerializeData(inner);
        } else if (this.Data instanceof Uint8Array || Array.isArray(this.Data)) {
          inner.writeByteArray(VMObject.bytesFromAny(this.Data));
        } else if (isSerializableLike(this.Data)) {
          serializeSerializable(this.Data, inner);
        } else {
          throw new Error(`Objects of type ${typeof this.Data} cannot be serialized`);
        }
        writer.writeByteArray(inner.toUint8Array());
        break;
      }

      case VMType.Enum: {
        writer.writeVarInt(Number(this.Data));
        break;
      }
      case VMType.Bool:
        writer.writeBoolean(this.asBool());
        break;
      case VMType.Bytes:
        writer.writeByteArray(this.asByteArray());
        break;
      case VMType.Number:
        writer.writeBigInteger(this.asNumber());
        break;
      case VMType.String:
        writer.writeString(this.asString());
        break;
      case VMType.Timestamp:
        writer.writeTimestamp(this.asTimestamp());
        break;
      default:
        throw new Error(`Unsupported VMObject serialization type: ${this.Type}`);
    }

    return writer.toUint8Array();
  }

  public serializeData(writer: PBinaryWriter) {
    return this.SerializeData(writer);
  }

  public serializeObjectCall(writer: PBinaryWriter) {
    if (this.Type == VMType.None) {
      return;
    }

    switch (this.Type) {
      case VMType.Struct: {
        const children = this.getChildren();
        writer.writeVarInt(children!.size);
        for (const child of children!) {
          child[0].SerializeData(writer);
          child[1].SerializeData(writer);
        }

        /*children.forEach((key, value) => {
          key.SerializeData(writer);
          value.SerializeData(writer);
        });*/
        break;
      }

      case VMType.Object: {
        const inner = new PBinaryWriter();
        if (this.Data instanceof Address) {
          this.Data.SerializeData(inner);
        } else if (this.Data instanceof Uint8Array || Array.isArray(this.Data)) {
          inner.writeByteArray(VMObject.bytesFromAny(this.Data));
        } else if (isSerializableLike(this.Data)) {
          serializeSerializable(this.Data, inner);
        } else {
          throw new Error(`Objects of type ${typeof this.Data} cannot be serialized`);
        }
        writer.writeByteArray(inner.toUint8Array());
        break;
      }

      case VMType.Enum: {
        writer.writeVarInt(Number(this.Data));
        break;
      }
      case VMType.Bool:
        writer.writeBoolean(this.asBool());
        break;
      case VMType.Bytes:
        writer.writeByteArray(this.asByteArray());
        break;
      case VMType.Number:
        writer.writeBigInteger(this.asNumber());
        break;
      case VMType.String:
        writer.writeString(this.asString());
        break;
      case VMType.Timestamp:
        writer.writeTimestamp(this.asTimestamp());
        break;
      default:
        throw new Error(`Unsupported VMObject serialization type: ${this.Type}`);
    }

    return writer.toUint8Array();
  }

  /** @deprecated Use `isEmpty` instead. This alias will be removed in v1.0. */
  public get IsEmpty(): boolean {
    return this.isEmpty;
  }

  /** @deprecated Use `getChildren` instead. This alias will be removed in v1.0. */
  public GetChildren(): Map<VMObject, VMObject> | null {
    return this.getChildren();
  }

  /** @deprecated Use `size` instead. This alias will be removed in v1.0. */
  public get Size(): number {
    return this.size;
  }

  /** @deprecated Use `asTimestamp` instead. This alias will be removed in v1.0. */
  public AsTimestamp(): Timestamp {
    return this.asTimestamp();
  }

  /** @deprecated Use `asByteArray` instead. This alias will be removed in v1.0. */
  public AsByteArray(): Uint8Array {
    return this.asByteArray();
  }

  /** @deprecated Use `asString` instead. This alias will be removed in v1.0. */
  public AsString(): string {
    return this.asString();
  }

  /** @deprecated Use `asString` instead. This alias will be removed in v1.0. */
  public ToString(): string {
    return this.asString();
  }

  /** @deprecated Use `asNumber` instead. This alias will be removed in v1.0. */
  public AsNumber(): bigint {
    return this.asNumber();
  }

  /** @deprecated Use `asEnum` instead. This alias will be removed in v1.0. */
  public AsEnum<T>(): T {
    return this.asEnum<T>();
  }

  /** @deprecated Use `getArrayType` instead. This alias will be removed in v1.0. */
  public GetArrayType(): VMType {
    return this.getArrayType();
  }

  /** @deprecated Use `asType` instead. This alias will be removed in v1.0. */
  public AsType(type: VMType): unknown {
    return this.asType(type);
  }

  /** @deprecated Use `asBool` instead. This alias will be removed in v1.0. */
  public AsBool(): boolean {
    return this.asBool();
  }

  /** @deprecated Use `toArray` instead. This alias will be removed in v1.0. */
  public ToArray(arrayElementType: unknown): unknown[] {
    return this.toArray(arrayElementType);
  }

  /** @deprecated Use `toObjectType` instead. This alias will be removed in v1.0. */
  public ToObjectType(type: unknown): unknown {
    return this.toObjectType(type);
  }

  /** @deprecated Use `toObject` instead. This alias will be removed in v1.0. */
  public ToObject(): unknown {
    return this.toObject();
  }

  /** @deprecated Use `toStruct` instead. This alias will be removed in v1.0. */
  public ToStruct<T>(structType: VMObjectConstructor<T>): T {
    return this.toStruct(structType);
  }

  /** @deprecated Use `getVmType` instead. This alias will be removed in v1.0. */
  public static GetVMType(type: unknown): VMType {
    return VMObject.getVmType(type);
  }

  /** @deprecated Use `isVmType` instead. This alias will be removed in v1.0. */
  public static IsVMType(type: unknown): boolean {
    return VMObject.isVmType(type);
  }

  /** @deprecated Use `setValue` instead. This alias will be removed in v1.0. */
  public SetValue(value: unknown): VMObject;
  public SetValue(val: unknown, type: VMType): VMObject;
  public SetValue(val: unknown, type?: VMType): VMObject {
    return type === undefined ? this.setValue(val) : this.setValue(val, type);
  }

  /** @deprecated Use `validateStructKey` instead. This alias will be removed in v1.0. */
  public static ValidateStructKey(key: VMObject) {
    return VMObject.validateStructKey(key);
  }

  /** @deprecated Use `castViaReflection` instead. This alias will be removed in v1.0. */
  public CastViaReflection(
    srcObj: unknown,
    level: number,
    dontConvertSerializables: boolean = true
  ): VMObject {
    return this.castViaReflection(srcObj, level, dontConvertSerializables);
  }

  /** @deprecated Use `setKey` instead. This alias will be removed in v1.0. */
  public SetKey(key: VMObject, obj: VMObject) {
    return this.setKey(key, obj);
  }

  /** @deprecated Use `copy` instead. This alias will be removed in v1.0. */
  public Copy(other: VMObject) {
    return this.copy(other);
  }

  /** @deprecated Use `setType` instead. This alias will be removed in v1.0. */
  public SetType(type: VMType) {
    return this.setType(type);
  }

  /** @deprecated Use `fromArray` instead. This alias will be removed in v1.0. */
  public static FromArray(array: unknown[]): VMObject {
    return VMObject.fromArray(array);
  }

  /** @deprecated Use `castTo` instead. This alias will be removed in v1.0. */
  public static CastTo(srcObj: VMObject, type: VMType): VMObject {
    return VMObject.castTo(srcObj, type);
  }

  /** @deprecated Use `fromObject` instead. This alias will be removed in v1.0. */
  public static FromObject(obj: unknown): VMObject | null {
    return VMObject.fromObject(obj);
  }

  /** @deprecated Use `fromEnum` instead. This alias will be removed in v1.0. */
  public static FromEnum(obj: unknown): VMObject {
    return VMObject.fromEnum(obj);
  }

  /** @deprecated Use `fromStruct` instead. This alias will be removed in v1.0. */
  public static FromStruct(obj: unknown): VMObject {
    return VMObject.fromStruct(obj);
  }

  /** @deprecated Use `fromBytes` instead. This alias will be removed in v1.0. */
  public static FromBytes(bytes: Uint8Array | Buffer): VMObject {
    return VMObject.fromBytes(bytes);
  }

  /** @deprecated Use `serializeObjectCall` instead. This alias will be removed in v1.0. */
  public SerializeObjectCall(writer: PBinaryWriter) {
    return this.serializeObjectCall(writer);
  }

  /*UnserializeData(reader: PBinaryReader) {
    this.Type = reader.readByte();
    if (this.Type == VMType.None) {
      return;
    }

    switch (this.Type) {
      case VMType.Struct: {
        let children = new Map<VMObject, VMObject>();
        let count = reader.readVarInt();
        for (let i = 0; i < count; i++) {
          let key = new VMObject();
          key.UnserializeData(reader);
          let value = new VMObject();
          value.UnserializeData(reader);
          children.set(key, value);
        }
        this.Data = children;
        break;
      }

      case VMType.Object: {
        var bytes = reader.readByteArray();
        var obj = Serialization.deserialize(bytes);
        this.Data = obj as Object;
        break;
      }

      case VMType.Enum: {
        let temp = reader.readVarInt();
        this.Data = temp as unknown as Enumerator;
        break;
      }

      default:
        this.Data = Serialization.deserializeObject(reader, null);
        break;
    }
  }*/

  UnserializeData(reader: PBinaryReader) {
    this.Type = reader.readByte() as VMType;
    switch (this.Type) {
      case VMType.Bool:
        this.Data = reader.readBoolean();
        break;

      case VMType.Bytes:
        this.Data = VMObject.bytesFromAny(reader.readByteArray());
        break;

      case VMType.Number:
        this.Data = reader.readBigInteger();
        break;

      case VMType.Timestamp:
        this.Data = reader.readTimestamp();
        /*this.Data = Serialization.deserializeObject<Timestamp>(
          reader,
          Timestamp
        );*/
        break;

      case VMType.String:
        this.Data = reader.readVarString() as string;
        break;

      case VMType.Struct:
        let childCount = reader.readVarInt();
        const children = new Map<VMObject, VMObject>();
        while (childCount > 0) {
          const key = new VMObject();
          key.UnserializeData(reader);

          VMObject.validateStructKey(key);

          const val = new VMObject();
          val.UnserializeData(reader);

          children.set(key, val);
          childCount--;
        }

        this.Data = children;
        break;

      case VMType.Object:
        const bytes = VMObject.bytesFromAny(reader.readByteArray());

        // Gen2 only restores VM Object when the wrapped payload is an encoded
        // Address. Other object payloads remain byte arrays after deserialization.
        if (bytes.length == Address.lengthInBytes + 1 && bytes[0] == Address.lengthInBytes) {
          this.Data = Address.fromBytes(bytes.slice(1));
          this.Type = VMType.Object;
        } else {
          this.Type = VMType.Bytes;
          this.Data = bytes;
        }

        break;

      case VMType.Enum:
        this.Type = VMType.Enum;
        this.Data = reader.readVarInt() as number;
        break;

      case VMType.None:
        this.Type = VMType.None;
        this.Data = null;
        break;

      default:
        throw new Error(`invalid unserialize: type ${this.Type}`);
    }
  }

  public unserializeData(reader: PBinaryReader) {
    this.UnserializeData(reader);
  }
}

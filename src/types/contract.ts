import { ISerializable } from '../interfaces/index.js';
import { VMType } from '../vm/vm-type.js';
import { arrayNumberToUint8Array, uint8ArrayToNumberArray } from '../utils/index.js';
import { TokenTrigger } from './domain-settings.js';
import { PBinaryReader, PBinaryWriter } from './extensions/index.js';

export class ContractParameter {
  name: string;
  type: VMType;

  constructor(name: string, type: VMType) {
    this.name = name;
    this.type = type;
  }
}

export class ContractInterface implements ISerializable {
  public static readonly empty: ContractInterface = new ContractInterface([], []);
  /** @deprecated Use `empty` instead. This alias will be removed in v1.0. */
  public static readonly Empty: ContractInterface = ContractInterface.empty;
  private _methods = new Map<string, ContractMethod>();

  private _events: ContractEvent[];

  public get methods(): ContractMethod[] {
    return Array.from(this._methods.values());
  }

  public set methods(value: ContractMethod[]) {
    this._methods = new Map<string, ContractMethod>();
    for (const entry of value) {
      this._methods.set(entry.name, entry);
    }
  }

  /** @deprecated Use `methods` instead. This alias will be removed in v1.0. */
  public get Methods(): ContractMethod[] {
    return this.methods;
  }

  public set Methods(value: ContractMethod[]) {
    this.methods = value;
  }

  public get methodCount(): number {
    return this._methods.size;
  }

  /** @deprecated Use `methodCount` instead. This alias will be removed in v1.0. */
  public get MethodCount(): number {
    return this.methodCount;
  }

  public set MethodCount(_value: number) {
    // Compatibility no-op: the method count is derived from the method map.
  }

  public get events(): ContractEvent[] {
    return this._events;
  }

  public set events(value: ContractEvent[]) {
    this._events = value;
  }

  /** @deprecated Use `events` instead. This alias will be removed in v1.0. */
  public Events(): ContractEvent[] {
    return this.events;
  }

  public get eventCount() {
    return this._events.length;
  }

  /** @deprecated Use `eventCount` instead. This alias will be removed in v1.0. */
  public EventCount() {
    return this.eventCount;
  }

  public newEmpty() {
    this._methods = new Map<string, ContractMethod>();
    this._events = [];
  }

  public constructor(methods: ContractMethod[] = [], events: ContractEvent[] = []) {
    // Keep legacy public fields visible to reflection/spread consumers while
    // deriving their values from the canonical method map.
    Object.defineProperties(this, {
      Methods: {
        configurable: true,
        enumerable: true,
        get: () => this.methods,
        set: (value: ContractMethod[]) => {
          this.methods = value;
        },
      },
      MethodCount: {
        configurable: true,
        enumerable: true,
        get: () => this.methodCount,
        set: () => {
          // Compatibility no-op: the method count is derived from the method map.
        },
      },
    });

    for (const entry of methods) {
      this._methods.set(entry.name, entry);
    }
    this._events = events;
  }

  public get(name: string): ContractMethod | null {
    return this.findMethod(name);
  }

  public hasMethod(name: string): boolean {
    return this._methods.has(name);
  }

  /** @deprecated Use `hasMethod` instead. This alias will be removed in v1.0. */
  public HasMethod(name: string): boolean {
    return this.hasMethod(name);
  }

  public hasTokenTrigger(trigger: TokenTrigger): boolean {
    const strName = trigger.toString();
    const name = strName[0].toLowerCase() + strName.slice(1);
    return this._methods.has(name);
  }

  /** @deprecated Use `hasTokenTrigger` instead. This alias will be removed in v1.0. */
  public HasTokenTrigger(trigger: TokenTrigger): boolean {
    return this.hasTokenTrigger(trigger);
  }

  public findMethod(name: string): ContractMethod | null {
    return this._methods.get(name) ?? null;
  }

  /** @deprecated Use `findMethod` instead. This alias will be removed in v1.0. */
  public FindMethod(name: string): ContractMethod | null {
    return this.findMethod(name);
  }

  public findEvent(value: number): ContractEvent | null {
    for (const evt of this._events) {
      if (evt.value === value) {
        return evt;
      }
    }
    return null;
  }

  /** @deprecated Use `findEvent` instead. This alias will be removed in v1.0. */
  public FindEvent(value: number): ContractEvent | null {
    return this.findEvent(value);
  }

  public implementsEvent(evt: ContractEvent): boolean {
    for (const entry of this.events) {
      if (
        entry.name === evt.name &&
        entry.value === evt.value &&
        entry.returnType === evt.returnType
      ) {
        return true;
      }
    }
    return false;
  }

  /** @deprecated Use `implementsEvent` instead. This alias will be removed in v1.0. */
  public ImplementsEvent(evt: ContractEvent): boolean {
    return this.implementsEvent(evt);
  }

  public implementsMethod(method: ContractMethod): boolean {
    const thisMethod = this._methods.get(method.name);
    if (thisMethod === undefined) {
      return false;
    }
    if (thisMethod.parameters.length !== method.parameters.length) {
      return false;
    }

    for (let i = 0; i < method.parameters.length; i++) {
      if (thisMethod.parameters[i].type !== method.parameters[i].type) {
        return false;
      }
    }

    return true;
  }

  /** @deprecated Use `implementsMethod` instead. This alias will be removed in v1.0. */
  public ImplementsMethod(method: ContractMethod): boolean {
    return this.implementsMethod(method);
  }

  public implementsInterface(other: ContractInterface): boolean {
    for (const method of other.methods) {
      if (!this.implementsMethod(method)) {
        return false;
      }
    }

    for (const evt of other.events) {
      if (!this.implementsEvent(evt)) {
        return false;
      }
    }

    return true;
  }

  /** @deprecated Use `implementsInterface` instead. This alias will be removed in v1.0. */
  public ImplementsInterface(other: ContractInterface): boolean {
    return this.implementsInterface(other);
  }

  public unserializeData(reader: PBinaryReader): void {
    const len = reader.readByte();
    this._methods.clear();
    for (let i = 0; i < len; i++) {
      const method = ContractMethod.deserialize(reader);
      this._methods.set(method.name, method);
    }
    const eventLen = reader.readByte();
    this._events = [];
    for (let i = 0; i < eventLen; i++) {
      this._events.push(ContractEvent.deserialize(reader));
    }
  }

  /** @deprecated Use `unserializeData` instead. This alias will be removed in v1.0. */
  public UnserializeData(reader: PBinaryReader): void {
    this.unserializeData(reader);
  }

  public serializeData(writer: PBinaryWriter): void {
    writer.writeByte(this._methods.size);
    for (const value of this._methods.values()) {
      value.serialize(writer);
    }
    writer.writeByte(this._events.length);
    for (const entry of this._events) {
      entry.serialize(writer);
    }
  }

  /** @deprecated Use `serializeData` instead. This alias will be removed in v1.0. */
  public SerializeData(writer: PBinaryWriter): void {
    this.serializeData(writer);
  }
}

export class ContractMethod implements ISerializable {
  public name: string;
  public returnType: VMType;
  public parameters: ContractParameter[];
  public offset: number;

  serializeData(writer: PBinaryWriter) {
    this.serialize(writer);
  }

  /** @deprecated Use `serializeData` instead. This alias will be removed in v1.0. */
  SerializeData(writer: PBinaryWriter) {
    this.serializeData(writer);
  }

  unserializeData(reader: PBinaryReader): void {
    const restored = ContractMethod.deserialize(reader);
    this.name = restored.name;
    this.returnType = restored.returnType;
    this.offset = restored.offset;
    this.parameters = restored.parameters;
  }

  /** @deprecated Use `unserializeData` instead. This alias will be removed in v1.0. */
  UnserializeData(reader: PBinaryReader): void {
    this.unserializeData(reader);
  }

  public constructorOne(
    name: string,
    returnType: VMType,
    labels: Map<string, number>,
    parameters: ContractParameter[]
  ) {
    if (!labels.has(name)) {
      throw new Error(`Missing offset in label map for method ${name}`);
    }

    const offset = labels.get(name);
    if (offset === undefined) {
      throw new Error(`Missing offset in label map for method ${name}`);
    }

    this.name = name;
    this.offset = offset;
    this.returnType = returnType;
    this.parameters = parameters;
  }

  constructor(
    name: string = '',
    returnType: VMType = VMType.None,
    offset: number = 0,
    parameters: ContractParameter[] = []
  ) {
    this.name = name;
    this.offset = offset;
    this.returnType = returnType;
    this.parameters = parameters;
  }

  public isProperty(): boolean {
    if (
      this.name.length >= 4 &&
      this.name.startsWith('get') &&
      this.name[3] === this.name[3].toUpperCase()
    ) {
      return true;
    }

    if (
      this.name.length >= 3 &&
      this.name.startsWith('is') &&
      this.name[2] === this.name[2].toUpperCase()
    ) {
      return true;
    }

    return false;
  }

  public isTrigger(): boolean {
    if (
      this.name.length >= 3 &&
      this.name.startsWith('on') &&
      this.name[2] === this.name[2].toUpperCase()
    ) {
      return true;
    }

    return false;
  }

  public toString(): string {
    return `${this.name} : ${this.returnType}`;
  }

  public static fromBytes(bytes: Uint8Array): ContractMethod {
    const stream = new Uint8Array(bytes);
    const reader = new PBinaryReader(stream);
    return ContractMethod.deserialize(reader);
  }

  public static deserialize(reader: PBinaryReader): ContractMethod {
    const name = reader.readString();
    const returnType = reader.readByte() as VMType;
    const offset = reader.readInt();
    const len = reader.readByte();
    const parameters: ContractParameter[] = new Array(len);
    for (let i = 0; i < len; i++) {
      const pName = reader.readString();
      const pVMType = reader.readByte() as VMType;
      parameters[i] = new ContractParameter(pName, pVMType);
    }

    return new ContractMethod(name, returnType, offset, parameters);
  }

  /** @deprecated Use `deserialize` instead. This alias will be removed in v1.0. */
  public static Unserialize(reader: PBinaryReader): ContractMethod {
    return ContractMethod.deserialize(reader);
  }

  public serialize(writer: PBinaryWriter): void {
    writer.writeString(this.name);
    writer.writeByte(this.returnType);
    writer.writeInt(this.offset);
    writer.writeByte(this.parameters.length);
    this.parameters.forEach((entry) => {
      writer.writeString(entry.name);
      writer.writeByte(entry.type);
    });
  }

  /** @deprecated Use `serialize` instead. This alias will be removed in v1.0. */
  public Serialize(writer: PBinaryWriter): void {
    this.serialize(writer);
  }

  public toArray(): Uint8Array {
    const stream = new Uint8Array();
    const writer = new PBinaryWriter(stream);
    this.serialize(writer);
    return stream;
  }
}

export class ContractEvent implements ISerializable {
  public value: number;
  public name: string;
  public returnType: VMType;
  public description: Uint8Array;

  constructor(
    value: number = 0,
    name: string = '',
    returnType: VMType = VMType.None,
    description: Uint8Array = new Uint8Array()
  ) {
    this.value = value;
    this.name = name;
    this.returnType = returnType;
    this.description = description;
  }

  serializeData(writer: PBinaryWriter) {
    this.serialize(writer);
  }

  /** @deprecated Use `serializeData` instead. This alias will be removed in v1.0. */
  SerializeData(writer: PBinaryWriter) {
    this.serializeData(writer);
  }

  unserializeData(reader: PBinaryReader): void {
    const restored = ContractEvent.deserialize(reader);
    this.value = restored.value;
    this.name = restored.name;
    this.returnType = restored.returnType;
    this.description = restored.description;
  }

  /** @deprecated Use `unserializeData` instead. This alias will be removed in v1.0. */
  UnserializeData(reader: PBinaryReader): void {
    this.unserializeData(reader);
  }

  public toString(): string {
    return `${this.name} : ${this.returnType} => ${this.value}`;
  }

  public static deserialize(reader: PBinaryReader): ContractEvent {
    const value = reader.readByte();
    const name = reader.readString();
    const returnType = reader.readByte() as VMType;
    const description = reader.readBytes(reader.readByte());

    return new ContractEvent(value, name, returnType, arrayNumberToUint8Array(description));
  }

  /** @deprecated Use `deserialize` instead. This alias will be removed in v1.0. */
  public static Unserialize(reader: PBinaryReader): ContractEvent {
    return ContractEvent.deserialize(reader);
  }

  public serialize(writer: PBinaryWriter): void {
    writer.writeByte(this.value);
    writer.writeString(this.name);
    writer.writeByte(this.returnType);
    writer.writeByte(this.description.length);
    writer.writeBytes(uint8ArrayToNumberArray(this.description));
  }

  /** @deprecated Use `serialize` instead. This alias will be removed in v1.0. */
  public Serialize(writer: PBinaryWriter): void {
    this.serialize(writer);
  }
}

import { ISerializable } from '../interfaces/index.js';
import { bytesToHex, stringToUint8Array } from '../utils/index.js';
import { Base16, PBinaryReader, PBinaryWriter } from './extensions/index.js';
import { Timestamp } from './timestamp.js';

export enum ConsensusMode {
  Unanimity,
  Majority,
  Popularity,
  Ranking,
}

export enum PollState {
  Inactive,
  Active,
  Consensus,
  Failure,
}

export class PollChoice implements ISerializable {
  public value: string; // Should be byte[]

  public constructor(value: string | number[]) {
    if (value instanceof Array) this.value = Base16.decode(bytesToHex(value));
    else this.value = value;
  }

  serializeData(writer: PBinaryWriter) {
    writer.writeByteArray(stringToUint8Array(this.value));
  }

  /** @deprecated Use `serializeData` instead. This alias will be removed in v1.0. */
  SerializeData(writer: PBinaryWriter) {
    this.serializeData(writer);
  }

  unserializeData(reader: PBinaryReader) {
    this.value = Base16.decode(reader.readByteArray());
  }

  /** @deprecated Use `unserializeData` instead. This alias will be removed in v1.0. */
  UnserializeData(reader: PBinaryReader) {
    this.unserializeData(reader);
  }

  static deserialize(reader: PBinaryReader): PollChoice {
    const pollChoice = new PollChoice('');
    pollChoice.unserializeData(reader);
    return pollChoice;
  }

  /** @deprecated Use `deserialize` instead. This alias will be removed in v1.0. */
  static Unserialize(reader: PBinaryReader): PollChoice {
    return PollChoice.deserialize(reader);
  }
}

export class PollValue implements ISerializable {
  public value = ''; // Should be byte[]
  public ranking = 0n;
  public votes = 0n;

  serializeData(writer: PBinaryWriter) {
    writer.writeByteArray(stringToUint8Array(this.value));
    writer.writeBigInteger(this.ranking);
    writer.writeBigInteger(this.votes);
  }

  /** @deprecated Use `serializeData` instead. This alias will be removed in v1.0. */
  SerializeData(writer: PBinaryWriter) {
    this.serializeData(writer);
  }

  unserializeData(reader: PBinaryReader) {
    this.value = Base16.decode(reader.readByteArray());
    this.ranking = reader.readBigInteger();
    this.votes = reader.readBigInteger();
  }

  /** @deprecated Use `unserializeData` instead. This alias will be removed in v1.0. */
  UnserializeData(reader: PBinaryReader) {
    this.unserializeData(reader);
  }

  static deserialize(reader: PBinaryReader): PollValue {
    const pollValue = new PollValue();
    pollValue.unserializeData(reader);
    return pollValue;
  }

  /** @deprecated Use `deserialize` instead. This alias will be removed in v1.0. */
  static Unserialize(reader: PBinaryReader): PollValue {
    return PollValue.deserialize(reader);
  }
}

export class PollVote implements ISerializable {
  public index = 0n;
  public percentage = 0n;

  serializeData(writer: PBinaryWriter) {
    writer.writeBigInteger(this.index);
    writer.writeBigInteger(this.percentage);
  }

  /** @deprecated Use `serializeData` instead. This alias will be removed in v1.0. */
  SerializeData(writer: PBinaryWriter) {
    this.serializeData(writer);
  }

  unserializeData(reader: PBinaryReader) {
    this.index = reader.readBigInteger();
    this.percentage = reader.readBigInteger();
  }

  /** @deprecated Use `unserializeData` instead. This alias will be removed in v1.0. */
  UnserializeData(reader: PBinaryReader) {
    this.unserializeData(reader);
  }

  static deserialize(reader: PBinaryReader): PollVote {
    const pollVote = new PollVote();
    pollVote.unserializeData(reader);
    return pollVote;
  }

  /** @deprecated Use `deserialize` instead. This alias will be removed in v1.0. */
  static Unserialize(reader: PBinaryReader): PollVote {
    return PollVote.deserialize(reader);
  }
}

export class ConsensusPoll implements ISerializable {
  public subject: string;
  public organization: string;
  public mode: ConsensusMode;
  public state: PollState;
  public entries: PollValue[];
  public round: bigint;
  public startTime: Timestamp;
  public endTime: Timestamp;
  public choicesPerUser: bigint;
  public totalVotes: bigint;

  constructor() {
    this.subject = '';
    this.organization = '';
    this.mode = ConsensusMode.Unanimity;
    this.state = PollState.Inactive;
    this.entries = [];
    this.round = BigInt(0);
    this.startTime = Timestamp.null;
    this.endTime = Timestamp.null;
    this.choicesPerUser = BigInt(0);
    this.totalVotes = BigInt(0);
  }

  serializeData(writer: PBinaryWriter) {
    writer.writeString(this.subject);
    writer.writeString(this.organization);
    writer.writeByte(this.mode);
    writer.writeByte(this.state);
    writer.writeByte(this.entries.length);

    this.entries.forEach((entry) => {
      entry.serializeData(writer);
    });

    writer.writeBigInteger(this.round);
    writer.writeTimestamp(this.startTime);
    writer.writeTimestamp(this.endTime);
    writer.writeBigInteger(this.choicesPerUser);
    writer.writeBigInteger(this.totalVotes);
  }

  /** @deprecated Use `serializeData` instead. This alias will be removed in v1.0. */
  SerializeData(writer: PBinaryWriter) {
    this.serializeData(writer);
  }

  unserializeData(reader: PBinaryReader) {
    this.subject = reader.readString();
    this.organization = reader.readString();
    this.mode = reader.readByte() as ConsensusMode;
    this.state = reader.readByte() as PollState;

    this.entries = [];
    const entriesLength = reader.readByte();
    for (let i = 0; i < entriesLength; i++) {
      this.entries.push(PollValue.deserialize(reader));
    }

    this.round = reader.readBigInteger();
    this.startTime = reader.readTimestamp();
    this.endTime = reader.readTimestamp();
    this.choicesPerUser = reader.readBigInteger();
    this.totalVotes = reader.readBigInteger();
  }

  static deserialize(reader: PBinaryReader): ConsensusPoll {
    const consensusPoll = new ConsensusPoll();
    consensusPoll.unserializeData(reader);
    return consensusPoll;
  }

  /** @deprecated Use `deserialize` instead. This alias will be removed in v1.0. */
  static Unserialize(reader: PBinaryReader): ConsensusPoll {
    return ConsensusPoll.deserialize(reader);
  }

  /** @deprecated Use `unserializeData` instead. This alias will be removed in v1.0. */
  UnserializeData(reader: PBinaryReader) {
    this.unserializeData(reader);
  }
}

export class PollPresence implements ISerializable {
  public subject = '';
  public round = 0n;

  serializeData(writer: PBinaryWriter) {
    writer.writeString(this.subject);
    writer.writeBigInteger(this.round);
  }

  /** @deprecated Use `serializeData` instead. This alias will be removed in v1.0. */
  SerializeData(writer: PBinaryWriter) {
    this.serializeData(writer);
  }

  unserializeData(reader: PBinaryReader) {
    this.subject = reader.readString();
    this.round = reader.readBigInteger();
  }

  /** @deprecated Use `unserializeData` instead. This alias will be removed in v1.0. */
  UnserializeData(reader: PBinaryReader) {
    this.unserializeData(reader);
  }

  static deserialize(reader: PBinaryReader): PollPresence {
    const pollPresence = new PollPresence();
    pollPresence.unserializeData(reader);
    return pollPresence;
  }

  /** @deprecated Use `deserialize` instead. This alias will be removed in v1.0. */
  static Unserialize(reader: PBinaryReader): PollPresence {
    return PollPresence.deserialize(reader);
  }
}

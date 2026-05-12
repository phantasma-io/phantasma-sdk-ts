import {
  ContractEvent,
  ContractInterface,
  ContractMethod,
  ConsensusMode,
  ConsensusPoll,
  PBinaryReader,
  PBinaryWriter,
  PollPresence,
  PollState,
  PollValue,
  ScriptBuilder,
  Serialization,
  VMObject,
  VMType,
} from '../../src/core';
import type { Serializable } from '../../src/public';

class CanonicalSerializable implements Serializable {
  value = '';

  constructor(value: string = '') {
    this.value = value;
  }

  serializeData(writer: PBinaryWriter): void {
    writer.writeString(this.value);
  }

  unserializeData(reader: PBinaryReader): void {
    this.value = reader.readString();
  }
}

describe('canonical Serializable interface', () => {
  test('Serialization accepts lower-camel serializable objects', () => {
    const bytes = Serialization.serialize(new CanonicalSerializable('canonical'));
    const decoded = Serialization.deserialize<CanonicalSerializable>(bytes, CanonicalSerializable);

    expect(decoded).toBeInstanceOf(CanonicalSerializable);
    expect(decoded.value).toBe('canonical');
  });

  test('ScriptBuilder and VMObject accept lower-camel serializable objects', () => {
    const value = new CanonicalSerializable('vm');
    const script = new ScriptBuilder().beginScript().emitLoadSerializable(0, value).endScript();
    const vmObject = new VMObject().setValue(value, VMType.Object);
    const writer = new PBinaryWriter();

    expect(script).toMatch(/0B$/);
    expect(() => vmObject.serializeData(writer)).not.toThrow();
    expect(writer.toUint8Array().length).toBeGreaterThan(0);
  });

  test('contract ABI classes round-trip through the shared Serialization API', () => {
    const method = new ContractMethod('getName', VMType.String, 7, []);
    const event = new ContractEvent(3, 'updated', VMType.String, new Uint8Array([1, 2, 3]));
    const contract = new ContractInterface([method], [event]);

    // Behavior: classes that advertise Serializable must restore the current
    // instance through unserializeData, because Serialization.deserialize()
    // instantiates the class and then mutates it through the shared contract.
    const decodedMethod = Serialization.deserialize<ContractMethod>(
      Serialization.serialize(method),
      ContractMethod
    );
    const decodedEvent = Serialization.deserialize<ContractEvent>(
      Serialization.serialize(event),
      ContractEvent
    );
    const decodedContract = Serialization.deserialize<ContractInterface>(
      Serialization.serialize(contract),
      ContractInterface
    );

    expect(decodedMethod).toBeInstanceOf(ContractMethod);
    expect(decodedMethod.name).toBe(method.name);
    expect(decodedMethod.returnType).toBe(method.returnType);
    expect(decodedMethod.offset).toBe(method.offset);
    expect(decodedMethod.parameters).toHaveLength(0);
    expect(decodedEvent).toBeInstanceOf(ContractEvent);
    expect(decodedEvent.value).toBe(event.value);
    expect(decodedEvent.name).toBe(event.name);
    expect(decodedEvent.returnType).toBe(event.returnType);
    expect(decodedEvent.description).toStrictEqual(event.description);
    expect(decodedContract).toBeInstanceOf(ContractInterface);
    expect(decodedContract.methods).toHaveLength(1);
    expect(decodedContract.events).toHaveLength(1);
    expect(decodedContract.findMethod(method.name)?.offset).toBe(method.offset);
    expect(decodedContract.findEvent(event.value)?.name).toBe(event.name);
  });

  test('consensus serializable classes round-trip their own wire format', () => {
    const value = new PollValue();
    value.value = 'choice';
    value.ranking = 1n;
    value.votes = 2n;

    const poll = new ConsensusPoll();
    poll.subject = 'subject';
    poll.organization = 'validators';
    poll.mode = ConsensusMode.Majority;
    poll.state = PollState.Active;
    poll.entries = [value];
    poll.round = 3n;
    poll.choicesPerUser = 1n;
    poll.totalVotes = 2n;

    const presence = new PollPresence();
    presence.subject = 'subject';
    presence.round = 3n;

    // Behavior: the lower-camel consensus serializers must be symmetric so
    // callers can safely use them through the shared Serializable contract.
    const decodedPoll = Serialization.deserialize<ConsensusPoll>(
      Serialization.serialize(poll),
      ConsensusPoll
    );
    const decodedPresence = Serialization.deserialize<PollPresence>(
      Serialization.serialize(presence),
      PollPresence
    );

    expect(decodedPoll.subject).toBe(poll.subject);
    expect(decodedPoll.organization).toBe(poll.organization);
    expect(decodedPoll.mode).toBe(poll.mode);
    expect(decodedPoll.state).toBe(poll.state);
    expect(decodedPoll.entries).toHaveLength(1);
    expect(decodedPoll.entries[0].value).toBe(value.value);
    expect(decodedPoll.entries[0].ranking).toBe(value.ranking);
    expect(decodedPoll.entries[0].votes).toBe(value.votes);
    expect(decodedPoll.round).toBe(poll.round);
    expect(decodedPoll.choicesPerUser).toBe(poll.choicesPerUser);
    expect(decodedPoll.totalVotes).toBe(poll.totalVotes);
    expect(decodedPresence.subject).toBe(presence.subject);
    expect(decodedPresence.round).toBe(presence.round);
  });
});

import {
  Base16,
  PBinaryWriter,
  PollChoice,
  Serialization,
  Timestamp,
  VMObject,
  VMType,
} from '../src/core';

describe('VM index file', () => {
  test('empty string should result in zero', () => {
    const vm = new VMObject();

    expect(vm).toBeInstanceOf(VMObject);
    expect(vm.Type).toBe(VMType.None);
  });

  test('String VM', () => {
    const myNewVM = VMObject.fromObject('MyString');

    expect(myNewVM).toBeInstanceOf(VMObject);
    expect(myNewVM.Type).toBe(VMType.String);
    const result = myNewVM.asString();
    expect(result).toBe('MyString');
  });

  test('Number VM', () => {
    const myNewVM = VMObject.fromObject(5);

    expect(myNewVM).toBeInstanceOf(VMObject);
    expect(myNewVM.Type).toBe(VMType.Number);
    const result = myNewVM.asString();
    expect(result).toBe('5');
    expect(myNewVM.asNumber()).toBe(5n);
  });

  test('VMObject does not install a throwing JavaScript toString hook', () => {
    // Behavior: domain string conversion stays explicit through asString; JS coercion remains safe.
    const empty = new VMObject();

    expect(String(empty)).toBe('[object Object]');
    expect(() => empty.asString()).toThrow('Invalid cast: expected string');
  });

  /*test("Bool VM", () => {
    let vm = new phantasmaJS.VMObject();
    let myNewVM = VMObject.fromObject(true);

    expect(myNewVM).toBeInstanceOf(phantasmaJS.VMObject);
    expect(myNewVM.Type).toBe(phantasmaJS.VMType.Bool);
    expect(myNewVM.asString()).toBe("true");
    expect(myNewVM.asBool()).toBe(true);
  });

  test("Struct VM", () => {
    let vm = new phantasmaJS.VMObject();
    let choice = new phantasmaJS.PollChoice("myChoice");
    let myNewVM = VMObject.fromStruct(choice);

    expect(myNewVM).toBeInstanceOf(phantasmaJS.VMObject);
    expect(myNewVM.Type).toBe(phantasmaJS.VMType.Struct);
    let result = myNewVM.toStruct(PollChoice) as PollChoice;
    expect(result).toStrictEqual(choice);
  });

  test("TestTypes", () => {
    let vm = new phantasmaJS.VMObject();
    let choice = new phantasmaJS.PollChoice("myChoice");
    let myNewVM = VMObject.fromStruct(choice);

    expect(VMObject.isPrimitive(PollChoice)).toBe(false);
    expect(VMObject.isValueType(PollChoice)).toBe(false);
    expect(VMObject.isClass(PollChoice)).toBe(true);
    expect(VMObject.isEnum(PollChoice)).toBe(false);
    expect(VMObject.isSerializable(PollChoice)).toBe(true);
    expect(VMObject.isInterface(PollChoice)).toBe(false);
    expect(VMObject.isStructOrClass(PollChoice as unknown as Type)).toBe(true);
    expect(myNewVM.Type).toBe(phantasmaJS.VMType.Struct);
  });*/

  test('PollChoices', () => {
    const choice = new PollChoice('myChoice');
    const choice2 = new PollChoice('myChoice');
    const choices: PollChoice[] = [choice, choice2];
    const myNewVM = VMObject.fromArray(choices);

    expect(myNewVM).toBeInstanceOf(VMObject);
    expect(myNewVM.Type).toBe(VMType.Struct);
    //let result = myNewVM.toArray(PollChoice) as PollChoice[];
    //expect(result).toStrictEqual(choices);
  });

  test('Serialization', () => {
    const choice = new PollChoice('myChoice');
    const choice2 = new PollChoice('myChoice');
    const time = new Timestamp(10000);
    const choices: PollChoice[] = [choice, choice2];

    class myTestClass {
      name: string = 'test';
      choices: PollChoice[] = choices;
      time: Timestamp = time;
      constructor() {}
    }

    const testClass = new myTestClass();

    const choice1Serialized = Serialization.Serialize(testClass);
    expect(() =>
      Serialization.Unserialize<myTestClass>(choice1Serialized, myTestClass)
    ).not.toThrow();

    const myVM = VMObject.fromObject(choice1Serialized);
    const writer = new PBinaryWriter();
    const result = myVM.SerializeData(writer);

    expect(choice1Serialized.length).toBeGreaterThan(0);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);

    /*let choicesSerialized: Uint8Array[] = [
      Serialization.Serialize(choice),
      Serialization.Serialize(choice2),
    ];
    let myNewVM = VMObject.fromArray(choices);

    expect(myNewVM).toBeInstanceOf(phantasmaJS.VMObject);
    expect(myNewVM.Type).toBe(phantasmaJS.VMType.Struct);
    let writer = new PBinaryWriter();
    let result = myNewVM.SerializeData(writer);
    expect(writer.toArray()).toStrictEqual(choices);*/
  });

  test('Serialization2', () => {
    const choice = new PollChoice('myChoice');
    const choice2 = new PollChoice('myChoice');
    const choices: PollChoice[] = [choice, choice2];
    const choicesSerialized = Serialization.Serialize(choices);
    expect(choicesSerialized.length).toBeGreaterThan(0);
  });

  test('DecodeBool', () => {
    const vmCode = '0601';
    const bytes = Base16.decodeUint8Array(vmCode);
    const vm = VMObject.fromBytes(bytes);

    expect(vm.Type).toBe(VMType.Bool);
    expect(vm.asBool()).toBe(true);
  });
});

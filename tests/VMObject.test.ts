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
    const myNewVM = VMObject.FromObject('MyString');

    expect(myNewVM).toBeInstanceOf(VMObject);
    expect(myNewVM.Type).toBe(VMType.String);
    const result = myNewVM.AsString();
    expect(result).toBe('MyString');
  });

  test('Number VM', () => {
    const myNewVM = VMObject.FromObject(5);

    expect(myNewVM).toBeInstanceOf(VMObject);
    expect(myNewVM.Type).toBe(VMType.Number);
    const result = myNewVM.AsString();
    expect(result).toBe('5');
    expect(myNewVM.AsNumber()).toBe(5n);
  });

  /*test("Bool VM", () => {
    let vm = new phantasmaJS.VMObject();
    let myNewVM = VMObject.FromObject(true);

    expect(myNewVM).toBeInstanceOf(phantasmaJS.VMObject);
    expect(myNewVM.Type).toBe(phantasmaJS.VMType.Bool);
    expect(myNewVM.AsString()).toBe("true");
    expect(myNewVM.AsBool()).toBe(true);
  });

  test("Struct VM", () => {
    let vm = new phantasmaJS.VMObject();
    let choice = new phantasmaJS.PollChoice("myChoice");
    let myNewVM = VMObject.FromStruct(choice);

    expect(myNewVM).toBeInstanceOf(phantasmaJS.VMObject);
    expect(myNewVM.Type).toBe(phantasmaJS.VMType.Struct);
    let result = myNewVM.ToStruct(PollChoice) as PollChoice;
    expect(result).toStrictEqual(choice);
  });

  test("TestTypes", () => {
    let vm = new phantasmaJS.VMObject();
    let choice = new phantasmaJS.PollChoice("myChoice");
    let myNewVM = VMObject.FromStruct(choice);

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
    const myNewVM = VMObject.FromArray(choices);

    expect(myNewVM).toBeInstanceOf(VMObject);
    expect(myNewVM.Type).toBe(VMType.Struct);
    //let result = myNewVM.ToArray(PollChoice) as PollChoice[];
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

    const myVM = VMObject.FromObject(choice1Serialized);
    const writer = new PBinaryWriter();
    const result = myVM.SerializeData(writer);

    expect(choice1Serialized.length).toBeGreaterThan(0);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);

    /*let choicesSerialized: Uint8Array[] = [
      Serialization.Serialize(choice),
      Serialization.Serialize(choice2),
    ];
    let myNewVM = VMObject.FromArray(choices);

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
    const vm = VMObject.FromBytes(bytes);

    expect(vm.Type).toBe(VMType.Bool);
    expect(vm.AsBool()).toBe(true);
  });
});

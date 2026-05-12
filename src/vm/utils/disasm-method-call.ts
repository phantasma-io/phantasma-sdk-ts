import { VMObject } from '../vm-object.js';

export class DisasmMethodCall {
  public contractName = '';
  public methodName = '';
  public arguments: VMObject[] = [];

  /** @deprecated Use `contractName` instead. This alias will be removed in v1.0. */
  public get ContractName(): string {
    return this.contractName;
  }

  public set ContractName(value: string) {
    this.contractName = value;
  }

  /** @deprecated Use `methodName` instead. This alias will be removed in v1.0. */
  public get MethodName(): string {
    return this.methodName;
  }

  public set MethodName(value: string) {
    this.methodName = value;
  }

  /** @deprecated Use `arguments` instead. This alias will be removed in v1.0. */
  public get Arguments(): VMObject[] {
    return this.arguments;
  }

  public set Arguments(value: VMObject[]) {
    this.arguments = value;
  }

  public toString(): string {
    const sb = Array<string>();
    sb.push(`${this.contractName}.${this.methodName}(`);
    for (let i = 0; i < this.arguments.length; i++) {
      if (i > 0) {
        sb.push(',');
      }

      const arg = this.arguments[i];
      sb.push(arg.toString());
    }
    sb.push(')');
    return sb.join('');
  }
}

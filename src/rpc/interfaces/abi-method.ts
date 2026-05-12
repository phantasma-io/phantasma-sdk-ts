import { ABIParameter } from './abi-parameter.js';

export interface ABIMethod {
  name: string; //Name of method
  returnType: string;
  parameters: Array<ABIParameter>; //Type of parameters
}

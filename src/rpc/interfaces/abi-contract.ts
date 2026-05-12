import { ABIMethod } from './abi-method.js';

export interface ABIContract {
  name: string; //Name of contract
  methods: Array<ABIMethod>; //List of methods
}

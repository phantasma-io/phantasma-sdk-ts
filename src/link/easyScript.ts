import { ScriptBuilder } from '../vm/index.js';

export enum Nexus {
  Mainnet = 'mainnet',
  Simnet = 'simnet',
  Testnet = 'testnet',
}

export class EasyScript {
  nexus: Nexus;
  sb: ScriptBuilder;

  constructor(nexus: Nexus = Nexus.Mainnet) {
    this.sb = new ScriptBuilder();
    this.nexus = nexus;
  }

  buildScript(_type: string, _options: unknown[] = [null]): string {
    this.sb = new ScriptBuilder();

    switch (_type) {
      case 'interact':
        const contractNameInteract = _options[0] as string;
        const methodNameInteract = _options[1] as string;
        const inputArgumentsInteract = _options[2] as unknown[];

        return this.sb
          .callContract('gas', 'AllowGas', [])
          .callContract(contractNameInteract, methodNameInteract, inputArgumentsInteract) //The Meat of the Script
          .callContract('gas', 'SpendGas', [])
          .endScript();

      case 'invoke':
        const contractNameInvoke = _options[0] as string;
        const methodNameInvoke = _options[1] as string;
        const inputArgumentsInvoke = _options[2] as unknown[];

        return this.sb
          .callContract(contractNameInvoke, methodNameInvoke, inputArgumentsInvoke) //The Meat of the Script
          .endScript();

      case 'interop':
        const interopNameInterop = _options[0] as string;
        const inputArgumentsInterop = _options[1] as unknown[];

        return this.sb
          .callContract('gas', 'AllowGas', [])
          .callInterop(interopNameInterop, inputArgumentsInterop)
          .callContract('gas', 'SpendGas', [])
          .endScript();

      default:
        throw new Error(`Unsupported EasyScript type: ${_type}`);
    }
  }
}

import { PhantasmaLink } from './phantasmaLink.js';
import { ProofOfWork } from './interfaces/ProofOfWork.js';
import { EasyScript, Nexus } from './easyScript.js';
import { TxMsg } from '../types/Carbon/Blockchain/index.js';
import { Transaction } from '../tx/Transaction.js';
import { logger } from '../utils/logger.js';

type EasyCallback = (data?: unknown) => void;
type EasyArguments = unknown[];

export class EasyConnect {
  requiredVersion: number;
  platform: string;
  providerHint: string;
  link: PhantasmaLink;
  connected: boolean;
  script: EasyScript;
  nexus: Nexus | null;

  constructor(_options: string[] | null = null) {
    this.platform = 'phantasma';
    this.providerHint = 'poltergeist';
    this.script = new EasyScript();
    this.link = new PhantasmaLink('easyConnect', false);
    this.connected = false;
    this.requiredVersion = 4;

    this.nexus = null;

    if (_options == null) {
      this.setConfig('auto');
    } else {
      try {
        this.requiredVersion = Number(_options[0]);
        this.platform = _options[1];
        this.providerHint = _options[2];
      } catch (error) {
        logger.log(error);
      }
    }
    this.script = new EasyScript();
  }

  setConfig(_provider: string) {
    this.requiredVersion = 4;
    this.platform = 'phantasma';

    switch (_provider) {
      case 'auto':
        if (typeof window !== 'undefined' && !!window.PhantasmaLinkSocket) {
          this.setConfig('ecto');
        } else {
          this.providerHint = '';
        }
        break;

      case 'ecto':
        this.providerHint = 'ecto';
        break;

      case 'poltergeist':
        this.providerHint = 'poltergeist';
        break;
    }
  }

  connect(
    onSuccess: EasyCallback = () => {},
    onFail: EasyCallback = (data) => {
      logger.log('%cError: ' + data, 'color:red');
    }
  ) {
    this.link.login(
      (data) => {
        //Console Logging for Debugging Purposes
        if (data) {
          this.connected = true;
          this.nexus =
            this.link.nexus === Nexus.Mainnet ||
            this.link.nexus === Nexus.Simnet ||
            this.link.nexus === Nexus.Testnet
              ? (this.link.nexus as Nexus)
              : null;
          onSuccess(data);
          logger.log('%c[EasyConnect Connected]', 'color:green');
          logger.log(
            "Wallet Address '" + this.link.account.address + "' connected via " + this.link.wallet
          );
        } else {
          onFail();
          logger.log('EasyConnect could not connect to wallet');
        }
      },
      onFail,
      this.requiredVersion,
      this.platform,
      this.providerHint
    );
  }

  disconnect(_message: string = 'Graceful Disconect') {
    this.link.disconnect(_message);
    this.connected = false;
    this.nexus = null;
  }

  async query(
    _type: string = null,
    _arguments: string[] | null = null,
    _callback: EasyCallback = (data) => {
      logger.log(data);
    }
  ) {
    void _arguments;
    if (this.connected == true) {
      switch (_type) {
        case 'account':
          const account = this.link.account;
          _callback(account);
          return account;
          break;

        case 'name':
          const name = this.link.account.name;
          _callback(name);
          return name;
          break;

        case 'balances':
          const balances = this.link.account.balances;
          _callback(balances);
          return balances;
          break;

        case 'walletAddress':
          const walletAddress = this.link.account.address;
          _callback(walletAddress);
          return walletAddress;
          break;

        case 'avatar':
          const avatar = this.link.account.avatar;
          _callback(avatar);
          return avatar;
          break;

        case 'tokenBalance':
          //let token = _arguments[0];
          //return this.link.accounts[]
          break;
      }
    } else {
      logger.log('%cWallet is not connected', 'color:red');
    }
  }

  async action(
    _type: string = null,
    _arguments: EasyArguments | null = null,
    onSuccess: EasyCallback = () => {},
    onFail: EasyCallback = (data) => {
      logger.log('%cError: ' + data, 'color:red');
    }
  ) {
    if (this.connected == true) {
      switch (_type) {
        case 'sendFT':
          const sendFTScript = await this.script.buildScript('interop', [
            'Runtime.SendTokens',
            [_arguments[0], _arguments[1], _arguments[2], _arguments[3]],
          ]);
          this.signTransaction(sendFTScript, null, onSuccess, onFail);
          break;

        case 'sendNFT':
          const sendNFTScript = await this.script.buildScript('interop', [
            'Runtime.SendTokens',
            [_arguments[0], _arguments[1], _arguments[2], _arguments[3]],
          ]);
          this.signTransaction(sendNFTScript, null, onSuccess, onFail);
          break;
      }
    } else {
      logger.log('%cWallet is not connected', 'color:red');
    }
  }

  signTransaction(
    script: string,
    payload = null,
    onSuccess: EasyCallback = () => {},
    onFail: EasyCallback = (data) => {
      logger.log('%cError: ' + data, 'color:red');
    }
  ) {
    this.link.signTx(script, payload, onSuccess, onFail);
  }

  signData(
    data: string,
    onSuccess: EasyCallback = () => {},
    onFail: EasyCallback = (data) => {
      logger.log('%cError: ' + data, 'color:red');
    }
  ) {
    this.link.signData(data, onSuccess, onFail);
  }

  signCarbonTransaction(
    txMsg: TxMsg,
    onSuccess: EasyCallback = () => {},
    onFail: EasyCallback = (data) => {
      logger.log('%cError: ' + data, 'color:red');
    }
  ) {
    if (this.connected == true) {
      this.link.signCarbonTxAndBroadcast(txMsg, onSuccess, onFail);
    } else {
      const message = 'Wallet is not connected';
      logger.log('%c' + message, 'color:red');
      onFail(message);
    }
  }

  signPrebuiltTransaction(
    tx: Transaction,
    onSuccess: EasyCallback = () => {},
    onFail: EasyCallback = (data) => {
      logger.log('%cError: ' + data, 'color:red');
    }
  ) {
    if (this.connected == true) {
      this.link.signPrebuiltTransaction(tx, onSuccess, onFail);
    } else {
      const message = 'Wallet is not connected';
      logger.log('%c' + message, 'color:red');
      onFail(message);
    }
  }

  invokeScript(script: string, _callback: EasyCallback) {
    this.link.invokeScript(script, _callback);
  }

  deployContract(
    script: string,
    payload = null,
    proofOfWork: ProofOfWork = ProofOfWork.Minimal,
    onSuccess: EasyCallback = () => {},
    onFail: EasyCallback = (data) => {
      logger.log('%cError: ' + data, 'color:red');
    }
  ) {
    this.link.signTx(script, payload, onSuccess, onFail, proofOfWork);
  }
}

import { Transaction } from '../tx/Transaction.js';
import { ScriptBuilder } from '../vm/index.js';
import { ProofOfWork } from './interfaces/ProofOfWork.js';
import { LinkAccount } from './interfaces/IAccount.js';
import { TxMsg } from '../types/Carbon/Blockchain/index.js';
import { CarbonBlob } from '../types/Carbon/CarbonBlob.js';
import { bytesToHex, hexToBytes } from '../utils/Hex.js';
import { Ed25519Signature, PBinaryReader } from '../types/index.js';
import { logger } from '../utils/logger.js';

export interface PrebuiltTransactionSignResult {
  success: true;
  signature: string;
  signedTx: string;
}

interface PhantasmaLinkSocketLike {
  close(): void;
  send(request: string): void;
  readyState?: number;
  onopen?: ((event: Event) => void) | null;
  onmessage?: ((event: MessageEvent<string>) => void) | null;
  onclose?: ((event: CloseEvent) => void) | null;
  onerror?: ((error: Event) => void) | null;
}

declare global {
  interface Window {
    PhantasmaLinkSocket?: new () => PhantasmaLinkSocketLike;
  }
}

type LinkResponse = Record<string, unknown> & {
  success?: boolean;
  error?: unknown;
  message?: string;
  hash?: string | { error?: string };
  signature?: string;
  token?: unknown;
  wallet?: unknown;
  nexus?: unknown;
};

type LinkCallback = (result: LinkResponse) => void;
type LinkErrorCallback = (message?: string) => void;

const errorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.length > 0
  ) {
    return error.message;
  }
  return fallback;
};

export class PhantasmaLink {
  //Declarations
  host: string;
  dapp: string;
  onLogin: ((success: boolean) => void) | null;
  providerHint: string;
  onError: LinkErrorCallback | null;
  socket: PhantasmaLinkSocketLike | null;
  requestCallback: LinkCallback | null;
  private lastSocketErrorMessage: string | null = null;
  socketTransport: 'websocket' | 'injected' | null = null;
  socketOpen: boolean = false;
  token: unknown;
  requestID: number = 0;
  account: LinkAccount | null;
  wallet: unknown;
  messageLogging: boolean;
  version: number;
  nexus: string;
  chain: string;
  platform: string;

  //Construct The Link
  constructor(dappID: string, logging: boolean = true) {
    this.version = 4;
    this.nexus = '';
    this.chain = 'main';
    this.platform = 'poltergeist';
    this.providerHint = 'poltergeist';

    //Turn On|Off Console Logging
    if (logging == false) {
      this.messageLogging = false;
    } else {
      this.messageLogging = true;
      logger.log('%cPhantasmaLink created', 'color:green');
    }

    this.requestID = 0;
    //Standard Sets
    this.host = 'localhost:7090';
    this.dapp = dappID;
    this.onLogin = () => {}; //Does Nothing for Now
    this.onError = () => {}; //Does Nothing for Now
    this.socket = null;
    this.requestCallback = null;
    this.token = null;
    this.account = null;
    this.wallet = null;
  }

  //Message Logging
  onMessage = (msg: string) => {
    if (this.messageLogging == true) {
      logger.log(msg);
    }
  };

  // Preserve wallet-side failure details whenever the transport provides them.
  private describeFailure(result: unknown, fallback: string): string {
    if (typeof result === 'string' && result.length > 0) {
      return result;
    }

    if (result && typeof result === 'object' && 'error' in result) {
      const error = result.error;
      if (typeof error === 'string' && error.length > 0) {
        return error;
      }
      if (
        error &&
        typeof error === 'object' &&
        'message' in error &&
        typeof error.message === 'string'
      ) {
        return error.message;
      }
    }

    if (
      result &&
      typeof result === 'object' &&
      'message' in result &&
      typeof result.message === 'string' &&
      result.message.length > 0
    ) {
      return result.message;
    }

    return fallback;
  }

  //Connect To Wallet
  login(
    onLoginCallback: (success: boolean) => void,
    onErrorCallback: LinkErrorCallback,
    version: number = 4,
    platform: string = 'phantasma',
    providerHint: string = 'poltergeist'
  ) {
    this.providerHint = providerHint;
    this.onLogin = onLoginCallback;
    this.onError = onErrorCallback;
    this.version = version;
    this.platform = platform;
    this.providerHint = providerHint;
    this.createSocket();
  }

  //Script Invoking With Wallet Connection
  invokeScript(script: string, callback: (message: string | LinkResponse) => void) {
    this.onMessage('Relaying transaction to wallet...');
    if (!this.socket) {
      callback('not logged in');
      return;
    }

    if (script.length >= 8192) {
      callback('Script data is too large');
      return;
    }
    let requestStr = this.chain + '/' + script;
    if (this.version >= 2) {
      requestStr = requestStr;
    } else {
      requestStr = this.nexus + '/' + requestStr;
    }

    const invokeScriptRequest = 'invokeScript/' + requestStr;

    this.sendLinkRequest(invokeScriptRequest, (result) => {
      if (result.success) {
        this.onMessage('Invoke successful, hash: ' + result + '...');
        if (callback) {
          callback(result);
        }
      }
    });
  }

  //Wallet Transaction Signing + Sending
  signTx(
    script: string,
    payload: string | null,
    callback: LinkCallback,
    onErrorCallback: LinkErrorCallback,
    pow = ProofOfWork.None,
    signature = 'Ed25519'
  ) {
    //Overload Protection
    if (script.length >= 65536) {
      this.onMessage('Error: script is too big!');
      if (onErrorCallback) {
        onErrorCallback();
      }
      return;
    }

    //Check Payload
    if (payload == null) {
      payload = '7068616e7461736d612d7473'; //Says 'Phantasma-ts' in hex
    } else if (typeof payload === 'string') {
      //Turn String Payload -> Bytes -> Hex
      const sb = new ScriptBuilder();
      const bytes = sb.rawString(payload);
      sb.appendBytes(bytes);
      payload = sb.endScript();
    } else {
      this.onMessage('Error: Invalid Payload');
      if (onErrorCallback) {
        onErrorCallback();
      }
      return;
    }

    this.onError = onErrorCallback; //Sets Error Callback Function
    let request =
      'signTx/' +
      this.chain +
      '/' +
      script +
      '/' +
      payload +
      '/' +
      signature +
      '/' +
      this.platform +
      '/' +
      pow;

    if (this.version == 1) {
      request = 'signTx/' + this.nexus + '/' + this.chain + '/' + script + '/' + payload;
    }

    // Send the signature request to the connected wallet.
    this.sendLinkRequest(request, (result) => {
      if (result.success) {
        const hash = result.hash;
        if (hash && typeof hash === 'object' && hash.error) {
          this.onMessage('Error: ' + hash.error);
          return;
        }
        const hashText = typeof hash === 'string' ? hash : '';
        this.onMessage('Transaction successful, hash: ' + hashText.substring(0, 15) + '...');
        if (callback) {
          callback(result);
        }
      } else {
        if (onErrorCallback) {
          onErrorCallback();
        }
      }
    });
  }

  // Wallet Transaction Signing
  signCarbonTxAndBroadcast(
    txMsg: TxMsg,
    callback: LinkCallback = () => {},
    onErrorCallback: (message?: string) => void = () => {}
  ) {
    if (!txMsg) {
      const message = 'Error: Invalid Carbon transaction message';
      this.onMessage(message);
      onErrorCallback(message);
      return;
    }

    if (this.version < 4) {
      const message =
        'Carbon transactions require a wallet that supports Phantasma Link v4 or higher. Please reconnect with version 4+.';
      this.onMessage(message);
      if (onErrorCallback) {
        onErrorCallback(message);
      }
      return;
    }

    let txHex: string;
    try {
      txHex = this.serializeCarbonTx(txMsg);
    } catch (err: unknown) {
      const message = 'Error: Unable to serialize Carbon transaction';
      this.onMessage(message + ` (${errorMessage(err, 'unknown error')})`);
      onErrorCallback(message);
      return;
    }

    const txLengthLimit = 65536;
    if (txHex.length >= txLengthLimit) {
      const message = `Error: Carbon transaction message is too big (${txHex.length} > ${txLengthLimit})!`;
      this.onMessage(message);
      onErrorCallback(message);
      return;
    }

    this.onError = onErrorCallback;
    const request = 'signCarbonTxAndBroadcast/' + txHex;

    this.sendLinkRequest(request, (result) => {
      if (result.success) {
        this.onMessage('Carbon transaction signed');
        callback(result);
      } else {
        if (onErrorCallback) {
          onErrorCallback(this.describeFailure(result, 'Carbon transaction signing failed'));
        }
      }
    });
  }

  signTxSignature(
    tx: string,
    callback: LinkCallback,
    onErrorCallback: (message?: string) => void,
    signature: string = 'Ed25519'
  ) {
    if (!this.socket) {
      this.onMessage('not logged in');
      if (onErrorCallback) {
        onErrorCallback('Wallet is not connected');
      }
      return;
    }
    if (tx == null) {
      this.onMessage('Invalid transaction data');
      if (onErrorCallback) {
        onErrorCallback('Invalid transaction data');
      }
      return;
    }

    if (tx.length >= 65536) {
      this.onMessage('Transaction data is too large');
      if (onErrorCallback) {
        onErrorCallback('Transaction data is too big');
      }
      return;
    }

    this.onError = onErrorCallback;
    const signDataStr = 'signTxSignature/' + tx + '/' + signature + '/' + this.platform;

    this.sendLinkRequest(signDataStr, (result) => {
      if (result.success) {
        this.onMessage('Data successfully signed');
        if (callback) {
          callback(result);
        }
      } else {
        if (onErrorCallback) {
          onErrorCallback(this.describeFailure(result, 'Wallet rejected transaction signature'));
        }
      }
    });
  }

  private decodeWalletSignatureBytes(signatureHex: string, signature: string): Uint8Array {
    if (signature !== 'Ed25519') {
      throw new Error(`Unsupported transaction signature type: ${signature}`);
    }

    const reader = new PBinaryReader(hexToBytes(signatureHex));
    const rawSignatureHex = reader.readByteArray();

    if (typeof rawSignatureHex !== 'string' || rawSignatureHex.length === 0) {
      throw new Error('Wallet returned an empty transaction signature');
    }

    return hexToBytes(rawSignatureHex);
  }

  signPrebuiltTransaction(
    tx: Transaction,
    callback: (result: PrebuiltTransactionSignResult) => void,
    onErrorCallback: (message?: string) => void,
    signature: string = 'Ed25519'
  ) {
    if (!tx) {
      const message = 'Error: Invalid transaction';
      this.onMessage(message);
      if (onErrorCallback) {
        onErrorCallback(message);
      }
      return;
    }

    let unsignedTxHex: string;
    try {
      unsignedTxHex = tx.toStringEncoded(false).toUpperCase();
    } catch (err: unknown) {
      const message = 'Error: Unable to encode unsigned transaction';
      this.onMessage(message + ` (${errorMessage(err, 'unknown error')})`);
      if (onErrorCallback) {
        onErrorCallback(message);
      }
      return;
    }

    this.signTxSignature(
      unsignedTxHex,
      (result) => {
        if (
          !result?.success ||
          typeof result.signature !== 'string' ||
          result.signature.length === 0
        ) {
          const failure = this.describeFailure(result, 'Wallet rejected transaction signature');
          if (onErrorCallback) {
            onErrorCallback(failure);
          }
          return;
        }

        try {
          const signedTx = Transaction.fromHex(unsignedTxHex);
          signedTx.signatures = [
            new Ed25519Signature(this.decodeWalletSignatureBytes(result.signature, signature)),
          ];

          if (this.account?.address && !signedTx.verifySignature(this.account.address)) {
            throw new Error(
              'Wallet returned a signature that does not match the connected account'
            );
          }

          callback({
            success: true,
            signature: result.signature,
            signedTx: signedTx.toStringEncoded(true).toUpperCase(),
          });
        } catch (err: unknown) {
          const message = errorMessage(err, 'Unable to assemble signed transaction');
          if (onErrorCallback) {
            onErrorCallback(message);
          }
        }
      },
      (message?: string) => {
        const failure =
          message || this.lastSocketErrorMessage || 'Wallet rejected transaction signature';
        if (onErrorCallback) {
          onErrorCallback(failure);
        }
      },
      signature
    );
  }

  multiSig(
    subject: string,
    callback: LinkCallback,
    onErrorCallback: () => void,
    signature: string = 'Ed25519'
  ) {
    if (!this.socket) {
      this.onMessage('not logged in');
      return;
    }
    if (subject == null) {
      this.onMessage('Invalid multisig subject data');
      return;
    }

    if (subject.length >= 1024) {
      this.onMessage('Multisig subject data is too large');
      if (onErrorCallback) {
        onErrorCallback();
      }
      return;
    }

    const signDataStr = 'multiSig/' + subject + '/' + signature + '/' + this.platform;

    this.sendLinkRequest(signDataStr, (result) => {
      if (result.success) {
        this.onMessage('Data successfully signed');
        if (callback) {
          callback(result);
        }
      } else {
        if (onErrorCallback) {
          onErrorCallback();
        }
      }
    });
  }

  getPeer(callback: (result: string) => void, onErrorCallback: () => void) {
    this.onError = onErrorCallback; //Sets Error Callback Function
    // Send the peer query to the connected wallet.
    this.sendLinkRequest('getPeer/', (result) => {
      if (result.success) {
        this.onMessage('Peer Query,: ' + result);
        if (callback) {
          callback(String(result));
        }
      } else {
        if (onErrorCallback) {
          onErrorCallback();
        }
      }
    });
  }

  fetchWallet(callback?: LinkCallback, onErrorCallback?: LinkErrorCallback) {
    const getAccountRequest = 'getAccount/' + this.platform;
    this.sendLinkRequest(getAccountRequest, (result) => {
      if (result.success) {
        this.account = result as unknown as LinkAccount;
        callback?.(result);
      } else {
        onErrorCallback?.(
          'Could not obtain account info... Make sure you have an account currently open in ' +
            this.wallet +
            '...'
        );
        //that.disconnect("Unable to optain Account Info");
      }

      //that.onLogin(result.success);
      //that.onLogin = null;
    });
  }

  getNexus(callback: LinkCallback, onErrorCallback: LinkErrorCallback) {
    this.onError = onErrorCallback; //Sets Error Callback Function

    // Send the nexus query to the connected wallet.
    this.sendLinkRequest('getNexus/', (result) => {
      if (result.success) {
        if (typeof result.nexus === 'string') {
          this.nexus = result.nexus;
        }
        this.onMessage('Nexus Query,: ' + result);
        if (callback) {
          callback(result);
        }
      } else {
        if (onErrorCallback) {
          onErrorCallback('Error: ' + result.error);
        }
      }
    });
  }

  getWalletVersion(callback: LinkCallback, onErrorCallback: LinkErrorCallback) {
    this.onError = onErrorCallback; //Sets Error Callback Function

    // Send the wallet-version query to the connected wallet.
    this.sendLinkRequest('getWalletVersion/', (result) => {
      if (result.success) {
        this.onMessage('Wallet Version Query,: ' + result);
        if (callback) {
          callback(result);
        }
      } else {
        if (onErrorCallback) {
          onErrorCallback('Error: ' + result.error);
        }
      }
    });
  }

  // Uses the connected wallet to sign Base16-encoded data.
  signData(
    data: string,
    callback: LinkCallback,
    onErrorCallback: (message: string) => void,
    signature: string = 'Ed25519'
  ) {
    if (!this.socket) {
      this.onMessage('not logged in');
      return;
    }
    if (data == null) {
      this.onMessage('Invalid signing data');
      return;
    }

    if (data.length >= 1024) {
      this.onMessage('Signing data is too large');
      if (onErrorCallback) {
        onErrorCallback('Signing data is too large');
      }
      return;
    }

    const signDataStr = 'signData/' + data + '/' + signature + '/' + this.platform;

    this.sendLinkRequest(signDataStr, (result) => {
      if (result.success) {
        this.onMessage('Data successfully signed');
        if (callback) {
          callback(result);
        }
      } else {
        if (onErrorCallback) {
          onErrorCallback(this.describeFailure(result, 'Data signing failed'));
        }
      }
    });
  }

  //Wallet Socket Connection Creation
  createSocket(isResume: boolean = false) {
    const path = 'ws://' + this.host + '/phantasma';
    this.onMessage('Phantasma Link connecting...');

    if (this.socket) {
      this.socket.close();
    }

    const injectedSocket = typeof window !== 'undefined' ? window.PhantasmaLinkSocket : undefined;
    const useInjectedSocket = !!injectedSocket && this.providerHint !== 'poltergeist';
    this.socketTransport = useInjectedSocket ? 'injected' : 'websocket';
    this.socketOpen = false;
    this.onMessage(
      useInjectedSocket
        ? 'Using injected PhantasmaLinkSocket transport'
        : `Using raw WebSocket transport: ${path}`
    );

    const socket: PhantasmaLinkSocketLike =
      useInjectedSocket && injectedSocket ? new injectedSocket() : new WebSocket(path);
    this.socket = socket;

    this.requestCallback = null;
    this.lastSocketErrorMessage = null;
    this.token = null;
    this.account = null;
    this.nexus = '';
    this.requestID = 0;
    const authorizeRequest = 'authorize/' + this.dapp + '/' + this.version;
    const getAccountRequest = 'getAccount/' + this.platform;
    //Once Socket Opened
    socket.onopen = () => {
      this.socketOpen = true;
      this.onMessage('Connection established, authorizing dapp in wallet...');
      if (isResume) {
        this.fetchWallet(undefined, undefined);
      } else {
        this.sendLinkRequest(authorizeRequest, (result) => {
          //Set Global Variables With Successful Account Query
          if (result.success) {
            this.token = result.token;
            this.wallet = result.wallet;
            this.nexus = typeof result.nexus === 'string' ? result.nexus : '';
            this.onMessage('Authorized, obtaining account info...');
            this.sendLinkRequest(getAccountRequest, (result) => {
              if (result.success) {
                this.account = result as unknown as LinkAccount;
              } else {
                this.onError?.(
                  'Could not obtain account info... Make sure you have an account currently open in ' +
                    this.wallet +
                    '...'
                );
                this.disconnect('Unable to optain Account Info');
              }

              this.onLogin?.(result.success === true);
              this.onLogin = null;
            });
          } else {
            this.onError?.(this.describeFailure(result, 'Authorization failed...'));
            this.disconnect('Auth Failure');
          }
        });
      }
    };

    //Retrieves Message From Socket and Processes It
    socket.onmessage = (event) => {
      const obj = JSON.parse(event.data) as LinkResponse;
      if (this.messageLogging == true) {
        logger.log('%c' + event.data, 'color:blue');
      }

      //Checks What To Do Based On Message
      switch (obj.message) {
        case 'Wallet is Closed':
          this.onError?.(
            'Could not obtain account info... Make sure you have an account currently open in ' +
              this.wallet
          );
          this.disconnect(true);
          break;

        case 'not logged in':
          this.onError?.(
            'Could not obtain account info... Make sure you have an account currently logged in'
          );
          this.disconnect(true);
          break;

        case 'A previouus request is still pending':
        case 'A previous request is still pending':
          this.onError?.(this.describeFailure(obj, 'You have a pending action in your wallet'));
          break;

        case 'user rejected':
          this.onError?.('Transaction cancelled by user in ' + this.wallet);
          break;

        default:
          if (obj.message && obj.message.startsWith('nexus mismatch')) {
            this.onError?.(obj.message);
          } else {
            const temp = this.requestCallback;
            if (temp == null) {
              this.onError?.('Something bad happened');
              return;
            }
            this.requestCallback = null;
            temp(obj);
          }
          break;
      }
    };

    //Cleanup After Socket Closes
    socket.onclose = (event) => {
      this.socketOpen = false;
      const reason =
        event.reason && event.reason.length > 0
          ? event.reason
          : this.lastSocketErrorMessage ||
            (event.wasClean ? 'Wallet connection closed' : 'Connection terminated unexpectedly');
      this.lastSocketErrorMessage = null;

      if (this.requestCallback) {
        this.handleSocketFailure(reason);
      } else if (!event.wasClean) {
        this.handleSocketFailure(reason);
      }
    };

    //Error Callback When Socket Has Error
    socket.onerror = (error) => {
      const errMsg = errorMessage(error, 'WebSocket error');
      this.lastSocketErrorMessage = errMsg;
      this.onMessage('Error: ' + errMsg);
    };
  }

  //Message Logging Util
  toggleMessageLogging() {
    if (this.messageLogging == true) {
      this.messageLogging = false;
    } else {
      this.messageLogging = true;
    }
  }

  resume(token: unknown) {
    this.token = token;
    this.retry();
  }

  //Retry Util
  retry() {
    this.createSocket();
  }

  //Get Dapp ID Name Util
  set dappID(dapp: string) {
    this.dapp = dapp;
  }

  get dappID() {
    return this.dapp;
  }

  //Build Request and Send To Wallet Via Socket
  sendLinkRequest(request: string, callback: LinkCallback) {
    this.onMessage('Sending Phantasma Link request: ' + request);

    this.requestCallback = callback;

    const socket = this.socket;
    const openState =
      typeof WebSocket !== 'undefined' && typeof WebSocket.OPEN === 'number' ? WebSocket.OPEN : 1;
    const hasSend = socket && typeof socket.send === 'function';
    const hasReadyState = socket && typeof socket.readyState === 'number';
    const isSocketOpen =
      hasSend && (hasReadyState ? socket.readyState === openState : this.socketOpen);

    if (!socket || !hasSend || !isSocketOpen) {
      this.handleSocketFailure('Wallet connection is closed. Please reconnect to your wallet.');
      return;
    }

    if (this.token != null) {
      request = request + '/' + this.dapp + '/' + this.token;
    }

    this.requestID++; //Object Nonce Increase?
    request = this.requestID + ',' + request;

    try {
      socket.send(request);
    } catch (err: unknown) {
      const errMessage = errorMessage(err, 'Failed to send request to wallet');
      this.handleSocketFailure(errMessage);
    }
  }

  private handleSocketFailure(message: string) {
    const callback = this.requestCallback;
    this.requestCallback = null;
    const errorMessage = message || 'Connection lost with Phantasma Link wallet';
    if (callback) {
      callback({ success: false, error: errorMessage });
      return;
    }

    if (this.onError) {
      this.onError(errorMessage);
    }
  }

  //Disconnect The Wallet Connection Socket
  disconnect(triggered: string | boolean | undefined) {
    this.onMessage('Disconnecting Phantasma Link: ' + triggered);
    this.socketOpen = false;
    if (this.socket) this.socket.close();
  }

  private serializeCarbonTx(txMsg: TxMsg): string {
    const serialized = CarbonBlob.Serialize(txMsg);
    return bytesToHex(serialized);
  }
}

// Phantasma Link v5 - structured error taxonomy (spec §10). Replaces the v1-v4 free-text
// error strings that callers had to substring-match.

/** Numeric error codes. JSON-RPC reserved range + EIP-1193-aligned app codes + Phantasma
 * specific codes. Carried in {@link LinkErrorObject.code}. */
export const LinkErrorCode = {
  // JSON-RPC reserved.
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  // App-level (EIP-1193-aligned where sensible).
  UserRejected: 4001,
  Unauthorized: 4100,
  Disconnected: 4900,
  UnsupportedChain: 4902,
  // Phantasma-specific.
  PayloadTooLarge: 5001,
  NexusMismatch: 5002,
  UnsupportedSignatureKind: 5003,
  CapabilityNotSupported: 5004,
  SessionExpired: 5100,
  SessionRevoked: 5101,
} as const;
export type LinkErrorCode = (typeof LinkErrorCode)[keyof typeof LinkErrorCode];

/** The `error` member of an error response envelope (spec §4). */
export interface LinkErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

/** Error thrown by the v5 client and carried over the wire as {@link LinkErrorObject}.
 * Keeping a dedicated class lets callers branch on the numeric `code` instead of parsing
 * message text. */
export class LinkError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'LinkError';
    this.code = code;
    this.data = data;
    // Preserve `instanceof LinkError` across the transpiled-to-ES2020 target.
    Object.setPrototypeOf(this, LinkError.prototype);
  }

  toObject(): LinkErrorObject {
    // `data` is omitted entirely when undefined so the serialized shape stays minimal.
    return this.data === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, data: this.data };
  }

  /** Reconstruct a {@link LinkError} from a received error object, tolerating malformed
   * inputs (a peer may send a non-conforming shape). */
  static fromObject(obj: unknown): LinkError {
    if (obj && typeof obj === 'object') {
      const record = obj as Record<string, unknown>;
      const code = typeof record.code === 'number' ? record.code : LinkErrorCode.InternalError;
      const message =
        typeof record.message === 'string' && record.message.length > 0
          ? record.message
          : 'Phantasma Link error';
      return new LinkError(code, message, record.data);
    }
    return new LinkError(LinkErrorCode.InternalError, 'Phantasma Link error');
  }
}

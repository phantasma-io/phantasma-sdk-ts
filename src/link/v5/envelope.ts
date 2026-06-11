// Phantasma Link v5 - message envelope (spec §4). A JSON-RPC-2.0 profile that replaces the
// v1-v4 delimiter-joined string: typed named params, numeric error codes, and request
// correlation by `id`. One logical message = one envelope.

import { PLV } from './protocol.js';
import { LinkError, LinkErrorCode, LinkErrorObject } from './errors.js';

/** Request: dApp -> wallet. `session` is omitted only on the first `pha_connect`. */
export interface LinkRequest {
  plv: typeof PLV;
  id: string;
  session?: string;
  method: string;
  params?: Record<string, unknown>;
}

/** Success response: wallet -> dApp. */
export interface LinkSuccessResponse {
  plv: typeof PLV;
  id: string;
  result: unknown;
}

/** Error response: wallet -> dApp. */
export interface LinkErrorResponse {
  plv: typeof PLV;
  id: string;
  error: LinkErrorObject;
}

export type LinkResponse = LinkSuccessResponse | LinkErrorResponse;

/** Event: wallet -> dApp, no reply expected (spec §9.5; persistent transports only). */
export interface LinkEventMessage {
  plv: typeof PLV;
  type: 'event';
  session?: string;
  event: string;
  data?: unknown;
}

export type LinkMessage = LinkRequest | LinkResponse | LinkEventMessage;

export function isLinkRequest(msg: LinkMessage): msg is LinkRequest {
  return 'method' in msg && typeof (msg as LinkRequest).method === 'string';
}

export function isLinkEvent(msg: LinkMessage): msg is LinkEventMessage {
  return (msg as LinkEventMessage).type === 'event';
}

export function isLinkErrorResponse(msg: LinkMessage): msg is LinkErrorResponse {
  return 'error' in msg && !!(msg as LinkErrorResponse).error;
}

export function isLinkSuccessResponse(msg: LinkMessage): msg is LinkSuccessResponse {
  return 'result' in msg;
}

/** Serialize an envelope to its on-the-wire JSON text. */
export function encodeEnvelope(message: LinkMessage): string {
  return JSON.stringify(message);
}

/**
 * Parse and validate an on-the-wire JSON text into a {@link LinkMessage}.
 *
 * Throws {@link LinkError} with `ParseError` for non-JSON and `InvalidRequest` for a JSON
 * value that is not a well-formed v5 envelope (wrong `plv`, missing `id`, or a shape that
 * is neither request, response, nor event). Validation happens here, once, so every
 * downstream consumer can trust the structure.
 */
export function decodeEnvelope(text: string): LinkMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LinkError(LinkErrorCode.ParseError, 'Phantasma Link message is not valid JSON');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new LinkError(LinkErrorCode.InvalidRequest, 'Phantasma Link message must be an object');
  }

  const record = parsed as Record<string, unknown>;
  if (record.plv !== PLV) {
    throw new LinkError(
      LinkErrorCode.InvalidRequest,
      `Unsupported Phantasma Link protocol version: ${String(record.plv)}`
    );
  }

  // Event messages have no `id` and are matched by the `type` discriminator first.
  if (record.type === 'event') {
    if (typeof record.event !== 'string') {
      throw new LinkError(LinkErrorCode.InvalidRequest, 'Event envelope is missing `event`');
    }
    return parsed as LinkEventMessage;
  }

  if (typeof record.id !== 'string' || record.id.length === 0) {
    throw new LinkError(LinkErrorCode.InvalidRequest, 'Envelope is missing a string `id`');
  }

  if (typeof record.method === 'string') {
    return parsed as LinkRequest;
  }
  if ('result' in record) {
    return parsed as LinkSuccessResponse;
  }
  if (record.error && typeof record.error === 'object') {
    return parsed as LinkErrorResponse;
  }

  throw new LinkError(
    LinkErrorCode.InvalidRequest,
    'Envelope is neither a request, response, nor event'
  );
}

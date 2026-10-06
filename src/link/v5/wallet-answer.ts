// Phantasma Link v5 - which errors came in an answer from the wallet. Every answer is activity of
// the session (spec §7), an error answer too, while an error the client reports itself (spec §10:
// 4900, 5005, 5001) is no answer. A wallet can answer with the same codes (4900 while it is
// locked), so the session layer marks the errors it reads from an answer. Internal: the package
// does not export this module.

import { LinkError } from './errors.js';

const answers = new WeakSet<LinkError>();

/** Returns the error of a wallet's error answer, marked as one. */
export function walletAnswerError(error: unknown): LinkError {
  const answer = LinkError.fromObject(error);
  answers.add(answer);
  return answer;
}

/** True when `error` came in an answer from the wallet. */
export function isWalletAnswer(error: unknown): boolean {
  return error instanceof LinkError && answers.has(error);
}

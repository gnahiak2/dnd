import type { ErrorCode } from "@lanternkeep/protocol";

/** A refusal the sender should see, as opposed to a bug. */
export class CommandError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CommandError";
  }
}

export const HTTP_STATUS: Record<ErrorCode, number> = {
  invalid: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
};

export const AI_BRIDGE_ERROR_STATUS = {
  assistant_disabled: 503,
  assistant_unavailable: 503,
  service_token_missing: 401,
  service_token_invalid: 401,
  user_token_missing: 401,
  user_token_expired: 401,
  user_token_invalid: 401,
  user_id_not_allowed: 400,
  invalid_request: 400,
  too_many_page_ids: 400,
  page_not_found: 404,
  space_not_found: 404,
  attachment_not_found: 404,
  proposal_not_found: 404,
  proposal_not_open: 409,
  run_in_progress: 409,
  page_not_editable: 403,
} as const;

export type AiBridgeErrorCode = keyof typeof AI_BRIDGE_ERROR_STATUS;

export class AiBridgeError extends Error {
  constructor(
    readonly code: AiBridgeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AiBridgeError';
  }

  get status(): number {
    return AI_BRIDGE_ERROR_STATUS[this.code];
  }
}

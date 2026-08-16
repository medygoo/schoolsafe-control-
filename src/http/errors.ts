export type ControlAppErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_INVALID"
  | "PERMISSION_DENIED"
  | "VALIDATION_INVALID"
  | "NOT_FOUND"
  | "INSTANCE_BLOCKED"
  | "DEPENDENCY_UNAVAILABLE"
  | "INTERNAL_ERROR";

export type ApiErrorBody = {
  code: ControlAppErrorCode;
  message: string;
  request_id: string;
  retryable: boolean;
};

export class ControlAppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ControlAppErrorCode,
    public readonly publicMessage: string,
    public readonly retryable: boolean
  ) {
    super(publicMessage);
    this.name = "ControlAppError";
  }
}

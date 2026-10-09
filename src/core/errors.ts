export type ErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'INSUFFICIENT_STOCK'
  | 'SETUP_INCOMPLETE'
  | 'LOCKED'
  | 'BACKUP'
  | 'INTERNAL';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const fail = (code: ErrorCode, message: string, details?: unknown): never => {
  throw new AppError(code, message, details);
};

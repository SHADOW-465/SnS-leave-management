export class DomainError extends Error {
  readonly code: string;
  readonly details: { path: string; message: string }[];
  readonly httpStatus: number;

  constructor(
    code: string,
    message: string,
    options?: {
      details?: { path: string; message: string }[];
      httpStatus?: number;
    },
  ) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = options?.details ?? [];
    this.httpStatus = options?.httpStatus ?? 400;
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'You do not have permission to view this.') {
    super('FORBIDDEN', message, { httpStatus: 403 });
    this.name = 'ForbiddenError';
  }
}

export class NotAuthenticatedError extends DomainError {
  constructor(message = 'Sign in required.') {
    super('UNAUTHENTICATED', message, { httpStatus: 401 });
    this.name = 'NotAuthenticatedError';
  }
}

export class ConflictError extends DomainError {
  constructor(code: string, message: string) {
    super(code, message, { httpStatus: 409 });
    this.name = 'ConflictError';
  }
}

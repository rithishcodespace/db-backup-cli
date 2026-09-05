export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly issues?: any[];

  constructor(message: string, statusCode = 500, isOperational = true, issues?: any[]) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.issues = issues;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad Request', issues?: any[]) {
    super(message, 400, true, issues);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation Error', issues?: any[]) {
    super(message, 400, true, issues);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, true);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, true);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource Not Found') {
    super(message, 404, true);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource Conflict') {
    super(message, 409, true);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too Many Requests') {
    super(message, 429, true);
  }
}

export class InternalServerError extends AppError {
  constructor(message = 'Internal Server Error') {
    super(message, 500, true);
  }
}

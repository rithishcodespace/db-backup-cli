import { Request, Response, NextFunction } from 'express';
import * as v from 'valibot';
import { createModuleLogger } from '../logger';

const log = createModuleLogger('request-validator');

export type SchemaType = Parameters<typeof v.safeParse>[0];

export interface ValidationTarget {
  body?: SchemaType;
  query?: SchemaType;
  params?: SchemaType;
  headers?: SchemaType;
}

export interface ValidationErrorItem {
  field: string;
  message: string;
  expected?: string;
  received?: string;
}

export interface ValidationErrorResponse {
  success: false;
  error: string;
  message: string;
  issues: ValidationErrorItem[];
}

/**
 * Formats Valibot issues into consistent, readable error objects
 */
function formatIssues(issues: any): ValidationErrorItem[] {
  if (!issues || !Array.isArray(issues)) {
    return [{ field: 'root', message: 'Validation failed' }];
  }

  return issues.map((issue) => {
    let field = 'root';
    if (issue.path && Array.isArray(issue.path) && issue.path.length > 0) {
      field = issue.path
        .map((item: any) => (typeof item === 'object' && item !== null && 'key' in item ? String(item.key) : String(item)))
        .join('.');
    }

    return {
      field,
      message: issue.message,
      expected: issue.expected,
      received: issue.received,
    };
  });
}

/**
 * Universal validation middleware for Express routes.
 * Validates req.body, req.query, req.params, and/or req.headers against Valibot schemas.
 * If validation fails, responds with 400 Bad Request and structured issue list.
 * If validation passes, sanitized/transformed outputs are applied to the request object.
 */
export function validateRequest(schemas: ValidationTarget) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const allIssues: ValidationErrorItem[] = [];

    if (schemas.body) {
      const result = v.safeParse(schemas.body, req.body);
      if (!result.success) {
        allIssues.push(...formatIssues(result.issues));
      } else {
        req.body = result.output;
      }
    }

    if (schemas.query) {
      const result = v.safeParse(schemas.query, req.query);
      if (!result.success) {
        allIssues.push(...formatIssues(result.issues));
      } else {
        Object.assign(req.query, result.output);
      }
    }

    if (schemas.params) {
      const result = v.safeParse(schemas.params, req.params);
      if (!result.success) {
        allIssues.push(...formatIssues(result.issues));
      } else {
        Object.assign(req.params, result.output);
      }
    }

    if (schemas.headers) {
      const result = v.safeParse(schemas.headers, req.headers);
      if (!result.success) {
        allIssues.push(...formatIssues(result.issues));
      }
    }

    if (allIssues.length > 0) {
      log.warn('Request validation failed', {
        path: req.originalUrl || req.url,
        method: req.method,
        issues: allIssues,
      });

      res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: `Validation failed: ${allIssues.map((i) => `${i.field}: ${i.message}`).join('; ')}`,
        issues: allIssues,
      });
      return;
    }

    next();
  };
}

/**
 * Convenience helper to validate request body
 */
export const validateBody = (schema: SchemaType) => validateRequest({ body: schema });

/**
 * Convenience helper to validate query parameters
 */
export const validateQuery = (schema: SchemaType) => validateRequest({ query: schema });

/**
 * Convenience helper to validate route parameters (:id, etc.)
 */
export const validateParams = (schema: SchemaType) => validateRequest({ params: schema });

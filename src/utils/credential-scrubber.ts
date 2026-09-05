/**
 * Utility to scrub sensitive credentials, passwords, tokens, and connection strings
 * from error messages, logs, and payload responses.
 */

// Regex patterns to match credentials
const URI_CREDENTIALS_REGEX = /([a-zA-Z0-9_+.-]+:\/\/)([^:@\s]+):([^@\s]+)@/g;
const KEY_VALUE_PASSWORD_REGEX = /(password|passwd|pwd|secret|secretkey|token|auth|apikey|accesskey)\s*([:=])\s*([^\s,;]+)/gi;
const SLACK_WEBHOOK_REGEX = /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+/g;
const HEX_KEY_REGEX = /\b[0-9a-fA-F]{64}\b/g;

/**
 * Strips secrets, passwords, connection string credentials, and webhooks from a string
 */
export function sanitizeErrorMessage(message: string | null | undefined): string {
  if (!message) return '';

  let sanitized = String(message);

  // Mask user:pass in URIs
  sanitized = sanitized.replace(URI_CREDENTIALS_REGEX, '$1$2:***@');

  // Mask Slack webhook URLs
  sanitized = sanitized.replace(SLACK_WEBHOOK_REGEX, 'https://hooks.slack.com/services/***');

  // Mask key-value password assignments
  sanitized = sanitized.replace(KEY_VALUE_PASSWORD_REGEX, '$1$2***');

  // Mask 64-character hex encryption keys
  sanitized = sanitized.replace(HEX_KEY_REGEX, '***[64-hex-key-redacted]***');

  return sanitized;
}

/**
 * Deeply sanitizes sensitive fields in an object (for logging or responses)
 */
export function sanitizeObject<T>(input: T): T {
  if (input === null || input === undefined) return input;
  if (typeof input !== 'object') return input;

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeObject(item)) as unknown as T;
  }

  const SENSITIVE_KEYS = new Set([
    'password',
    'secret',
    'secretkey',
    'accesskey',
    'token',
    'webhook',
    'webhookurl',
    'encryptionkey',
    'apikey',
    'pgpassword',
  ]);

  const output: Record<string, any> = {};

  for (const [key, value] of Object.entries(input as Record<string, any>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      output[key] = '***';
    } else if (typeof value === 'string') {
      output[key] = sanitizeErrorMessage(value);
    } else if (typeof value === 'object') {
      output[key] = sanitizeObject(value);
    } else {
      output[key] = value;
    }
  }

  return output as T;
}

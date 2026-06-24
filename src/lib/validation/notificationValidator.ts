export interface ValidationResult {
  valid: boolean;
  errors: string[];
  sanitized: Record<string, any>;
}

/**
 * Validates a notification payload.
 * Mirrors the validation logic used in `server.js` but is exported for unit testing.
 */
export function validateNotification(payload: Record<string, any>): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    sanitized: { ...payload },
  };

  // ----- UUID fields ----- (null‑ify invalid or missing values)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!payload.related_evaluation_id || !uuidRegex.test(payload.related_evaluation_id)) {
    result.sanitized.related_evaluation_id = null;
  }
  if (!payload.related_task_id || !uuidRegex.test(payload.related_task_id)) {
    result.sanitized.related_task_id = null;
  }

  // ----- Message sanitization -----
  if (typeof payload.message === 'string') {
    result.sanitized.message = payload.message.replace(/[\r\n]+/g, ' ');
  }

  // ----- Required fields check -----
  const required = {
    notification_type: result.sanitized.notification_type,
    title: result.sanitized.title,
    message: result.sanitized.message,
    priority: result.sanitized.priority,
    sender_id: result.sanitized.sender_id,
    sender_name: result.sanitized.sender_name,
    recipient_id: result.sanitized.recipient_id,
  };
  const missing = Object.entries(required).filter(([, v]) => v === undefined || v === null || v === '');
  if (missing.length) {
    result.valid = false;
    result.errors.push(`Missing fields: ${missing.map(([k]) => k).join(', ')}`);
  }

  // ----- Priority validation -----
  const allowedPriorities = ['low', 'medium', 'high'];
  if (result.sanitized.priority && !allowedPriorities.includes(result.sanitized.priority)) {
    result.valid = false;
    result.errors.push(`Invalid priority: ${result.sanitized.priority}`);
  }

  return result;
}
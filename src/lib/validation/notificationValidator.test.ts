import { describe, test, expect } from 'vitest';
import { validateNotification } from './notificationValidator';

describe('Notification validation logic', () => {
  const basePayload = {
    notification_type: 'task_updated',
    title: '테스트 알림',
    message: '줄바꿈\n있음',
    priority: 'high',
    sender_id: 'H1234567',
    sender_name: '관리자',
    recipient_id: 'H7654321',
    related_evaluation_id: '019c5a66-b5c8-43c6-8480-292ad762a0b6',
    related_task_id: '019c5a66-b5c8-43c6-8480-292ad762a0b6',
  };

  test('valid payload passes', () => {
    const { valid, errors, sanitized } = validateNotification({ ...basePayload });
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
    expect(sanitized.message).toBe('줄바꿈 있음');
  });

  test('missing required fields returns error', () => {
    const { valid, errors } = validateNotification({
      ...basePayload,
      title: '',
    });
    expect(valid).toBe(false);
    expect(errors[0]).toMatch(/Missing fields: title/);
  });

  test('invalid priority is rejected', () => {
    const { valid, errors } = validateNotification({
      ...basePayload,
      priority: 'urgent',
    });
    expect(valid).toBe(false);
    expect(errors[0]).toMatch(/Invalid priority/);
  });

  test('invalid related UUIDs are null‑ified but validation still passes', () => {
    const { valid, errors, sanitized } = validateNotification({
      ...basePayload,
      related_evaluation_id: 'not-a-uuid',
      related_task_id: '',
    });
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
    expect(sanitized.related_evaluation_id).toBeNull();
    expect(sanitized.related_task_id).toBeNull();
  });
});
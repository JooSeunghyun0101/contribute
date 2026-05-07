// Manual verification script for feedbackService.updateTaskEvaluation
// This file is NOT a Jest test. It can be executed directly with ts-node or compiled to JavaScript
// to visually confirm that the payload sent to taskService.updateTask is correctly transformed
// to snake_case fields.
//
// Usage (example):
//   npx ts-node src/lib/services/feedbackService.test.ts
//
// The script overrides taskService.updateTask with a mock implementation that logs the
// received arguments, then calls feedbackService.updateTaskEvaluation with a sample payload.
//
// If the console output shows the expected snake_case keys, the implementation is correct.

import { feedbackService } from './feedbackService';
import { taskService } from './taskService';

// Save original method to restore later if needed
const originalUpdateTask = taskService.updateTask;

// Mock implementation that logs the call
(taskService as any).updateTask = async (taskId: number, payload: any) => {
  console.log('🔎 Mock taskService.updateTask called with:');
  console.log('taskId =', taskId);
  console.log('payload =', payload);
  // Simulate successful API response
  return { success: true };
};

(async () => {
  const mockTaskId = '123';
  const evaluationPayload = {
    contributionMethod: 'Method A',
    contributionScope: 'Scope B',
    score: 85,
    feedback: 'Great work',
    feedbackDate: '2025-11-24',
    evaluatorName: '홍길동',
  };

  console.log('🚀 Running manual test for feedbackService.updateTaskEvaluation...');
  await feedbackService.updateTaskEvaluation(mockTaskId, evaluationPayload);
  console.log('✅ Manual test completed.');
})()
  .catch((err) => {
    console.error('❌ Manual test failed:', err);
  })
  .finally(() => {
    // Restore original method
    (taskService as any).updateTask = originalUpdateTask;
  });
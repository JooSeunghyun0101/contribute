import { taskService } from './taskService';
import { taskApiService } from './taskApiService';

// Simple mock implementation without Jest
const mockCalls: string[] = [];

// Replace the real softDeleteTask with a mock that records the call
const originalSoftDelete = taskApiService.softDeleteTask;
taskApiService.softDeleteTask = async (id: string) => {
  mockCalls.push(id);
  // Simulate async behavior
  return Promise.resolve();
};

async function runTest() {
  const testId = 'test-task-123';
  await taskService.softDeleteTask(testId);

  // Verify that the mock was called with the correct ID
  console.assert(
    mockCalls.length === 1 && mockCalls[0] === testId,
    `Expected softDeleteTask to be called once with id "${testId}", but got ${JSON.stringify(mockCalls)}`
  );

  if (mockCalls.length === 1 && mockCalls[0] === testId) {
    console.log('✅ taskService.softDeleteTask test passed');
  } else {
    console.error('❌ taskService.softDeleteTask test failed');
    process.exit(1);
  }

  // Restore original implementation
  taskApiService.softDeleteTask = originalSoftDelete;
}

// Execute the test when the file is run directly
if (require.main === module) {
  runTest().catch(err => {
    console.error('❌ taskService.softDeleteTask test threw an error:', err);
    process.exit(1);
  });
}
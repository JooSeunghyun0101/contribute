import { taskApiService } from './taskApiService';

// Simple mock for fetch without Jest
const mockCalls: { url: string; options: any }[] = [];

// Save original global fetch
const originalFetch = global.fetch;

// Override global fetch with mock that records the call
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).fetch = (url: string, options?: any) => {
  mockCalls.push({ url, options });
  return Promise.resolve({
    ok: true,
    json: async () => ({}),
  } as any);
};

async function runTest() {
  const testId = 'test-task-456';
  // Call the softDeleteTask method
  await taskApiService.softDeleteTask(testId);
  // Find the recorded call
  const call = mockCalls.find(c => c.url === `/api/task/${testId}`);

  console.assert(
    call !== undefined &&
      call.options?.method === 'PATCH' &&
      typeof call.options?.body === 'string' &&
      call.options.body.includes('deleted_at'),
    `Expected PATCH request with deleted_at for /api/task/${testId}, got ${JSON.stringify(call)}`
  );

  if (call && call.options?.method === 'PATCH' && typeof call.options?.body === 'string' && call.options.body.includes('deleted_at')) {
    console.log('✅ taskApiService.softDeleteTask test passed');
  } else {
    console.error('❌ taskApiService.softDeleteTask test failed');
    process.exit(1);
  }

  // Restore original fetch
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).fetch = originalFetch;
}

// Execute the test when the file is run directly
if (require.main === module) {
  runTest().catch(err => {
    console.error('❌ taskApiService.softDeleteTask test threw an error:', err);
    process.exit(1);
  });
}
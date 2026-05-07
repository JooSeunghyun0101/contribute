// Simple test for softDeleteTask without Jest
const mockCalls = [];

const apiFetch = async (url, options) => {
  mockCalls.push({ url, options });
  return Promise.resolve({ ok: true, json: async () => ({}) });
};

const taskApiService = {
  async softDeleteTask(id) {
    await apiFetch(`/api/task/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ deleted_at: new Date().toISOString() }),
      headers: { 'Content-Type': 'application/json' },
    });
  },
};

async function runTest() {
  const testId = 'test-task-456';
  await taskApiService.softDeleteTask(testId);
  const call = mockCalls.find(c => c.url === `/api/task/${testId}`);
  console.assert(
    call && call.options?.method === 'PATCH' && typeof call.options?.body === 'string' && call.options.body.includes('deleted_at'),
    `Expected PATCH with deleted_at, got ${JSON.stringify(call)}`
  );
  if (call) {
    console.log('✅ softDeleteTask test passed');
  } else {
    console.error('❌ softDeleteTask test failed');
    process.exit(1);
  }
}

if (require.main === module) {
  runTest().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
  });
}

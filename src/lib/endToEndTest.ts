/**
 * End-to-end test script to verify frontend‑backend‑database connectivity.
 * Run with: `node src/lib/endToEndTest.ts`
 *
 * It performs a simple GET request to the /api/employees endpoint.
 * The backend should respond with a JSON array of employee objects.
 */

const baseUrl = process.env.VITE_API_BASE ?? 'http://localhost:4000';

async function main() {
  try {
    const response = await fetch(`${baseUrl}/api/employees`, {
      credentials: 'include',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Request failed: ${response.status} ${text}`);
    }

    const data = await response.json();
    console.log('✅ Employees fetched successfully:');
    console.dir(data, { depth: null });
  } catch (err) {
    console.error('❌ End‑to‑end test failed:', err);
    process.exit(1);
  }
}

main();
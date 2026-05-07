/**
 * Simple test script to verify that the application can communicate with the GPT‑OSS service.
 * It uses the existing `testGeminiConnection` helper (which internally calls `callGptOss`)
 * and prints the result to the console.
 *
 * Run with:
 *   ts-node src/lib/gptOssCommunicationTest.ts
 *
 * If the script reports a success, the GPT‑OSS endpoint, request format
 * and any required authentication are correct. Otherwise, the error output
 * will help identify what needs to be adjusted (e.g., URL, headers, model name).
 */

import { testGeminiConnection } from '@/lib/gptOss';

async function run() {
  try {
    const result = await testGeminiConnection();
    console.log('✅ GPT‑OSS 연결 성공. 응답 내용:', result);
  } catch (err) {
    console.error('❌ GPT‑OSS 연결 실패:', err);
  }
}

run();
import { defineConfig } from 'vitest/config';
import path from 'path';

// 단위 테스트 전용 설정(빌드용 vite.config.ts 와 분리). 로직 테스트라 node 환경.
// 기존 코드가 bare describe/test/expect 전역을 쓰므로 globals: true.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});

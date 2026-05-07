import { pool } from '@/lib/database';

export const testSupabaseConnection = async () => {
  try {
    console.log('🧪 PostgreSQL 연결 테스트 시작...');

    // In mock environment `pool.connect` may be undefined; fall back to using `pool` directly.
    const client: any =
      typeof (pool as any).connect === 'function' ? await (pool as any).connect() : pool;

    const { rows } = await client.query('SELECT NOW()');
    // `rows[0]` may be undefined in mock mode; provide a placeholder.
    const now = rows?.[0]?.now ?? 'mock-time';
    console.log('✅ PostgreSQL 연결 성공! 서버 시간:', now);

    // Release the client if the mock provides a release method.
    if (client?.release) {
      client.release();
    }

    return true;
  } catch (err) {
    console.error('❌ PostgreSQL 연결 실패:', err);
    return false;
  }
};

export default testSupabaseConnection;

// 브라우저 콘솔에서 직접 호출할 수 있도록 window 객체에 추가
if (typeof window !== 'undefined') {
  (window as any).testSupabaseConnection = testSupabaseConnection;
}
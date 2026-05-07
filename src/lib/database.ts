/**
 * Database connection module.
 * Provides a real PostgreSQL pool on the server side and a mock pool on the client side
 * to avoid bundling the `pg` package and referencing `process` in the browser.
 */

let pool: any;

// Server-side setup
if (typeof window === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pg = require('pg');
  const { Pool: PgPool } = pg;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('❌ DATABASE_URL is not defined in .env');
    // In a server environment we can safely exit
    process.exit(1);
  }

  pool = new PgPool({ connectionString });

  // Test connection once at startup
  pool
    .query('SELECT 1')
    .then(() => console.log('✅ PostgreSQL 연결 성공'))
    .catch((err: any) => {
      console.error('❌ PostgreSQL 연결 실패', err);
      process.exit(1);
    });
} else {
  // Client-side mock to satisfy imports without real DB access
  class MockPool {
    query() {
      return Promise.resolve({ rows: [] });
    }
  }
  pool = new MockPool();
}

// Re-export service modules for compatibility with existing import paths
export { employeeService } from './services/employeeService';
export { evaluationService } from './services/evaluationApiService';
export { taskApiService as taskService } from './services/taskApiService';
export { feedbackApiService as feedbackService } from './services/feedbackApiService';
export { notificationService } from './services/notificationApiService';
export { settingService } from './services/settingService';
export { pool };
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ---------- 1️⃣ .env 로드 (dotenv 없이 직접 파싱) ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../../.env');

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const [key, ...rest] = trimmed.split('=');
    process.env[key] = rest.join('=');
  });
}

// ---------- 2️⃣ Pool 생성 ----------
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('❌ DATABASE_URL이 .env에 정의되지 않았습니다.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
});

// ---------- 3️⃣ 테스트 쿼리 실행 ----------
async function runTest() {
  try {
    const { rows } = await pool.query('SELECT NOW() AS now');
    console.log('✅ PostgreSQL 연결 성공! 현재 시각:', rows[0].now);
  } catch (err) {
    console.error('❌ PostgreSQL 연결 실패:', err.message);
  } finally {
    await pool.end();
  }
}

runTest();
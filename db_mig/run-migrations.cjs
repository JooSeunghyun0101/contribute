#!/usr/bin/env node
/**
 * 멱등 마이그레이션 러너 — db_mig/*.sql 를 파일명 정렬 순서로 적용하고 schema_migrations 에 기록한다.
 * 이미 적용된 파일은 건너뛴다. (README 의 "수작업 psql 적용"을 대체하는 안전 도구)
 *
 * 사용:
 *   node db_mig/run-migrations.cjs --baseline           # 현재 *.sql 전부 '적용됨'으로 표시(미실행).
 *                                                        #   기존 DB(이미 수작업 적용함)에서 최초 1회 실행.
 *   node db_mig/run-migrations.cjs --dry-run            # 적용 대상 목록만 출력.
 *   node db_mig/run-migrations.cjs                       # 미적용 .sql 적용. 파괴적(DROP TABLE)이면 거부.
 *   node db_mig/run-migrations.cjs --allow-destructive   # 파괴적 포함 적용(신규 빈 DB 등 — 데이터 소실 주의).
 *
 * DATABASE_URL 은 환경변수 또는 프로젝트 루트 .env 에서 읽는다.
 * 각 마이그레이션은 단일 트랜잭션(BEGIN/COMMIT, 실패 시 ROLLBACK)으로 적용된다.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DIR = __dirname;
const args = new Set(process.argv.slice(2));
const BASELINE = args.has('--baseline');
const DRY = args.has('--dry-run');
const ALLOW_DESTRUCTIVE = args.has('--allow-destructive');

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.join(DIR, '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, '');
    }
  }
  return null;
}

async function main() {
  const url = loadDatabaseUrl();
  if (!url) {
    console.error('DATABASE_URL 이 설정되어 있지 않습니다(.env 또는 환경변수).');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         filename text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const applied = new Set(
      (await pool.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename),
    );
    const files = fs
      .readdirSync(DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const pending = files.filter((f) => !applied.has(f));

    if (BASELINE) {
      for (const f of pending) {
        await pool.query('INSERT INTO schema_migrations(filename) VALUES($1) ON CONFLICT DO NOTHING', [f]);
      }
      console.log(`baseline: ${pending.length}개 파일을 '적용됨'으로 표시했습니다(실행하지 않음).`);
      return;
    }

    if (pending.length === 0) {
      console.log('적용할 마이그레이션이 없습니다.');
      return;
    }
    console.log(`미적용 ${pending.length}건: ${pending.join(', ')}`);
    if (DRY) return;

    for (const f of pending) {
      const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
      if (/\bDROP\s+TABLE\b/i.test(sql) && !ALLOW_DESTRUCTIVE) {
        console.error(`거부: ${f} 에 DROP TABLE 이 포함됨. 의도적이면 --allow-destructive 로 실행하세요.`);
        process.exit(2);
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(filename) VALUES($1)', [f]);
        await client.query('COMMIT');
        console.log(`적용: ${f}`);
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`실패(중단): ${f} — ${e.message}`);
        process.exit(3);
      } finally {
        client.release();
      }
    }
    console.log('완료.');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

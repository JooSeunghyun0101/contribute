/**
 * load_real_2025_2026.cjs
 *
 * 실데이터 적재 — 샘플 전면 삭제 후 25/26년 기여도 실데이터로 employees·evaluations·tasks 재구축.
 *
 * 입력(고정 경로):
 *   - 25년 기여도 평가.xlsx        (task 단위, 점수 채워짐)
 *   - 26년 기여도 _ 260610.xlsx    (task 단위, 진행중·미채점)
 *   - 25년 종합평가 결과.xlsx      (1인1행, 성장레벨·부서)
 *
 * 확정 규칙:
 *   - 사번 = 알파벳 제외 숫자만(충돌 7쌍은 숫자로 병합, 로그).
 *   - 평가기준명에 'PL' 포함 행 전부 제외.
 *   - 2025 피평가자 = 기여도(PL제외) ∩ 종합마스터 (퇴사/휴직 88명 자동 제외). 성장레벨·부서=마스터.
 *   - 2026 피평가자 = 기여도 전체. 성장레벨=자체 Lv, 부서=자체 부서명.
 *   - 과업 = 엑셀 "행"(가중치합=100/소속). 점수=파일 평가점수(=실매트릭스). 비표준/미채점=score null.
 *   - 발령 = (피평가자×기간×소속)당 evaluation + assignment_history 1건.
 *   - admin 계정 보존. HR 9명(아래) available_roles 에 'hr'.
 *
 * 실행:
 *   DATABASE_URL=... node db_mig/load_real_2025_2026.cjs            # DRY_RUN (롤백)
 *   LOAD_COMMIT=1 DATABASE_URL=... node db_mig/load_real_2025_2026.cjs   # 실제 적용
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { Pool } = require('pg');

const CONN = process.env.DATABASE_URL;
if (!CONN) { console.error('DATABASE_URL 필요'); process.exit(1); }
const DRY_RUN = process.env.LOAD_COMMIT !== '1';

// 소스 엑셀 위치·기간 UUID·HR 로스터는 환경변수로 주입한다(개인정보·환경 의존값을 코드에 박지 않음).
//   LOAD_SRC_DIR  : 소스 엑셀이 있는 디렉터리
//   PERIOD_2025/PERIOD_2026 : 각 평가기간의 evaluation_periods.id (UUID)
//   HR_ACCOUNTS_JSON : HR 권한 계정 목록 JSON 예) [{"id":"0000001","name":"홍길동"}]
const DIR = process.env.LOAD_SRC_DIR;
if (!DIR) { console.error('LOAD_SRC_DIR 필요 (소스 엑셀 디렉터리)'); process.exit(1); }
const F = {
  c2025: DIR + '/평가데이터_2014to2025/25년 기여도 평가.xlsx',
  c2026: DIR + '/26년 기여도 _ 260610.xlsx',
  master: DIR + '/평가데이터_2014to2025/25년 종합평가 결과.xlsx',
};
const PERIOD_2025 = process.env.PERIOD_2025;
const PERIOD_2026 = process.env.PERIOD_2026;
if (!PERIOD_2025 || !PERIOD_2026) { console.error('PERIOD_2025·PERIOD_2026 (평가기간 UUID) 필요'); process.exit(1); }
const HR_ACCOUNTS = JSON.parse(process.env.HR_ACCOUNTS_JSON || '[]');
const HR_SET = new Set(HR_ACCOUNTS.map((h) => h.id));

const METHODS = ['총괄', '리딩', '실무', '지원'];
const SCOPES = ['의존적', '독립적', '상호적', '전략적'];
const RANK = { 1: '사원', 2: '대리', 3: '차장', 4: '부장' };

// ── helpers ──
const numId = (v) => String(v ?? '').replace(/^[A-Za-z]+/, '').trim();
const scopeNorm = (v) => { const s = String(v ?? '').replace(/\s+/g, '').replace(/기여$/, '').trim(); return SCOPES.includes(s) ? s : null; };
const methodNorm = (v) => { const m = String(v ?? '').trim(); return METHODS.includes(m) ? m : null; };
const levelInt = (v) => { const m = String(v ?? '').match(/(\d+)/); return m ? Number(m[1]) : null; };
const parseYmd = (v) => {
  const s = String(v ?? '').trim();
  const m = s.match(/^(\d{4})[-.]?(\d{2})[-.]?(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m; const yi = +y, mi = +mo, di = +d;
  if (mi < 1 || mi > 12 || di < 1 || di > 31) return null;
  const dt = new Date(Date.UTC(yi, mi - 1, di));
  if (dt.getUTCFullYear() !== yi || dt.getUTCMonth() !== mi - 1 || dt.getUTCDate() !== di) return null; // 윤년 등 무효일
  return `${y}-${mo}-${d}`;
};
const parseTs = (v) => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  const s = String(v ?? '').trim(); if (!s) return null;
  const d = new Date(s.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const intOrNull = (v) => { const s = String(v ?? '').trim(); if (s === '') return null; const n = Number(s); return Number.isFinite(n) ? Math.round(n) : null; };
const uuid = () => crypto.randomUUID();

function loadXlsx(p) {
  const wb = XLSX.read(fs.readFileSync(p), { type: 'buffer', cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false, defval: '' });
  const header = rows[0].map((h) => String(h).replace(/\s+/g, ' ').trim());
  const ix = {}; header.forEach((h, i) => { if (!(h in ix)) ix[h] = i; });
  return { data: rows.slice(1), g: (r, n) => r[ix[n]] ?? '' };
}

async function main() {
  console.log(`\n=== 실데이터 적재 (${DRY_RUN ? 'DRY_RUN' : 'COMMIT'}) ===`);
  const c25 = loadXlsx(F.c2025);
  const c26 = loadXlsx(F.c2026);
  const mst = loadXlsx(F.master);

  // 사번 충돌 로그
  const collisions = new Map();
  for (const r of c25.data) { const o = String(c25.g(r, '사번')).trim(); if (!o) continue; const n = numId(o); if (!collisions.has(n)) collisions.set(n, new Set()); collisions.get(n).add(o); }
  const merged = [...collisions].filter(([, s]) => s.size > 1);
  console.log(`사번 숫자병합 충돌: ${merged.length}쌍 → ${merged.map(([n, s]) => n + '={' + [...s].join(',') + '}').join('; ')}`);

  // 마스터: numId -> {growth, dept, name, position}
  const master = new Map();
  for (const r of mst.data) {
    const id = numId(mst.g(r, '사번')); if (!id) continue;
    const gl = levelInt(mst.g(r, '성장레벨(직급)'));
    master.set(id, { name: String(mst.g(r, '성명')).trim(), growth: gl, dept: String(mst.g(r, '부서명')).trim() || null, position: RANK[gl] || '팀원' });
  }

  // ── employees 레지스트리 ──
  const emp = new Map(); // numId -> {employee_id,name,position,department,growth_level,job_role,roles:Set,evaluator_id}
  const ensureEmp = (id, name) => { if (!id) return null; if (!emp.has(id)) emp.set(id, { employee_id: id, name: name || id, position: '팀원', department: '미지정', growth_level: null, job_role: null, roles: new Set(), evaluator_id: null }); const e = emp.get(id); if (name && (!e.name || e.name === id)) e.name = name; return e; };

  // PL 제외 필터
  const noPL = (f) => (r) => !/PL/i.test(String(f.g(r, '평가기준명')));

  // 2025 피평가자 = 기여도(PL제외) ∩ 마스터
  const rows25 = c25.data.filter(noPL(c25));
  const rows26 = c26.data.filter(noPL(c26));

  // 빌드 구조: evaluations[] / assignments[] / tasks[] / entries[] / feedback[]
  const evaluations = [], assignments = [], tasks = [], entries = [], feedbacks = [];
  const stat = { ev2025: 0, ev2026: 0, skipped2025NoMaster: new Set(), tasks: 0, scored: 0, unscored: 0, entries: 0, feedback: 0, weightBad: [] };

  function buildPeriod(rows, f, year, periodId, status, opts) {
    // 그룹: numId|소속  (소속 = 발령 단위)
    const groups = new Map();
    for (const r of rows) {
      const id = numId(f.g(r, '사번')); if (!id) continue;
      if (opts.requireMaster && !master.has(id)) { stat.skipped2025NoMaster.add(id); continue; }
      const so = String(f.g(r, '소속')).trim() || '1';
      const key = id + '|' + so;
      if (!groups.has(key)) groups.set(key, { id, so, rows: [] });
      groups.get(key).rows.push(r);
    }

    for (const grp of groups.values()) {
      const { id, rows: grows } = grp;
      const first = grows[0];
      const name = String(f.g(first, '성명')).trim() || (master.get(id)?.name) || id;
      // 성장레벨/부서/직급
      const m = master.get(id);
      const growth = (opts.growthFromFile ? levelInt(f.g(first, '성장레벨(직급)')) : null) ?? m?.growth ?? null;
      const dept = (String(f.g(first, '부서명')).trim() || m?.dept || '미지정');
      const position = RANK[growth] || m?.position || '팀원';
      const jobRole = String(f.g(first, '직무')).trim() || null;
      // 평가자(이 소속 그룹의 대표) — 비어있을 수 있음
      const evrId = numId(f.g(first, '평가자ID')) || null;
      const evrName = String(f.g(first, '평가자')).trim() || null;
      const cfmId = numId(f.g(first, '확인자ID')) || null;
      const cfmName = String(f.g(first, '확인자')).trim() || null;
      const baseDate = parseYmd(f.g(first, '기준일')) || (year === 2025 ? '2025-01-01' : '2026-01-01');

      // 직원 등록
      const ee = ensureEmp(id, name); ee.roles.add('evaluatee');
      if (growth != null) ee.growth_level = growth;
      if (dept && dept !== '미지정') ee.department = dept;
      if (position) ee.position = position;
      if (jobRole) ee.job_role = jobRole;
      if (evrId) { ensureEmp(evrId, evrName).roles.add('evaluator'); if (year === 2026) ee.evaluator_id = evrId; else if (!ee.evaluator_id) ee.evaluator_id = evrId; }
      if (cfmId) ensureEmp(cfmId, cfmName);

      // evaluation
      const evalId = uuid();
      evaluations.push({ id: evalId, evaluatee_id: id, evaluatee_name: name, evaluatee_position: position, evaluatee_department: dept, growth_level: growth ?? 1, evaluation_status: status, evaluation_year: year, evaluation_period_id: periodId, assignment_history_id: null, record_status: 'active' });
      if (year === 2025) stat.ev2025++; else stat.ev2026++;

      // assignment_history (evaluation_id 링크)
      const ahId = uuid();
      assignments.push({ id: ahId, employee_id: id, previous_evaluator_id: null, new_evaluator_id: evrId, evaluation_period_id: periodId, changed_at: baseDate, changed_by: 'import', change_type: 'change', status: 'applied', reason: '실데이터 적재', supersedes_history_id: null, evaluation_id: evalId });
      // evaluation.assignment_history_id 연결 (2-pass 에서 UPDATE)
      evaluations[evaluations.length - 1].assignment_history_id = ahId;

      // tasks (행마다)
      let wsum = 0;
      for (const r of grows) {
        const weight = intOrNull(f.g(r, '비중')) ?? 0;
        wsum += weight;
        const title = String(f.g(r, 'TASK')).trim() || String(f.g(r, '설명1')).trim().slice(0, 40) || '(과업)';
        const desc = String(f.g(r, '설명1')).trim() || null;
        const method = methodNorm(f.g(r, '기여방식'));
        const scope = scopeNorm(f.g(r, '기여범위'));
        let score = intOrNull(f.g(r, '평가점수'));
        if (score != null && score < 1) score = null; // 0/미채점 → null
        const sd = parseYmd(f.g(r, '시작일')); const ed = parseYmd(f.g(r, '종료일'));
        const remark = String(f.g(r, '비고')).trim() || null;
        const fdate = parseTs(f.g(r, '최종수정일시'));
        const taskUuid = uuid(); const taskId = uuid();
        tasks.push({ id: taskUuid, task_id: taskId, evaluation_id: evalId, title, weight, description: desc, start_date: sd, end_date: ed, contribution_method: method, contribution_scope: scope, score, feedback: remark, feedback_date: score != null ? fdate : null, evaluator_name: evrName, evaluation_year: year, evaluation_period_id: periodId });
        stat.tasks++; if (score != null) stat.scored++; else stat.unscored++;

        // task_evaluation_entry (평가자 있을 때만)
        if (evrId) {
          const entId = uuid();
          entries.push({ id: entId, task_uuid: taskUuid, task_id: taskId, evaluation_id: evalId, evaluator_id: evrId, evaluator_name: evrName || evrId, contribution_method: method, contribution_scope: scope, score, feedback: remark, feedback_date: score != null ? fdate : null, status: 'active' });
          stat.entries++;
          if (remark) { feedbacks.push({ id: uuid(), task_id: taskId, content: remark, evaluator_name: evrName, evaluator_id: evrId, task_uuid: taskUuid, evaluation_id: evalId, task_evaluation_entry_id: entId, status: 'active', created_at: fdate || new Date().toISOString() }); stat.feedback++; }
        }
      }
      if (Math.round(wsum) !== 100 && grows.some((r) => String(f.g(r, '비중')).trim() !== '')) stat.weightBad.push(`${id}|${grp.so}=${wsum}`);
    }
  }

  buildPeriod(rows25, c25, 2025, PERIOD_2025, 'completed', { requireMaster: true, growthFromFile: false });
  buildPeriod(rows26, c26, 2026, PERIOD_2026, 'in-progress', { requireMaster: false, growthFromFile: true });

  // HR 권한 + 누락 HR 계정 생성
  for (const h of HR_ACCOUNTS) { const e = ensureEmp(h.id, h.name); e.roles.add('hr'); }
  // available_roles 확정
  for (const e of emp.values()) { if (e.roles.size === 0) e.roles.add('evaluatee'); if (HR_SET.has(e.employee_id)) e.roles.add('hr'); }

  console.log(`\n[빌드 결과]`);
  console.log(`  직원(employees): ${emp.size}`);
  console.log(`  evaluations: 2025=${stat.ev2025}, 2026=${stat.ev2026}, 합=${evaluations.length}`);
  console.log(`  2025 마스터부재 제외 인원: ${stat.skipped2025NoMaster.size}`);
  console.log(`  tasks: ${stat.tasks} (점수있음 ${stat.scored}, 미채점 ${stat.unscored})`);
  console.log(`  task_evaluation_entries: ${stat.entries}, feedback_history: ${stat.feedback}, assignment_history: ${assignments.length}`);
  console.log(`  가중치합≠100 그룹: ${stat.weightBad.length}${stat.weightBad.length ? ' (예: ' + stat.weightBad.slice(0, 8).join(', ') + ')' : ''}`);
  const hrFound = HR_ACCOUNTS.filter((h) => emp.has(h.id));
  console.log(`  HR 권한 부여: ${hrFound.length}/${HR_ACCOUNTS.length} (${hrFound.map((h) => h.id).join(',')})`);

  // ── DB 트랜잭션 ──
  const pool = new Pool({ connectionString: CONN });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // 1) 자식부터 전부 삭제 (FK 역순). evaluation_periods·admin 보존.
    console.log('\n[삭제] 샘플 데이터 정리...');
    await c.query('DELETE FROM feedback_history');
    await c.query('DELETE FROM task_evaluation_entries');
    await c.query('DELETE FROM tasks');
    // 사이드 테이블(샘플) — 본체(evaluations·assignment_history)보다 먼저 비워 RESTRICT FK 회피
    for (const t of ['notifications', 'evaluator_change_requests', 'admin_audit_logs', 'password_reset_requests', 'evaluator_qna_logs']) {
      try { await c.query(`DELETE FROM ${t}`); } catch (e) { /* 테이블 없으면 무시 */ }
    }
    await c.query('UPDATE evaluations SET assignment_history_id = NULL');
    await c.query('DELETE FROM evaluator_assignment_history');
    await c.query('DELETE FROM evaluations');
    await c.query("UPDATE employees SET evaluator_id = NULL WHERE employee_id <> 'admin'");
    await c.query("DELETE FROM employees WHERE employee_id <> 'admin'");

    // 2) employees INSERT
    console.log('[삽입] employees...');
    for (const e of emp.values()) {
      await c.query(
        `INSERT INTO employees (employee_id,name,position,department,growth_level,job_role,available_roles,password_hash,must_change_password)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,true)
         ON CONFLICT (employee_id) DO UPDATE SET name=EXCLUDED.name, position=EXCLUDED.position, department=EXCLUDED.department,
           growth_level=EXCLUDED.growth_level, job_role=EXCLUDED.job_role, available_roles=EXCLUDED.available_roles`,
        [e.employee_id, e.name, e.position, e.department, e.growth_level, e.job_role, [...e.roles]]
      );
    }
    // evaluator_id 2-pass (자기참조 FK)
    for (const e of emp.values()) if (e.evaluator_id && emp.has(e.evaluator_id)) await c.query('UPDATE employees SET evaluator_id=$1 WHERE employee_id=$2', [e.evaluator_id, e.employee_id]);

    // 3) evaluations INSERT (assignment_history_id=NULL 먼저)
    console.log('[삽입] evaluations...');
    for (const ev of evaluations) {
      await c.query(
        `INSERT INTO evaluations (id,evaluatee_id,evaluatee_name,evaluatee_position,evaluatee_department,growth_level,evaluation_status,evaluation_year,evaluation_period_id,record_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active')`,
        [ev.id, ev.evaluatee_id, ev.evaluatee_name, ev.evaluatee_position, ev.evaluatee_department, ev.growth_level, ev.evaluation_status, ev.evaluation_year, ev.evaluation_period_id]
      );
    }
    // 4) assignment_history INSERT
    console.log('[삽입] assignment_history...');
    for (const a of assignments) {
      await c.query(
        `INSERT INTO evaluator_assignment_history (id,employee_id,previous_evaluator_id,new_evaluator_id,evaluation_period_id,changed_at,changed_by,change_type,status,reason,supersedes_history_id,evaluation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [a.id, a.employee_id, a.previous_evaluator_id, a.new_evaluator_id, a.evaluation_period_id, a.changed_at, a.changed_by, a.change_type, a.status, a.reason, a.supersedes_history_id, a.evaluation_id]
      );
    }
    // 5) evaluations.assignment_history_id UPDATE (2-pass)
    for (const ev of evaluations) await c.query('UPDATE evaluations SET assignment_history_id=$1 WHERE id=$2', [ev.assignment_history_id, ev.id]);

    // 6) tasks INSERT
    console.log('[삽입] tasks...');
    for (const t of tasks) {
      await c.query(
        `INSERT INTO tasks (id,task_id,evaluation_id,title,weight,description,start_date,end_date,contribution_method,contribution_scope,score,feedback,feedback_date,evaluator_name,evaluation_year,evaluation_period_id,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())`,
        [t.id, t.task_id, t.evaluation_id, t.title, t.weight, t.description, t.start_date, t.end_date, t.contribution_method, t.contribution_scope, t.score, t.feedback, t.feedback_date, t.evaluator_name, t.evaluation_year, t.evaluation_period_id]
      );
    }
    // 7) entries INSERT
    console.log('[삽입] task_evaluation_entries...');
    for (const te of entries) {
      await c.query(
        `INSERT INTO task_evaluation_entries (id,task_uuid,task_id,evaluation_id,evaluator_id,evaluator_name,contribution_method,contribution_scope,score,feedback,feedback_date,status,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())`,
        [te.id, te.task_uuid, te.task_id, te.evaluation_id, te.evaluator_id, te.evaluator_name, te.contribution_method, te.contribution_scope, te.score, te.feedback, te.feedback_date, te.status]
      );
    }
    // 8) feedback_history INSERT
    console.log('[삽입] feedback_history...');
    for (const fh of feedbacks) {
      await c.query(
        `INSERT INTO feedback_history (id,task_id,content,evaluator_name,evaluator_id,task_uuid,evaluation_id,task_evaluation_entry_id,status,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [fh.id, fh.task_id, fh.content, fh.evaluator_name, fh.evaluator_id, fh.task_uuid, fh.evaluation_id, fh.task_evaluation_entry_id, fh.status, fh.created_at]
      );
    }

    // 검증 카운트
    const cnt = async (t) => (await c.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n;
    console.log('\n[DB 카운트(트랜잭션 내)]');
    for (const t of ['employees', 'evaluations', 'tasks', 'task_evaluation_entries', 'feedback_history', 'evaluator_assignment_history']) console.log(`  ${t}: ${await cnt(t)}`);

    // 의미 검증
    console.log('\n[의미 검증]');
    const rq = async (s) => (await c.query(s)).rows;
    for (const r of await rq(`SELECT evaluation_year y, evaluation_status s, count(*)::int n FROM evaluations GROUP BY 1,2 ORDER BY 1,2`)) console.log(`  eval ${r.y}/${r.s}: ${r.n}`);
    console.log('  task.score 분포: ' + (await rq(`SELECT COALESCE(score::text,'null') s, count(*)::int n FROM tasks GROUP BY 1 ORDER BY 1`)).map((r) => `${r.s}:${r.n}`).join(' '));
    console.log('  hr 직원: ' + (await rq(`SELECT count(*)::int n FROM employees WHERE 'hr'=ANY(available_roles)`))[0].n + ' / admin 보존: ' + (await rq(`SELECT count(*)::int n FROM employees WHERE employee_id='admin'`))[0].n);
    console.log('  evaluator 역할 직원: ' + (await rq(`SELECT count(*)::int n FROM employees WHERE 'evaluator'=ANY(available_roles)`))[0].n + ' / 평가자 미배정 evaluation: ' + (await rq(`SELECT count(*)::int n FROM evaluations e WHERE NOT EXISTS(SELECT 1 FROM evaluator_assignment_history h WHERE h.id=e.assignment_history_id AND h.new_evaluator_id IS NOT NULL)`))[0].n);
    console.log('  고아 task(매칭 evaluation 없음): ' + (await rq(`SELECT count(*)::int n FROM tasks t WHERE NOT EXISTS(SELECT 1 FROM evaluations e WHERE e.id=t.evaluation_id)`))[0].n);

    if (DRY_RUN) { await c.query('ROLLBACK'); console.log('\n*** DRY_RUN — ROLLBACK (적용 안 함). LOAD_COMMIT=1 로 실제 적용 ***'); }
    else { await c.query('COMMIT'); console.log('\n*** COMMIT 완료 — 실데이터 적재됨 ***'); }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('\n!! 실패, 롤백:', e.message);
    console.error(e.stack);
    process.exitCode = 1;
  } finally { c.release(); await pool.end(); }
}
main();

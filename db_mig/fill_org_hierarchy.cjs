/**
 * fill_org_hierarchy.cjs — 조직세부정보관리.xlsx 기준으로 employees.org_* 채우기.
 *
 * 조직 트리(T-Level + 행순서)에서 각 부서코드의 경로를 복원하고, 조직종류로 앱 4단계에 매핑:
 *   법인=L2 계열사 / 본부=경로상 '본부' / 부='부' / 팀='팀·지점' 중 가장 깊은 것(리프).
 * 직원 부서코드는 소스에서 도출(2026 우선, 없으면 2025 종합마스터).
 *
 * 실행:  node db_mig/fill_org_hierarchy.cjs           # DRY_RUN
 *        ORG_COMMIT=1 node db_mig/fill_org_hierarchy.cjs   # 적용
 */
'use strict';
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { Pool } = require('pg');

// .env 로드
fs.readFileSync(path.resolve(__dirname, '..', '.env'), 'utf8').split('\n').forEach((line) => { const t = line.trim(); if (!t || t.startsWith('#')) return; const i = t.indexOf('='); if (i > 0) process.env[t.slice(0, i)] = t.slice(i + 1); });
const CONN = process.env.DATABASE_URL; if (!CONN) { console.error('DATABASE_URL 필요'); process.exit(1); }
const DRY_RUN = process.env.ORG_COMMIT !== '1';

// 법인명 → 약어 (사용자 제공). 공백 제거 후 매칭.
const CORP_ABBR_RAW = {
  '(주)오케이벤처스': 'OKV', '(주)엑스인하우징': 'EX', '오케이홀딩스대부(주)': 'OKH',
  '(주)오케이저축은행': 'OK', '오케이캐피탈': 'OC', '아프로신용정보(주)': 'ACI',
  '아프로에프앤아이대부(주)': 'AFI', '예스자산대부(주)': 'YA', '오케이에이엑스(주)': 'OKAX',
  '(주)오케이인베스트먼트파트너스': 'OKIP',
};
const CORP_ABBR = {}; for (const [k, v] of Object.entries(CORP_ABBR_RAW)) CORP_ABBR[k.replace(/\s+/g, '')] = v;
const UNMATCHED_CORP = new Set();
const abbr = (corp) => { const k = String(corp || '').replace(/\s+/g, '').trim(); if (!k) return ''; const hit = CORP_ABBR[k]; if (!hit) { UNMATCHED_CORP.add(corp); return corp; } return hit; };

const ORG = 'C:/Users/OK/dev/org/data/조직세부정보관리.xlsx';
const DIR = 'C:/Users/OK/Cowork-HR/source_docs/processed';
const numId = (v) => String(v ?? '').replace(/^[A-Za-z]+/, '').trim();
const load = (p) => { const wb = XLSX.read(fs.readFileSync(p), { type: 'buffer', cellDates: true }); const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false, defval: '' }); const header = rows[0].map((h) => String(h).replace(/\s+/g, ' ').trim()); return { rows, header, ix: (() => { const m = {}; header.forEach((h, i) => { if (!(h in m)) m[h] = i; }); return m; })() }; };

// ── 조직 트리 → code -> {corp,div,dept,team} ──
function buildOrgMap() {
  const { rows } = load(ORG); // [1]조직명 [2]T-Level [3]코드 [10]조직종류
  const map = new Map();
  const stack = []; // stack[level] = {name, code, kind}
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = String(r[1] ?? '').trim();
    const level = parseInt(String(r[2] ?? '').trim(), 10);
    const code = String(r[3] ?? '').trim();
    const kind = String(r[10] ?? '').trim();
    if (!Number.isFinite(level) || !code) continue;
    stack[level] = { name, code, kind }; stack.length = level + 1;
    const pathNodes = stack.slice(2, level + 1).filter(Boolean); // 루트(L1) 제외, L2부터
    // 조직종류로 슬롯 배정(깊은 노드가 덮어씀)
    let corp = '', div = '', dept = '', team = '';
    pathNodes.forEach((n, idx) => {
      if (idx === 0) corp = abbr(n.name);            // L2 = 계열사 = 법인(약어)
      if (n.kind === '본부') div = n.name;
      else if (n.kind === '부') dept = n.name;
      else if (n.kind === '팀' || n.kind === '지점') team = n.name;
    });
    map.set(code, { corp, div, dept, team, leaf: name, level });
  }
  return map;
}

// ── 직원 부서코드 도출 ──
function buildCodeOf() {
  const codeOf = new Map();
  const mst = load(DIR + '/평가데이터_2014to2025/25년 종합평가 결과.xlsx');
  for (let i = 1; i < mst.rows.length; i++) { const r = mst.rows[i]; const id = numId(r[mst.ix['사번']]); const code = String(r[mst.ix['부서']] ?? '').trim(); if (id && code) codeOf.set(id, code); }
  const c26 = load(DIR + '/26년 기여도 _ 260610.xlsx');
  for (let i = 1; i < c26.rows.length; i++) { const r = c26.rows[i]; if (/PL/i.test(String(r[c26.ix['평가기준명']]))) continue; const id = numId(r[c26.ix['사번']]); const code = String(r[c26.ix['부서']] ?? '').trim(); if (id && code) codeOf.set(id, code); }
  return codeOf;
}

async function main() {
  console.log(`\n=== org_* 채우기 (${DRY_RUN ? 'DRY_RUN' : 'COMMIT'}) ===`);
  const orgMap = buildOrgMap();
  const codeOf = buildCodeOf();
  console.log('org 코드:', orgMap.size, '/ 직원 부서코드 도출:', codeOf.size);
  if (UNMATCHED_CORP.size) console.log('⚠ 약어 미매칭 법인(전체명 유지):', [...UNMATCHED_CORP].join(' | '));

  const pool = new Pool({ connectionString: CONN });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const emps = (await c.query(`SELECT employee_id, department FROM employees WHERE employee_id <> 'admin'`)).rows;
    let updated = 0; const noCode = []; const missCode = new Map();
    for (const e of emps) {
      const code = codeOf.get(e.employee_id);
      if (!code) { noCode.push(e.employee_id); continue; }
      const o = orgMap.get(code);
      if (!o) { missCode.set(code, (missCode.get(code) || 0) + 1); continue; }
      await c.query(
        `UPDATE employees SET department_id=$2, org_corporation=$3, org_division=$4, org_department=$5, org_team=$6 WHERE employee_id=$1`,
        [e.employee_id, code, o.corp || null, o.div || null, o.dept || null, o.team || null]
      );
      updated++;
    }
    console.log(`\n[결과] UPDATE ${updated} / 코드없음 ${noCode.length} / org미등록코드 ${missCode.size}종`);
    if (missCode.size) console.log('  org미등록:', [...missCode.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => k + '(' + n + ')').join(' '));

    const q = async (s) => (await c.query(s)).rows;
    console.log('  채워진 직원: 법인=' + (await q(`SELECT count(*)::int n FROM employees WHERE org_corporation IS NOT NULL`))[0].n + ' 본부=' + (await q(`SELECT count(*)::int n FROM employees WHERE org_division IS NOT NULL`))[0].n + ' 부=' + (await q(`SELECT count(*)::int n FROM employees WHERE org_department IS NOT NULL`))[0].n + ' 팀=' + (await q(`SELECT count(*)::int n FROM employees WHERE org_team IS NOT NULL`))[0].n);
    console.log('  고유 법인: ' + (await q(`SELECT count(DISTINCT org_corporation)::int n FROM employees WHERE org_corporation IS NOT NULL`))[0].n + ' / 본부: ' + (await q(`SELECT count(DISTINCT org_division)::int n FROM employees WHERE org_division IS NOT NULL`))[0].n + ' / 부: ' + (await q(`SELECT count(DISTINCT org_department)::int n FROM employees WHERE org_department IS NOT NULL`))[0].n + ' / 팀: ' + (await q(`SELECT count(DISTINCT org_team)::int n FROM employees WHERE org_team IS NOT NULL`))[0].n);
    console.log('\n  법인별 인원:');
    for (const r of await q(`SELECT org_corporation c, count(*)::int n FROM employees WHERE org_corporation IS NOT NULL GROUP BY 1 ORDER BY n DESC`)) console.log('    ' + r.c + ': ' + r.n);

    if (DRY_RUN) { await c.query('ROLLBACK'); console.log('\n*** DRY_RUN — ROLLBACK. ORG_COMMIT=1 로 적용 ***'); }
    else { await c.query('COMMIT'); console.log('\n*** COMMIT 완료 — org_* 적용됨 ***'); }
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); console.error('실패:', e.message, '\n', e.stack); process.exitCode = 1; }
  finally { c.release(); await pool.end(); }
}
main();

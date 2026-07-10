/**
 * backfill_period_org.cjs — Option B: 각 evaluation 에 그 기간의 부서코드·법인/본부/부/팀 채우기.
 *
 * 소스:
 *   2025: 2025_발령이력부서id추출.xlsx (평가자=조직장 매칭) + 폴백 25년 종합평가 결과.xlsx 부서코드 → 조직_251101.xlsx
 *   2026: 26년 기여도_260610.xlsx 부서코드(부서명 매칭) → 조직_260617.xlsx
 *
 * 2025 부서 배정 규칙(평가별, 피평가자 X · 평가자 E):
 *   ① X의 비휴직 발령부서 중 조직장==E → 채택
 *   ② 동일줄기 collapse 후 단일 부서 → 채택
 *   ⑤ 수동 오버라이드(마스터=휴직인 모호 2건)
 *   ③ 종합마스터 부서코드(비휴직) → 채택
 *   ④ 최초 발령 → 없으면 미지정
 *
 * 실행:  node db_mig/backfill_period_org.cjs                 # DRY_RUN (DB 쓰기 없음)
 *        BACKFILL_COMMIT=1 node db_mig/backfill_period_org.cjs   # UPDATE 적용 (마이그레이션 선적용 필요)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { Pool } = require('pg');

// .env
fs.readFileSync(path.resolve(__dirname, '..', '.env'), 'utf8').split('\n').forEach((line) => { const t = line.trim(); if (!t || t.startsWith('#')) return; const i = t.indexOf('='); if (i > 0) process.env[t.slice(0, i)] = t.slice(i + 1); });
const CONN = process.env.DATABASE_URL; if (!CONN) { console.error('DATABASE_URL 필요'); process.exit(1); }
const DRY_RUN = process.env.BACKFILL_COMMIT !== '1';

const DL = 'C:/Users/OK/Downloads';
const DIR = 'C:/Users/OK/Cowork-HR/source_docs/processed';
const numId = (v) => String(v ?? '').replace(/^[A-Za-z]+/, '').trim();
const load = (p) => { const wb = XLSX.read(fs.readFileSync(p), { type: 'buffer', cellDates: true }); return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false, defval: '' }); };
const hdr = (rows, hi) => { const h = rows[hi].map((x) => String(x).replace(/\s+/g, ' ').trim()); const ix = {}; h.forEach((c, i) => { if (!(c in ix)) ix[c] = i; }); return ix; };

// 법인 약어 (fill_org_hierarchy.cjs 와 동일)
const CORP_ABBR_RAW = {
  '(주)오케이벤처스': 'OKV', '(주)엑스인하우징': 'EX', '오케이홀딩스대부(주)': 'OKH', '(주)오케이저축은행': 'OK', '오케이캐피탈': 'OC',
  '아프로신용정보(주)': 'ACI', '아프로에프앤아이대부(주)': 'AFI', '예스자산대부(주)': 'YA', '오케이에이엑스(주)': 'OKAX', '(주)오케이인베스트먼트파트너스': 'OKIP',
  // 2025 org 스냅샷의 이름 변형(동일 법인 리브랜딩) — 분포가 2026과 상보적이라 동일 법인 확정
  '오케이에프앤아이대부(주)': 'AFI', '오케이신용정보': 'ACI', '오케이데이터시스템(주)': 'OKAX',
  // 신규 법인(사용자 지정)
  '오케이넥스트(주)': 'ON', '오케이네트웍스(주)': 'OT',
};
const CORP_ABBR = {}; for (const [k, v] of Object.entries(CORP_ABBR_RAW)) CORP_ABBR[k.replace(/\s+/g, '')] = v;
const UNMATCHED = new Set();
const abbr = (c) => { const k = String(c || '').replace(/\s+/g, '').trim(); if (!k) return ''; if (CORP_ABBR[k]) return CORP_ABBR[k]; UNMATCHED.add(c); return c; };
const isHuejik = (n) => /휴직|대기발령/.test(String(n || ''));

// ── 조직 트리 파서 (조직_251101 / 260617: 2줄 헤더, row2~) ──
function parseOrg(p) {
  const rows = load(p).slice(2); const byId = new Map(); const stack = [];
  for (const r of rows) { const name = String(r[1]).trim(); const tl = Number(r[2]); const id = String(r[3]).trim(); const leader = numId(r[7]); const kind = String(r[10]).trim(); if (!id || !tl) continue; while (stack.length && stack[stack.length - 1].tl >= tl) stack.pop(); byId.set(id, { name, tl, kind, leader, parents: stack.map((s) => ({ ...s })) }); stack.push({ name, tl, kind, id }); }
  const ancCodes = (id) => (byId.get(id)?.parents || []).map((x) => x.id);
  const levels = (id) => {
    const n = byId.get(id); if (!n) return null;
    const chain = [...n.parents, { name: n.name, tl: n.tl, kind: n.kind }];
    const corpN = chain.find((c) => c.tl === 2);
    const last = (k) => { for (let i = chain.length - 1; i >= 0; i--) if (chain[i].kind === k) return chain[i].name; return ''; };
    const team = (n.kind === '팀' || n.kind === '지점') ? n.name : (last('팀') || last('지점'));
    return { code: id, corp: corpN ? abbr(corpN.name) : '', div: last('본부'), dept: last('부'), team, leaf: n.name };
  };
  return { byId, ancCodes, levels };
}
const org25 = parseOrg(DL + '/조직_251101.xlsx');
const org26 = parseOrg(DL + '/조직_260617.xlsx');

// ── 발령이력: numId -> [{deptId,deptName}] ──
const fl = load(DL + '/2025_발령이력부서id추출.xlsx'); const flx = hdr(fl, 0);
const flBy = new Map();
for (const r of fl.slice(1)) { const id = numId(r[flx['사번']]); if (!id) continue; if (!flBy.has(id)) flBy.set(id, []); flBy.get(id).push({ deptId: String(r[flx['부서ID']]).trim(), deptName: String(r[flx['부서명']]).trim() }); }

// ── 마스터 부서코드: numId -> code ──
const mst = load(DIR + '/평가데이터_2014to2025/25년 종합평가 결과.xlsx'); const mx = hdr(mst, 0);
const masterCode = new Map();
for (const r of mst.slice(1)) { const id = numId(r[mx['사번']]); const code = String(r[mx['부서']] ?? '').trim(); if (id && code && !masterCode.has(id)) masterCode.set(id, code); }

// ── 2026 기여도: (numId|부서명) -> 부서코드, numId -> 첫 코드 ──
const c26 = load(DIR + '/26년 기여도 _ 260610.xlsx'); const c26x = hdr(c26, 0);
const code26ByName = new Map(); const code26First = new Map();
for (const r of c26.slice(1)) { if (/PL/i.test(String(r[c26x['평가기준명']]))) continue; const id = numId(r[c26x['사번']]); const code = String(r[c26x['부서']] ?? '').trim(); const dn = String(r[c26x['부서명']] ?? '').trim(); if (!id || !code) continue; code26ByName.set(id + '|' + dn, code); if (!code26First.has(id)) code26First.set(id, code); }

// 수동 오버라이드 (마스터=휴직인 모호 2건, 사용자 확정)
const OVERRIDE_2025 = { '9000029': 'O042', '9000030': 'O045' }; // 직원37→소비자금융기획팀, 직원38→여신심사1팀

// 동일줄기 collapse
function effective(distinct) {
  if (distinct.length <= 1) return distinct;
  const deepest = distinct.reduce((a, b) => ((org25.byId.get(b.deptId)?.tl || 0) > (org25.byId.get(a.deptId)?.tl || 0) ? b : a));
  const anc = new Set(org25.ancCodes(deepest.deptId));
  if (distinct.every((d) => d.deptId === deepest.deptId || anc.has(d.deptId))) return [deepest];
  return distinct;
}
function resolve2025(id, evId) {
  const raw = (flBy.get(id) || []).filter((d) => !isHuejik(d.deptName) && org25.byId.has(d.deptId));
  const distinct = []; for (const d of raw) if (!distinct.find((x) => x.deptId === d.deptId)) distinct.push(d);
  const eff = effective(distinct);
  if (evId) { const hit = eff.find((d) => org25.byId.get(d.deptId)?.leader === evId); if (hit) return { code: hit.deptId, src: '①조직장' }; }
  if (eff.length === 1) return { code: eff[0].deptId, src: '②단일' };
  if (OVERRIDE_2025[id]) return { code: OVERRIDE_2025[id], src: '⑤수동' };
  const mc = masterCode.get(id);
  if (mc && org25.byId.has(mc) && !isHuejik(org25.byId.get(mc).name)) return { code: mc, src: '③마스터' };
  if (eff.length) return { code: eff[0].deptId, src: '④최초발령' };
  return { code: null, src: '④미지정' };
}
function resolve2026(id, deptName) {
  const code = code26ByName.get(id + '|' + (deptName || '')) || code26First.get(id) || masterCode.get(id) || null;
  return { code, src: code26ByName.get(id + '|' + (deptName || '')) ? '부서명매칭' : (code26First.get(id) ? '첫부서' : (masterCode.get(id) ? '마스터' : '미지정')) };
}

async function main() {
  console.log(`\n=== 연도별 org 백필 (${DRY_RUN ? 'DRY_RUN — DB 쓰기 없음' : 'COMMIT'}) ===`);
  console.log(`org25 노드 ${org25.byId.size} / org26 노드 ${org26.byId.size} / 발령 ${flBy.size}명 / 마스터코드 ${masterCode.size} / 26코드 ${code26First.size}`);

  const pool = new Pool({ connectionString: CONN });
  const c = await pool.connect();
  try {
    const evs = (await c.query(`
      SELECT e.id, e.evaluatee_id, e.evaluatee_name, e.evaluation_year, e.evaluatee_department,
             h.new_evaluator_id AS evaluator_id
      FROM evaluations e
      LEFT JOIN evaluator_assignment_history h ON h.id = e.assignment_history_id
    `)).rows;
    console.log(`평가 ${evs.length}건 로드`);

    const stat = { 2025: {}, 2026: {} };
    const bump = (y, k) => { stat[y][k] = (stat[y][k] || 0) + 1; };
    const updates = [];
    const unresolved = []; const overrideHits = []; const corp = { 2025: new Set(), 2026: new Set() };
    const teamSet = { 2025: new Set(), 2026: new Set() };
    const corpDist = { 2025: {}, 2026: {} };

    for (const e of evs) {
      const id = e.evaluatee_id; const y = e.evaluation_year;
      let code, src, orgsrc;
      if (y === 2025) { const r = resolve2025(id, e.evaluator_id ? numId(e.evaluator_id) : null); code = r.code; src = r.src; orgsrc = org25; }
      else { const r = resolve2026(id, e.evaluatee_department); code = r.code; src = r.src; orgsrc = org26; }
      bump(y, src);
      if (src === '⑤수동') overrideHits.push(`${id} ${e.evaluatee_name} → ${code}`);
      const lv = code ? orgsrc.levels(code) : null;
      if (!code || !lv) { unresolved.push(`${y} ${id} ${e.evaluatee_name} (${e.evaluatee_department}) src=${src} code=${code || '∅'}`); bump(y, '✗미해상'); }
      else { corp[y].add(lv.corp); if (lv.team) teamSet[y].add(lv.team); corpDist[y][lv.corp || '(빈)'] = (corpDist[y][lv.corp || '(빈)'] || 0) + 1; }
      const deptName = lv ? (lv.team || lv.dept || lv.div || lv.leaf) : (e.evaluatee_department || null);
      updates.push({ id: e.id, code: code || null, corp: lv?.corp || null, div: lv?.div || null, dept: lv?.dept || null, team: lv?.team || null, deptName });
    }

    const pr = (y) => Object.entries(stat[y]).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  ');
    console.log(`\n[2025 배정사유]  ${pr(2025)}`);
    console.log(`[2026 배정사유]  ${pr(2026)}`);
    console.log(`고유 법인  2025=${[...corp[2025]].filter(Boolean).length} 2026=${[...corp[2026]].filter(Boolean).length} / 고유 팀 2025=${teamSet[2025].size} 2026=${teamSet[2026].size}`);
    const corpLine = (y) => Object.entries(corpDist[y]).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  ');
    console.log(`[2025 법인분포] ${corpLine(2025)}`);
    console.log(`[2026 법인분포] ${corpLine(2026)}`);
    console.log(`\n[수동 오버라이드 적용 ${overrideHits.length}]`); overrideHits.forEach((x) => console.log('  ' + x));
    console.log(`\n[미해상 ${unresolved.length}]`); unresolved.slice(0, 30).forEach((x) => console.log('  ' + x)); if (unresolved.length > 30) console.log(`  ... +${unresolved.length - 30}`);

    // 검증 샘플
    const sample = async (label, sql) => { const rows = (await c.query(sql)).rows; console.log(`\n[${label}]`); rows.forEach((r) => console.log('  ' + JSON.stringify(r))); };
    // 직원33: 2025 없어야(제외), 2026 리스크관리팀/연결회계팀
    const choi = updates.filter((u) => evs.find((e) => e.id === u.id)?.evaluatee_id === '9000031').map((u) => { const e = evs.find((x) => x.id === u.id); return { y: e.evaluation_year, team: u.team, div: u.div, dept: u.dept, corp: u.corp }; });
    console.log('\n[직원33 9000031]'); choi.forEach((x) => console.log('  ' + JSON.stringify(x)));
    // 직원37/직원38
    for (const sid of ['9000029', '9000030']) { const us = updates.filter((u) => evs.find((e) => e.id === u.id)?.evaluatee_id === sid).map((u) => { const e = evs.find((x) => x.id === u.id); return { y: e.evaluation_year, team: u.team, dept: u.dept, div: u.div }; }); console.log(`[${sid}]`); us.forEach((x) => console.log('  ' + JSON.stringify(x))); }

    if (UNMATCHED.size) console.log('\n⚠ 약어 미매칭 법인:', [...UNMATCHED].join(' | '));

    if (DRY_RUN) { console.log('\n*** DRY_RUN — DB 변경 없음. BACKFILL_COMMIT=1 로 적용(마이그레이션 선적용 필요) ***'); }
    else {
      console.log('\n[적용] UPDATE evaluations...');
      await c.query('BEGIN');
      let n = 0;
      for (const u of updates) {
        await c.query(
          `UPDATE evaluations SET evaluatee_dept_code=$2, evaluatee_org_corporation=$3, evaluatee_org_division=$4, evaluatee_org_department=$5, evaluatee_org_team=$6, evaluatee_department=COALESCE($7, evaluatee_department) WHERE id=$1`,
          [u.id, u.code, u.corp, u.div, u.dept, u.team, u.deptName]
        );
        n++;
      }
      await c.query('COMMIT');
      console.log(`*** COMMIT 완료 — ${n}건 UPDATE ***`);
    }
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); console.error('실패:', e.message, '\n', e.stack); process.exitCode = 1; }
  finally { c.release(); await pool.end(); }
}
main();

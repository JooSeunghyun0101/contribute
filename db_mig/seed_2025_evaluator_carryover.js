/**
 * 2025 평가자 배정 정합성 시드 (sample data) — 평가기간 단위(period-scoped)
 *
 * 문제: 2025 평가/과업/점수는 있으나 평가자 배정 연결(assignment_history_id)이 없고,
 *       평가자 변경 이력이 전부 2026 기간 행이라 2025 담당자를 알 수 없었다.
 *       → "월별 달성 현황 추이"의 전년(2025) 차트가 비고, 평가자 화면에서 연도별 담당/근무기간이 꼬임.
 *
 * 처리(평가기간별로 끊어서):
 *   각 2025 평가 보유자에 대해 2025 평가기간(evaluation_period_id) 전용 배정행을 1건 만든다.
 *     - changed_at = 2024-12-31(2025 기간 시작), new_evaluator = 2025 담당자, previous = null
 *     - 2025 담당자 = 그 사람의 2026 기간 최이른 applied change 행의 new_evaluator
 *       (= 2026 시작 시점 평가자 = 2025 말 carryover). 2026 행이 없으면 현재 평가자.
 *   그리고 2025 평가의 assignment_history_id 를 그 행에 연결.
 *
 * 결과: buildEvaluatorPeriods(history, { periodId }) 로 기간별 담당기간을 정확히 산출.
 *   - 2025: 이수한·안정 인원 → 박판근, 권오선 → 정호영
 *   - 2026: 기존 행 그대로(이수한 박판근→김남엽, 권오선 정호영→박판근 등)
 * ⚠️ 기간을 넘어 합치지 않으려면 **반드시 period 단위**로 끊어서 계산해야 한다(코드도 그렇게 동작).
 *
 * 실행: DATABASE_URL 필요.  NODE_PATH=node_modules node db_mig/seed_2025_evaluator_carryover.js
 * 멱등: 이미 2025 기간 행이 있으면 재사용(중복 생성 안 함).
 */
const { Pool } = require('pg');

const CONN = process.env.DATABASE_URL;
if (!CONN) {
  console.error('DATABASE_URL 환경변수가 필요합니다.');
  process.exit(1);
}
const CARRY = '2024-12-31T00:00:00.000Z'; // 2025 기간 시작

(async () => {
  const pool = new Pool({ connectionString: CONN });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const p2025 = (await c.query("SELECT id FROM evaluation_periods WHERE evaluation_year=2025")).rows[0]?.id;
    const p2026 = (await c.query("SELECT id FROM evaluation_periods WHERE evaluation_year=2026")).rows[0]?.id;
    if (!p2025) throw new Error('2025 evaluation_period 가 없습니다.');

    const empMap = new Map(
      (await c.query('SELECT employee_id, evaluator_id FROM employees')).rows.map((r) => [r.employee_id, r.evaluator_id]),
    );
    // 2026 기간 carryover 평가자 = 각 직원의 2026 최이른 applied change 행 new_evaluator
    const carry2026 = new Map();
    if (p2026) {
      const rows2026 = (await c.query(
        "SELECT employee_id, new_evaluator_id FROM evaluator_assignment_history WHERE status='applied' AND change_type<>'cancel' AND evaluation_period_id=$1 ORDER BY changed_at, id",
        [p2026],
      )).rows;
      for (const r of rows2026) if (!carry2026.has(r.employee_id)) carry2026.set(r.employee_id, r.new_evaluator_id);
    }
    // 이미 존재하는 2025 기간 applied change 행
    const existing2025 = new Map();
    for (const r of (await c.query(
      "SELECT employee_id, id FROM evaluator_assignment_history WHERE status='applied' AND change_type<>'cancel' AND evaluation_period_id=$1 ORDER BY changed_at, id",
      [p2025],
    )).rows) {
      if (!existing2025.has(r.employee_id)) existing2025.set(r.employee_id, r.id);
    }

    const evaluatees = (await c.query("SELECT DISTINCT evaluatee_id FROM evaluations WHERE evaluation_year=2025")).rows.map((r) => r.evaluatee_id);
    let inserted = 0, reused = 0, linked = 0;
    for (const emp of evaluatees) {
      let rowId = existing2025.get(emp);
      if (rowId) {
        reused++;
      } else {
        const carryEval = carry2026.get(emp) ?? empMap.get(emp) ?? null;
        const ins = await c.query(
          "INSERT INTO evaluator_assignment_history (employee_id, previous_evaluator_id, new_evaluator_id, changed_at, changed_by, evaluation_period_id, change_type, status, reason) VALUES ($1,NULL,$2,$3,'sample-seed',$4,'change','applied','2025 evaluator (period-scoped seed)') RETURNING id",
          [emp, carryEval, CARRY, p2025],
        );
        rowId = ins.rows[0].id;
        inserted++;
      }
      const u = await c.query('UPDATE evaluations SET assignment_history_id=$1 WHERE evaluatee_id=$2 AND evaluation_year=2025', [rowId, emp]);
      linked += u.rowCount;
    }
    await c.query('COMMIT');
    console.log(`완료: 2025 행 insert=${inserted}, reuse=${reused}, 2025 evals linked=${linked}`);
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('ROLLBACK:', e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})();

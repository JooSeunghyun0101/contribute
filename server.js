import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';

// Load environment variables from .env (manual parsing)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '.env');
const mockEmployeesPath = path.resolve(__dirname, 'src/lib/mockEmployees.json');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const [key, ...rest] = trimmed.split('=');
    process.env[key] = rest.join('=');
  });
}

const mockEmployees = fs.existsSync(mockEmployeesPath)
  ? JSON.parse(fs.readFileSync(mockEmployeesPath, 'utf8'))
  : [];

let isDbAvailable = false;

const getMockEmployeeById = (employeeId) =>
  mockEmployees.find((employee) => employee.employee_id === employeeId) ?? null;

const getMockEmployeesByEvaluator = (evaluatorId) =>
  mockEmployees.filter((employee) => employee.evaluator_id === evaluatorId);

const getMockEmployeesByDepartment = (department) =>
  mockEmployees.filter((employee) => employee.department === department);

const sendDbUnavailable = (res) =>
  res.status(503).json({
    error: 'Database unavailable',
    message: 'PostgreSQL is not running. The API server is currently in mock mode.',
  });

// Initialize PostgreSQL pool
const connectionString = process.env.DATABASE_URL;
let pool;
if (connectionString) {
  pool = new Pool({ 
    connectionString,
    connectionTimeoutMillis: 3000, 
    query_timeout: 3000
  });

  // Handle unexpected errors on idle clients so the process doesn't crash
  pool.on('error', (err, client) => {
    console.error('??Unexpected error on idle client', err);
  });

  pool
    .query('SELECT 1')
    .then(() => {
      isDbAvailable = true;
      console.log('??PostgreSQL ?곌껐 ?깃났 (API ?쒕쾭)');

    })
    .catch(err => {
      console.error('??PostgreSQL ?곌껐 ?湲곗떆媛?珥덇낵 ?먮뒗 ?ㅽ뙣 (API ?쒕쾭)', err.message);
      console.log('?좑툘 API ?쒕쾭?먯꽌 mock DB濡??꾪솚?⑸땲??');
      // Fallback to mock DB to avoid crashes
      pool = { query: async () => ({ rows: [], rowCount: 0 }) };
    });
} else {
  console.warn('?좑툘 DATABASE_URL???ㅼ젙?섏? ?딆쓬 ??API ?쒕쾭?먯꽌 mock DB ?ъ슜');
  pool = { query: async () => ({ rows: [], rowCount: 0 }) };
}

const getCurrentEvaluationYear = () => new Date().getFullYear();

const getActiveEvaluationPeriod = async () => {
  if (!isDbAvailable || !pool?.query) {
    return null;
  }

  try {
    const { rows } = await pool.query(`
      SELECT *
      FROM evaluation_periods
      WHERE status = 'active'
      ORDER BY is_default DESC, starts_on DESC NULLS LAST, created_at DESC
      LIMIT 1
    `);
    return rows[0] ?? null;
  } catch (err) {
    if (err?.code !== '42P01') {
      console.warn('Active evaluation period lookup failed:', err.message);
    }
    return null;
  }
};

const resolveEvaluationPeriodFilter = async (
  query = {},
  startIndex = 1,
  periodColumn = 'evaluation_period_id',
  yearColumn = 'evaluation_year'
) => {
  if (typeof query.periodId === 'string' && query.periodId.trim()) {
    return {
      clause: `${periodColumn} = $${startIndex}`,
      values: [query.periodId.trim()],
      period: null,
    };
  }

  const activePeriod = await getActiveEvaluationPeriod();
  if (activePeriod?.id) {
    return {
      clause: `(${periodColumn} = $${startIndex} OR (${periodColumn} IS NULL AND ${yearColumn} = $${startIndex + 1}))`,
      values: [activePeriod.id, activePeriod.evaluation_year],
      period: activePeriod,
    };
  }

  const requestedYear = Number(query.year);
  const year = Number.isInteger(requestedYear) ? requestedYear : getCurrentEvaluationYear();
  return {
    clause: `${yearColumn} = $${startIndex}`,
    values: [year],
    period: null,
    year,
  };
};

const attachDefaultEvaluationPeriod = async (record) => {
  const activePeriod = await getActiveEvaluationPeriod();

  if (record.evaluation_year == null) {
    record.evaluation_year = activePeriod?.evaluation_year ?? getCurrentEvaluationYear();
  }

  if (activePeriod?.id && record.evaluation_period_id == null) {
    record.evaluation_period_id = activePeriod.id;
  }

  return record;
};

const attachTaskEvaluationPeriod = async (task) => {
  if (!task.evaluation_id || !isDbAvailable || !pool?.query) {
    return attachDefaultEvaluationPeriod(task);
  }

  try {
    const { rows } = await pool.query(
      'SELECT evaluation_year, evaluation_period_id FROM evaluations WHERE id = $1',
      [task.evaluation_id]
    );
    const evaluation = rows[0];
    if (evaluation) {
      if (task.evaluation_year == null) {
        task.evaluation_year = evaluation.evaluation_year;
      }
      if (task.evaluation_period_id == null && evaluation.evaluation_period_id != null) {
        task.evaluation_period_id = evaluation.evaluation_period_id;
      }
      return task;
    }
  } catch (err) {
    console.warn('Task evaluation period lookup failed:', err.message);
  }

  return attachDefaultEvaluationPeriod(task);
};

const PERIOD_STATUSES = new Set(['draft', 'active', 'closed', 'locked']);
const NON_WRITABLE_PERIOD_STATUSES = new Set(['draft', 'closed', 'locked']);
const MISSING_PERIOD_SCHEMA_CODES = new Set(['42P01', '42703']);
const TASK_STRUCTURE_LOCKED_EVALUATION_STATUSES = new Set(['submitted', 'evaluating', 'completed', 'locked']);
const TASK_EVALUATION_EDITABLE_STATUSES = new Set(['submitted', 'evaluating']);
const EMPLOYEE_UPDATE_FIELDS = new Set([
  'name',
  'position',
  'department',
  'growth_level',
  'evaluator_id',
  'available_roles',
]);
const ASSIGNMENT_HISTORY_CHANGE_TYPES = new Set(['change', 'cancel']);
const ASSIGNMENT_HISTORY_STATUSES = new Set(['applied', 'cancelled']);
const TASK_STRUCTURE_FIELDS = new Set([
  'title',
  'description',
  'weight',
  'start_date',
  'end_date',
  'startDate',
  'endDate',
  'task_id',
  'evaluation_id',
  'evaluation_year',
  'evaluation_period_id',
  'deleted_at',
  'deletedAt',
]);
const TASK_EVALUATION_FIELDS = new Set([
  'contribution_method',
  'contribution_scope',
  'score',
  'feedback',
  'feedback_date',
  'evaluator_name',
  'contributionMethod',
  'contributionScope',
  'feedbackDate',
  'evaluatorName',
]);
const TASK_FIELD_MAP = {
  contributionMethod: 'contribution_method',
  contributionScope: 'contribution_scope',
  feedbackDate: 'feedback_date',
  evaluatorName: 'evaluator_name',
  startDate: 'start_date',
  endDate: 'end_date',
  deletedAt: 'deleted_at',
};
const TASK_EVALUATION_ENTRY_FIELD_MAP = {
  taskUuid: 'task_uuid',
  taskId: 'task_id',
  evaluationId: 'evaluation_id',
  evaluatorId: 'evaluator_id',
  evaluatorName: 'evaluator_name',
  contributionMethod: 'contribution_method',
  contributionScope: 'contribution_scope',
  feedbackDate: 'feedback_date',
};

const normalizeOptionalText = (value) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
};

const getAssignmentActor = (body = {}) =>
  normalizeOptionalText(body.changed_by ?? body.changedBy ?? body.actor_id ?? body.actorId);

const getAssignmentReason = (body = {}) =>
  normalizeOptionalText(body.assignment_change_reason ?? body.change_reason ?? body.reason);

const getAssignmentCancellationReason = (body = {}) =>
  normalizeOptionalText(body.cancel_reason ?? body.reason);

const normalizeImportDate = (value) => {
  const text = normalizeOptionalText(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    return text.slice(0, 10);
  }
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 20000) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    return new Date(excelEpoch + numeric * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

const normalizeMatchingImportRow = (row = {}, index = 0) => {
  const matchingResult = normalizeOptionalText(row.matching_result ?? row.matchingResult ?? row.result);
  const employeeId = normalizeOptionalText(row.employee_id ?? row.employeeId);
  const employeeName = normalizeOptionalText(row.employee_name ?? row.employeeName);
  const evaluatorId = normalizeOptionalText(row.evaluator_id ?? row.evaluatorId);
  const evaluatorName = normalizeOptionalText(row.evaluator_name ?? row.evaluatorName);
  const rowNumber = Number(row.row_number ?? row.rowNumber ?? index + 2);

  let validationStatus = 'valid';
  const messages = [];
  if (!employeeId) messages.push('사번 누락');
  if (!employeeName) messages.push('성명 누락');
  if (!evaluatorId && matchingResult !== '휴직') {
    validationStatus = 'warning';
    messages.push('평가자사번 누락');
  }
  if (employeeId && evaluatorId && employeeId === evaluatorId) {
    validationStatus = 'error';
    messages.push('본인 평가자 매칭');
  }
  if (messages.some((message) => message.includes('누락') && message !== '평가자사번 누락')) {
    validationStatus = 'error';
  }

  return {
    row_number: Number.isInteger(rowNumber) ? rowNumber : index + 2,
    employee_id: employeeId,
    employee_name: employeeName,
    org_sequence: normalizeOptionalText(row.org_sequence ?? row.orgSequence),
    department_id: normalizeOptionalText(row.department_id ?? row.departmentId),
    department_name: normalizeOptionalText(row.department_name ?? row.departmentName),
    work_start_date: normalizeImportDate(row.work_start_date ?? row.workStartDate),
    work_end_date: normalizeImportDate(row.work_end_date ?? row.workEndDate),
    evaluator_id: evaluatorId,
    evaluator_name: evaluatorName,
    confirmer_id: normalizeOptionalText(row.confirmer_id ?? row.confirmerId),
    confirmer_name: normalizeOptionalText(row.confirmer_name ?? row.confirmerName),
    evaluation_type: normalizeOptionalText(row.evaluation_type ?? row.evaluationType),
    matching_result: matchingResult,
    validation_status: validationStatus,
    validation_message: messages.join(', ') || null,
    raw_data: row.raw_data ?? row.rawData ?? row,
  };
};

const compareMatchingImportRows = (a, b) => {
  const score = (row) => ({
    hasEvaluator: row.evaluator_id ? 1 : 0,
    openEnded: row.work_end_date ? 0 : 1,
    hasStart: row.work_start_date ? 1 : 0,
    startTime: row.work_start_date ? Date.parse(row.work_start_date) || 0 : 0,
    sequence: Number(row.org_sequence) || 9999,
  });
  const left = score(a);
  const right = score(b);
  if (left.hasEvaluator !== right.hasEvaluator) return left.hasEvaluator - right.hasEvaluator;
  if (left.openEnded !== right.openEnded) return left.openEnded - right.openEnded;
  if (left.hasStart !== right.hasStart) return left.hasStart - right.hasStart;
  if (left.startTime !== right.startTime) return left.startTime - right.startTime;
  return right.sequence - left.sequence;
};

const selectPrimaryMatchingRows = (rows) => {
  const primaryByEmployee = new Map();
  rows
    .filter((row) => row.validation_status !== 'error' && row.employee_id)
    .forEach((row) => {
      const existing = primaryByEmployee.get(row.employee_id);
      if (!existing || compareMatchingImportRows(row, existing) > 0) {
        primaryByEmployee.set(row.employee_id, row);
      }
    });
  return primaryByEmployee;
};

const getEvaluationContextForEmployee = async (client, employeeId) => {
  try {
    const { rows } = await client.query(
      `
        SELECT
          ev.id AS evaluation_id,
          ev.evaluation_period_id
        FROM evaluations ev
        LEFT JOIN evaluator_assignment_history h
          ON h.evaluation_id = ev.id
          AND h.status = 'cancelled'
        LEFT JOIN evaluation_periods p ON p.id = ev.evaluation_period_id
        WHERE ev.evaluatee_id = $1
          AND COALESCE(ev.record_status, 'active') = 'active'
          AND h.id IS NULL
        ORDER BY
          CASE WHEN p.status = 'active' THEN 0 ELSE 1 END,
          p.is_default DESC NULLS LAST,
          ev.created_at DESC
        LIMIT 1
      `,
      [employeeId]
    );
    return rows[0] ?? { evaluation_id: null, evaluation_period_id: null };
  } catch (err) {
    if (MISSING_PERIOD_SCHEMA_CODES.has(err.code)) {
      return { evaluation_id: null, evaluation_period_id: null };
    }
    throw err;
  }
};

const createDraftEvaluationForEmployeeAssignment = async (client, employee) => {
  const { rows: periodRows } = await client.query(`
    SELECT *
    FROM evaluation_periods
    WHERE status = 'active'
    ORDER BY is_default DESC, starts_on DESC NULLS LAST, created_at DESC
    LIMIT 1
  `);
  const activePeriod = periodRows[0] ?? null;

  const { rows } = await client.query(
    `
      INSERT INTO evaluations (
        evaluatee_id,
        evaluatee_name,
        evaluatee_position,
        evaluatee_department,
        growth_level,
        evaluation_status,
        record_status,
        evaluation_year,
        evaluation_period_id,
        last_modified,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,'draft','active',$6,$7,NOW(),NOW(),NOW())
      RETURNING *
    `,
    [
      employee.employee_id,
      employee.name,
      employee.position,
      employee.department,
      employee.growth_level ?? 0,
      activePeriod?.evaluation_year ?? getCurrentEvaluationYear(),
      activePeriod?.id ?? null,
    ]
  );

  return rows[0] ?? null;
};

const rebuildTaskEvaluationSnapshot = async (client, taskIds = []) => {
  const uniqueTaskIds = [...new Set(taskIds.filter(Boolean))];
  if (uniqueTaskIds.length === 0) return;

  await client.query(
    `
      WITH affected AS (
        SELECT unnest($1::uuid[]) AS task_uuid
      ),
      entry_counts AS (
        SELECT
          tee.task_uuid,
          COUNT(*) AS total_count
        FROM task_evaluation_entries tee
        INNER JOIN affected a ON a.task_uuid = tee.task_uuid
        GROUP BY tee.task_uuid
      ),
      latest AS (
        SELECT DISTINCT ON (tee.task_uuid)
          tee.task_uuid,
          tee.contribution_method,
          tee.contribution_scope,
          tee.score,
          tee.feedback,
          tee.feedback_date,
          tee.evaluator_name
        FROM task_evaluation_entries tee
        INNER JOIN affected a ON a.task_uuid = tee.task_uuid
        WHERE COALESCE(tee.status, 'active') = 'active'
        ORDER BY tee.task_uuid, tee.updated_at DESC, tee.created_at DESC
      )
      UPDATE tasks t
      SET
        contribution_method = CASE WHEN entry_counts.total_count > 0 THEN latest.contribution_method ELSE t.contribution_method END,
        contribution_scope = CASE WHEN entry_counts.total_count > 0 THEN latest.contribution_scope ELSE t.contribution_scope END,
        score = CASE WHEN entry_counts.total_count > 0 THEN latest.score ELSE t.score END,
        feedback = CASE WHEN entry_counts.total_count > 0 THEN latest.feedback ELSE t.feedback END,
        feedback_date = CASE WHEN entry_counts.total_count > 0 THEN latest.feedback_date ELSE t.feedback_date END,
        evaluator_name = CASE WHEN entry_counts.total_count > 0 THEN latest.evaluator_name ELSE t.evaluator_name END
      FROM affected a
      LEFT JOIN entry_counts ON entry_counts.task_uuid = a.task_uuid
      LEFT JOIN latest ON latest.task_uuid = a.task_uuid
      WHERE t.id = a.task_uuid
    `,
    [uniqueTaskIds]
  );
};

const ensureActiveEvaluationForImportedEmployee = async (client, employee) => {
  if (!employee?.employee_id || !employee.evaluator_id) return null;

  const context = await getEvaluationContextForEmployee(client, employee.employee_id);
  if (context.evaluation_id) {
    await client.query(
      `
        UPDATE evaluations
        SET
          evaluatee_name = $2,
          evaluatee_position = $3,
          evaluatee_department = $4,
          growth_level = $5,
          updated_at = NOW()
        WHERE id = $1
      `,
      [
        context.evaluation_id,
        employee.name,
        employee.position,
        employee.department,
        employee.growth_level ?? 0,
      ]
    );
    return null;
  }

  return createDraftEvaluationForEmployeeAssignment(client, employee);
};

const cancelActiveEvaluationsForUnassignedEmployee = async (
  client,
  { employeeId, actorId, reason }
) => {
  const { rows: evaluationRows } = await client.query(
    `
      UPDATE evaluations
      SET record_status = 'cancelled', updated_at = NOW()
      WHERE evaluatee_id = $1
        AND COALESCE(record_status, 'active') = 'active'
      RETURNING id
    `,
    [employeeId]
  );
  const evaluationIds = evaluationRows.map((row) => row.id);
  if (evaluationIds.length === 0) {
    return { cancelledEvaluations: 0, cancelledEntries: 0, cancelledFeedbacks: 0 };
  }

  const { rows: entryRows, rowCount: entryCount } = await client.query(
    `
      UPDATE task_evaluation_entries
      SET
        status = 'cancelled',
        cancelled_at = NOW(),
        cancelled_by = $2,
        cancel_reason = $3,
        updated_at = NOW()
      WHERE evaluation_id = ANY($1::uuid[])
        AND COALESCE(status, 'active') = 'active'
      RETURNING task_uuid
    `,
    [evaluationIds, actorId ?? null, reason || 'Matching import unassigned evaluator']
  );

  const { rowCount: feedbackCount } = await client.query(
    `
      UPDATE feedback_history
      SET
        status = 'cancelled',
        cancelled_at = NOW(),
        cancelled_by = $2,
        cancel_reason = $3
      WHERE evaluation_id = ANY($1::uuid[])
        AND COALESCE(status, 'active') = 'active'
    `,
    [evaluationIds, actorId ?? null, reason || 'Matching import unassigned evaluator']
  );

  await client.query(
    `
      UPDATE final_assessment
      SET deleted_at = COALESCE(deleted_at, NOW())
      WHERE evaluation_id = ANY($1::uuid[])
        AND deleted_at IS NULL
    `,
    [evaluationIds]
  );

  await rebuildTaskEvaluationSnapshot(client, entryRows.map((row) => row.task_uuid));

  return {
    cancelledEvaluations: evaluationIds.length,
    cancelledEntries: entryCount ?? 0,
    cancelledFeedbacks: feedbackCount ?? 0,
  };
};

const insertEvaluatorAssignmentHistory = async (
  client,
  {
    employeeId,
    previousEvaluatorId,
    newEvaluatorId,
    changedBy,
    reason,
    changeType = 'change',
    status = 'applied',
    supersedesHistoryId = null,
    evaluationId = null,
    evaluationPeriodId = null,
  }
) => {
  const normalizedChangeType = ASSIGNMENT_HISTORY_CHANGE_TYPES.has(changeType) ? changeType : 'change';
  const normalizedStatus = ASSIGNMENT_HISTORY_STATUSES.has(status) ? status : 'applied';
  const context =
    evaluationId !== null || evaluationPeriodId !== null
      ? { evaluation_id: evaluationId, evaluation_period_id: evaluationPeriodId }
      : await getEvaluationContextForEmployee(client, employeeId);

  const { rows } = await client.query(
    `
      INSERT INTO evaluator_assignment_history (
        employee_id,
        previous_evaluator_id,
        new_evaluator_id,
        changed_by,
        evaluation_id,
        evaluation_period_id,
        change_type,
        status,
        reason,
        supersedes_history_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `,
    [
      employeeId,
      previousEvaluatorId ?? null,
      newEvaluatorId ?? null,
      changedBy ?? null,
      context.evaluation_id ?? null,
      context.evaluation_period_id ?? null,
      normalizedChangeType,
      normalizedStatus,
      reason ?? null,
      supersedesHistoryId ?? null,
    ]
  );

  return rows[0];
};

const insertAdminAuditLog = async (
  client,
  { actionType, actorId, targetEmployeeId, previousValue, newValue, reason }
) => {
  try {
    await client.query(
      `
        INSERT INTO admin_audit_logs (
          action_type,
          actor_id,
          target_employee_id,
          previous_value,
          new_value,
          reason,
          created_at
        )
        VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,NOW())
      `,
      [
        actionType,
        actorId ?? null,
        targetEmployeeId ?? null,
        JSON.stringify(previousValue ?? null),
        JSON.stringify(newValue ?? null),
        reason ?? null,
      ]
    );
  } catch (err) {
    if (err.code === '42P01') {
      return;
    }
    if (err.code === '23503' && actorId) {
      await insertAdminAuditLog(client, {
        actionType,
        actorId: null,
        targetEmployeeId,
        previousValue,
        newValue,
        reason,
      });
      return;
    }
    throw err;
  }
};

const transferEvaluatorEntriesForCorrection = async (
  client,
  { employeeId, previousEvaluatorId, newEvaluatorId, actorId, reason }
) => {
  if (!previousEvaluatorId || !newEvaluatorId || previousEvaluatorId === newEvaluatorId) {
    return { transferredEntries: [], mergedEntries: [], transferredFeedbackCount: 0 };
  }

  const { rows: evaluatorRows } = await client.query(
    'SELECT name FROM employees WHERE employee_id = $1 LIMIT 1',
    [newEvaluatorId]
  );
  const newEvaluatorName = evaluatorRows[0]?.name ?? newEvaluatorId;

  const { rows: targetEntries } = await client.query(
    `
      SELECT tee.*
      FROM task_evaluation_entries tee
      INNER JOIN evaluations ev ON ev.id = tee.evaluation_id
      WHERE ev.evaluatee_id = $1
        AND COALESCE(ev.record_status, 'active') = 'active'
        AND tee.evaluator_id IS NOT DISTINCT FROM $2
        AND COALESCE(tee.status, 'active') = 'active'
      ORDER BY tee.updated_at DESC, tee.created_at DESC
    `,
    [employeeId, previousEvaluatorId]
  );

  const transferredEntries = [];
  const mergedEntries = [];
  let transferredFeedbackCount = 0;
  const affectedTaskIds = new Set();

  for (const entry of targetEntries) {
    let targetEntry = null;
    await client.query('SAVEPOINT evaluator_entry_transfer');
    try {
      const { rows } = await client.query(
        `
          UPDATE task_evaluation_entries
          SET
            evaluator_id = $2,
            evaluator_name = $3,
            assignment_history_id = NULL,
            status = 'active',
            cancelled_at = NULL,
            cancelled_by = NULL,
            cancel_reason = NULL,
            updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `,
        [entry.id, newEvaluatorId, newEvaluatorName]
      );
      targetEntry = rows[0] ?? null;
      await client.query('RELEASE SAVEPOINT evaluator_entry_transfer');
      if (targetEntry) transferredEntries.push(targetEntry);
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT evaluator_entry_transfer');
      if (err.code !== '23505') {
        throw err;
      }

      const { rows } = await client.query(
        `
          UPDATE task_evaluation_entries
          SET
            evaluator_name = $3,
            contribution_method = $4,
            contribution_scope = $5,
            score = $6,
            feedback = $7,
            feedback_date = $8,
            assignment_history_id = NULL,
            status = 'active',
            cancelled_at = NULL,
            cancelled_by = NULL,
            cancel_reason = NULL,
            updated_at = NOW()
          WHERE task_uuid = $1
            AND evaluator_id IS NOT DISTINCT FROM $2
          RETURNING *
        `,
        [
          entry.task_uuid,
          newEvaluatorId,
          newEvaluatorName,
          entry.contribution_method,
          entry.contribution_scope,
          entry.score,
          entry.feedback,
          entry.feedback_date,
        ]
      );
      targetEntry = rows[0] ?? null;
      if (targetEntry) mergedEntries.push(targetEntry);

      await client.query(
        `
          UPDATE task_evaluation_entries
          SET
            status = 'cancelled',
            cancelled_at = NOW(),
            cancelled_by = $2,
            cancel_reason = $3,
            updated_at = NOW()
          WHERE id = $1
        `,
        [entry.id, actorId ?? null, reason || 'Merged into corrected evaluator']
      );
      await client.query('RELEASE SAVEPOINT evaluator_entry_transfer');
    }

    if (entry.task_uuid) affectedTaskIds.add(entry.task_uuid);
    if (targetEntry?.id) {
      const { rowCount } = await client.query(
        `
          UPDATE feedback_history
          SET
            evaluator_id = $4,
            evaluator_name = $5,
            task_evaluation_entry_id = $6,
            status = 'active',
            cancelled_at = NULL,
            cancelled_by = NULL,
            cancel_reason = NULL
          WHERE task_uuid = $1
            AND COALESCE(status, 'active') = 'active'
            AND (
              task_evaluation_entry_id = $2
              OR evaluator_id IS NOT DISTINCT FROM $3
              OR evaluator_name = $7
            )
        `,
        [
          entry.task_uuid,
          entry.id,
          previousEvaluatorId,
          newEvaluatorId,
          newEvaluatorName,
          targetEntry.id,
          entry.evaluator_name,
        ]
      );
      transferredFeedbackCount += rowCount ?? 0;
    }
  }

  await rebuildTaskEvaluationSnapshot(client, [...affectedTaskIds]);

  return { transferredEntries, mergedEntries, transferredFeedbackCount };
};

const reconcileAssignmentHistoryForDirectEvaluatorEdit = async (
  client,
  { employeeId, currentEvaluatorId, actorId, reason }
) => {
  const { rows } = await client.query(
    `
      WITH anchor AS (
        SELECT id, changed_at
        FROM evaluator_assignment_history
        WHERE employee_id = $1
          AND status = 'applied'
          AND change_type <> 'cancel'
          AND new_evaluator_id IS NOT DISTINCT FROM $2
        ORDER BY changed_at DESC, id DESC
        LIMIT 1
      ),
      latest_mismatch AS (
        SELECT id
        FROM evaluator_assignment_history
        WHERE employee_id = $1
          AND status = 'applied'
          AND change_type <> 'cancel'
          AND new_evaluator_id IS DISTINCT FROM $2
        ORDER BY changed_at DESC, id DESC
        LIMIT 1
      ),
      to_cancel AS (
        SELECT h.id
        FROM evaluator_assignment_history h
        WHERE h.employee_id = $1
          AND h.status = 'applied'
          AND h.change_type <> 'cancel'
          AND h.new_evaluator_id IS DISTINCT FROM $2
          AND (
            EXISTS (
              SELECT 1
              FROM anchor a
              WHERE (h.changed_at, h.id::text) > (a.changed_at, a.id::text)
            )
            OR (
              NOT EXISTS (SELECT 1 FROM anchor)
              AND h.id IN (SELECT id FROM latest_mismatch)
            )
          )
      )
      UPDATE evaluator_assignment_history h
      SET
        status = 'cancelled',
        cancelled_at = NOW(),
        cancelled_by = $3,
        cancel_reason = $4
      FROM to_cancel
      WHERE h.id = to_cancel.id
      RETURNING h.*
    `,
    [employeeId, currentEvaluatorId ?? null, actorId ?? null, reason || 'HR evaluator edit']
  );

  return rows;
};

const createPeriodWriteError = (status) =>
  Object.assign(
    new Error(`Evaluation period is ${status}; writes are disabled.`),
    { statusCode: 423 }
  );

const createEvaluationStructureWriteError = (status) =>
  Object.assign(
    new Error(`Evaluation is ${status}; task structure is locked.`),
    { statusCode: 423 }
  );

const createEvaluationValueWriteError = (status) =>
  Object.assign(
    new Error(`Evaluation is ${status}; evaluation values can only be edited after evaluatee submission.`),
    { statusCode: 423 }
  );

const hasTaskStructureChanges = (updates = {}) =>
  Object.keys(updates).some((key) => {
    const dbKey = TASK_FIELD_MAP[key] ?? key;
    return TASK_STRUCTURE_FIELDS.has(key) || TASK_STRUCTURE_FIELDS.has(dbKey);
  });

const hasTaskEvaluationContentChanges = (updates = {}) =>
  Object.entries(updates).some(([key, value]) => {
    const dbKey = TASK_FIELD_MAP[key] ?? key;
    if (!TASK_EVALUATION_FIELDS.has(key) && !TASK_EVALUATION_FIELDS.has(dbKey)) {
      return false;
    }
    if (value === undefined || value === null) {
      return false;
    }
    return typeof value === 'string' ? value.trim().length > 0 : true;
  });

const normalizePeriodPayload = (body, { partial = false } = {}) => {
  const output = {};

  if (!partial || Object.prototype.hasOwnProperty.call(body, 'evaluation_year')) {
    const year = Number(body.evaluation_year);
    if (!Number.isInteger(year)) {
      throw Object.assign(new Error('evaluation_year must be an integer'), { statusCode: 400 });
    }
    output.evaluation_year = year;
  }

  const yearForDefaults = output.evaluation_year ?? getCurrentEvaluationYear();

  if (!partial || Object.prototype.hasOwnProperty.call(body, 'code')) {
    const code = String(body.code ?? '').trim() || `${yearForDefaults}-annual`;
    output.code = code;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = String(body.name ?? '').trim() || `${yearForDefaults} Annual Evaluation`;
    output.name = name;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(body, 'starts_on')) {
    output.starts_on = body.starts_on || null;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(body, 'ends_on')) {
    output.ends_on = body.ends_on || null;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(body, 'status')) {
    const status = String(body.status ?? 'draft');
    if (!PERIOD_STATUSES.has(status)) {
      throw Object.assign(new Error('Invalid evaluation period status'), { statusCode: 400 });
    }
    output.status = status;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(body, 'is_default')) {
    output.is_default = Boolean(body.is_default);
  }

  return output;
};

const savePeriodWithActivationRules = async (client, period, id = null) => {
  const shouldActivate = period.status === 'active' || period.is_default === true;
  const payload = { ...period };

  if (shouldActivate) {
    await client.query(`
      UPDATE evaluation_periods
      SET
        is_default = false,
        status = CASE WHEN status = 'active' THEN 'closed' ELSE status END,
        updated_at = NOW()
      WHERE ($1::uuid IS NULL OR id <> $1::uuid)
    `, [id]);
    payload.status = 'active';
    payload.is_default = true;
  } else if (payload.status && payload.status !== 'active') {
    payload.is_default = false;
  }

  const columns = Object.keys(payload);
  if (columns.length === 0) {
    throw Object.assign(new Error('No period fields to update'), { statusCode: 400 });
  }

  if (!id) {
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await client.query(
      `INSERT INTO evaluation_periods (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      Object.values(payload)
    );
    return rows[0];
  }

  const setClause = columns.map((column, i) => `${column} = $${i + 1}`).join(', ');
  const values = [...Object.values(payload), id];
  const { rows } = await client.query(
    `UPDATE evaluation_periods SET ${setClause}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
    values
  );

  if (!rows[0]) {
    throw Object.assign(new Error('Evaluation period not found'), { statusCode: 404 });
  }

  return rows[0];
};

const assertPeriodWritableById = async (periodId) => {
  if (!periodId || !isDbAvailable || !pool?.query) {
    return;
  }

  try {
    const { rows } = await pool.query(
      'SELECT status FROM evaluation_periods WHERE id = $1',
      [periodId]
    );
    const status = rows[0]?.status;
    if (status && NON_WRITABLE_PERIOD_STATUSES.has(status)) {
      throw createPeriodWriteError(status);
    }
  } catch (err) {
    if (err.statusCode || !MISSING_PERIOD_SCHEMA_CODES.has(err.code)) {
      throw err;
    }
  }
};

const assertEvaluationWritableById = async (evaluationId) => {
  if (!evaluationId || !isDbAvailable || !pool?.query) {
    return;
  }

  try {
    const { rows } = await pool.query(
      `
        SELECT
          p.status AS period_status,
          e.record_status,
          cancelled_assignment.id AS cancelled_assignment_id
        FROM evaluations e
        LEFT JOIN evaluation_periods p ON p.id = e.evaluation_period_id
        LEFT JOIN evaluator_assignment_history cancelled_assignment
          ON cancelled_assignment.evaluation_id = e.id
          AND cancelled_assignment.status = 'cancelled'
        WHERE e.id = $1
        LIMIT 1
      `,
      [evaluationId]
    );
    const row = rows[0];
    if (row?.record_status === 'cancelled' || row?.cancelled_assignment_id) {
      throw Object.assign(new Error('Evaluation is cancelled; writes are disabled.'), { statusCode: 423 });
    }
    const status = row?.period_status;
    if (status && NON_WRITABLE_PERIOD_STATUSES.has(status)) {
      throw createPeriodWriteError(status);
    }
  } catch (err) {
    if (err.statusCode || !MISSING_PERIOD_SCHEMA_CODES.has(err.code)) {
      throw err;
    }
  }
};

const assertEvaluationTaskStructureEditableById = async (evaluationId) => {
  if (!evaluationId || !isDbAvailable || !pool?.query) {
    return;
  }

  try {
    const { rows } = await pool.query(
      `
        SELECT
          e.evaluation_status,
          e.record_status,
          cancelled_assignment.id AS cancelled_assignment_id
        FROM evaluations e
        LEFT JOIN evaluator_assignment_history cancelled_assignment
          ON cancelled_assignment.evaluation_id = e.id
          AND cancelled_assignment.status = 'cancelled'
        WHERE e.id = $1
        LIMIT 1
      `,
      [evaluationId]
    );
    const row = rows[0];
    if (row?.record_status === 'cancelled' || row?.cancelled_assignment_id) {
      throw Object.assign(new Error('Evaluation is cancelled; writes are disabled.'), { statusCode: 423 });
    }
    const status = row?.evaluation_status;
    if (status && TASK_STRUCTURE_LOCKED_EVALUATION_STATUSES.has(status)) {
      throw createEvaluationStructureWriteError(status);
    }
  } catch (err) {
    if (err.statusCode || !MISSING_PERIOD_SCHEMA_CODES.has(err.code)) {
      throw err;
    }
  }
};

const assertTaskWritableById = async (taskId) => {
  if (!taskId || !isDbAvailable || !pool?.query) {
    return;
  }

  try {
    const { rows } = await pool.query(
      `
        SELECT
          p.status AS period_status,
          e.record_status,
          cancelled_assignment.id AS cancelled_assignment_id
        FROM tasks t
        LEFT JOIN evaluations e ON e.id = t.evaluation_id
        LEFT JOIN evaluation_periods p ON p.id = t.evaluation_period_id
        LEFT JOIN evaluator_assignment_history cancelled_assignment
          ON cancelled_assignment.evaluation_id = e.id
          AND cancelled_assignment.status = 'cancelled'
        WHERE t.id = $1
        LIMIT 1
      `,
      [taskId]
    );
    const row = rows[0];
    if (row?.record_status === 'cancelled' || row?.cancelled_assignment_id) {
      throw Object.assign(new Error('Evaluation is cancelled; writes are disabled.'), { statusCode: 423 });
    }
    const status = row?.period_status;
    if (status && NON_WRITABLE_PERIOD_STATUSES.has(status)) {
      throw createPeriodWriteError(status);
    }
  } catch (err) {
    if (err.statusCode || !MISSING_PERIOD_SCHEMA_CODES.has(err.code)) {
      throw err;
    }
  }
};

const assertTaskStructureEditableById = async (taskId) => {
  if (!taskId || !isDbAvailable || !pool?.query) {
    return;
  }

  try {
    const { rows } = await pool.query(
      `
        SELECT
          e.evaluation_status,
          e.record_status,
          cancelled_assignment.id AS cancelled_assignment_id
        FROM tasks t
        LEFT JOIN evaluations e ON e.id = t.evaluation_id
        LEFT JOIN evaluator_assignment_history cancelled_assignment
          ON cancelled_assignment.evaluation_id = e.id
          AND cancelled_assignment.status = 'cancelled'
        WHERE t.id = $1
        LIMIT 1
      `,
      [taskId]
    );
    const row = rows[0];
    if (row?.record_status === 'cancelled' || row?.cancelled_assignment_id) {
      throw Object.assign(new Error('Evaluation is cancelled; writes are disabled.'), { statusCode: 423 });
    }
    const status = row?.evaluation_status;
    if (status && TASK_STRUCTURE_LOCKED_EVALUATION_STATUSES.has(status)) {
      throw createEvaluationStructureWriteError(status);
    }
  } catch (err) {
    if (err.statusCode || !MISSING_PERIOD_SCHEMA_CODES.has(err.code)) {
      throw err;
    }
  }
};

const assertTaskEvaluationEditableById = async (taskId) => {
  if (!taskId || !isDbAvailable || !pool?.query) {
    return;
  }

  try {
    const { rows } = await pool.query(
      `
        SELECT
          e.evaluation_status,
          e.record_status,
          cancelled_assignment.id AS cancelled_assignment_id
        FROM tasks t
        LEFT JOIN evaluations e ON e.id = t.evaluation_id
        LEFT JOIN evaluator_assignment_history cancelled_assignment
          ON cancelled_assignment.evaluation_id = e.id
          AND cancelled_assignment.status = 'cancelled'
        WHERE t.id = $1
        LIMIT 1
      `,
      [taskId]
    );
    const row = rows[0];
    if (row?.record_status === 'cancelled' || row?.cancelled_assignment_id) {
      throw Object.assign(new Error('Evaluation is cancelled; writes are disabled.'), { statusCode: 423 });
    }
    const status = row?.evaluation_status;
    if (status && !TASK_EVALUATION_EDITABLE_STATUSES.has(status)) {
      throw createEvaluationValueWriteError(status);
    }
  } catch (err) {
    if (err.statusCode || !MISSING_PERIOD_SCHEMA_CODES.has(err.code)) {
      throw err;
    }
  }
};

const assertTaskWritableByTaskId = async (taskId) => {
  if (!taskId || !isDbAvailable || !pool?.query) {
    return;
  }

  try {
    const { rows } = await pool.query(
      `
        SELECT
          p.status AS period_status,
          e.record_status,
          cancelled_assignment.id AS cancelled_assignment_id
        FROM tasks t
        LEFT JOIN evaluations e ON e.id = t.evaluation_id
        LEFT JOIN evaluation_periods p ON p.id = t.evaluation_period_id
        LEFT JOIN evaluator_assignment_history cancelled_assignment
          ON cancelled_assignment.evaluation_id = e.id
          AND cancelled_assignment.status = 'cancelled'
        WHERE t.task_id = $1
        LIMIT 1
      `,
      [taskId]
    );
    const row = rows[0];
    if (row?.record_status === 'cancelled' || row?.cancelled_assignment_id) {
      throw Object.assign(new Error('Evaluation is cancelled; writes are disabled.'), { statusCode: 423 });
    }
    const status = row?.period_status;
    if (status && NON_WRITABLE_PERIOD_STATUSES.has(status)) {
      throw createPeriodWriteError(status);
    }
  } catch (err) {
    if (err.statusCode || !MISSING_PERIOD_SCHEMA_CODES.has(err.code)) {
      throw err;
    }
  }
};

const assertTaskEvaluationEditableByTaskId = async (taskId) => {
  if (!taskId || !isDbAvailable || !pool?.query) {
    return;
  }

  try {
    const { rows } = await pool.query(
      `
        SELECT
          e.evaluation_status,
          e.record_status,
          cancelled_assignment.id AS cancelled_assignment_id
        FROM tasks t
        LEFT JOIN evaluations e ON e.id = t.evaluation_id
        LEFT JOIN evaluator_assignment_history cancelled_assignment
          ON cancelled_assignment.evaluation_id = e.id
          AND cancelled_assignment.status = 'cancelled'
        WHERE t.task_id = $1
        LIMIT 1
      `,
      [taskId]
    );
    const row = rows[0];
    if (row?.record_status === 'cancelled' || row?.cancelled_assignment_id) {
      throw Object.assign(new Error('Evaluation is cancelled; writes are disabled.'), { statusCode: 423 });
    }
    const status = row?.evaluation_status;
    if (status && !TASK_EVALUATION_EDITABLE_STATUSES.has(status)) {
      throw createEvaluationValueWriteError(status);
    }
  } catch (err) {
    if (err.statusCode || !MISSING_PERIOD_SCHEMA_CODES.has(err.code)) {
      throw err;
    }
  }
};

const normalizeNullableText = (value) => {
  if (value === undefined || value === null) return null;
  const text = String(value);
  return text.trim() ? text : null;
};

const normalizeTaskEvaluationEntryPayload = (body = {}) => {
  const payload = {};

  for (const [key, value] of Object.entries(body)) {
    const dbKey = TASK_EVALUATION_ENTRY_FIELD_MAP[key] ?? key;
    payload[dbKey] = value;
  }

  return {
    task_uuid: normalizeNullableText(payload.task_uuid),
    task_id: normalizeNullableText(payload.task_id),
    evaluation_id: normalizeNullableText(payload.evaluation_id),
    evaluator_id: normalizeNullableText(payload.evaluator_id),
    evaluator_name: normalizeNullableText(payload.evaluator_name),
    contribution_method: normalizeNullableText(payload.contribution_method),
    contribution_scope: normalizeNullableText(payload.contribution_scope),
    score:
      payload.score === undefined || payload.score === null || payload.score === ''
        ? null
        : Number(payload.score),
    feedback: normalizeNullableText(payload.feedback),
    feedback_date: payload.feedback_date || null,
  };
};

const normalizeFeedbackPayload = (body = {}) => ({
  task_id: normalizeNullableText(body.task_id ?? body.taskId),
  task_uuid: normalizeNullableText(body.task_uuid ?? body.taskUuid),
  evaluation_id: normalizeNullableText(body.evaluation_id ?? body.evaluationId),
  evaluator_id: normalizeNullableText(body.evaluator_id ?? body.evaluatorId),
  task_evaluation_entry_id: normalizeNullableText(
    body.task_evaluation_entry_id ?? body.taskEvaluationEntryId
  ),
  content: normalizeNullableText(body.content),
  evaluator_name: normalizeNullableText(body.evaluator_name ?? body.evaluatorName),
  status: body.status === 'cancelled' ? 'cancelled' : 'active',
});

const getTaskForEvaluationEntry = async (client, payload) => {
  if (!payload.task_uuid && !payload.task_id) {
    throw Object.assign(new Error('task_uuid or task_id is required'), { statusCode: 400 });
  }

  const { rows } = await client.query(
    `
      SELECT
        t.id,
        t.task_id,
        t.evaluation_id,
        e.evaluation_status,
        e.record_status,
        cancelled_assignment.id AS cancelled_assignment_id,
        p.status AS period_status
      FROM tasks t
      LEFT JOIN evaluations e ON e.id = t.evaluation_id
      LEFT JOIN evaluator_assignment_history cancelled_assignment
        ON cancelled_assignment.evaluation_id = e.id
        AND cancelled_assignment.status = 'cancelled'
      LEFT JOIN evaluation_periods p ON p.id = t.evaluation_period_id
      WHERE
        ($1::text IS NOT NULL AND t.id::text = $1)
        OR ($2::text IS NOT NULL AND t.task_id = $2)
      LIMIT 1
    `,
    [payload.task_uuid, payload.task_id]
  );

  const task = rows[0];
  if (!task) {
    throw Object.assign(new Error('Task not found'), { statusCode: 404 });
  }

  if (payload.evaluation_id && task.evaluation_id !== payload.evaluation_id) {
    throw Object.assign(new Error('Task does not belong to the requested evaluation'), { statusCode: 400 });
  }

  if (task.period_status && NON_WRITABLE_PERIOD_STATUSES.has(task.period_status)) {
    throw createPeriodWriteError(task.period_status);
  }

  if (task.record_status === 'cancelled' || task.cancelled_assignment_id) {
    throw Object.assign(new Error('Evaluation is cancelled; writes are disabled.'), { statusCode: 423 });
  }

  if (task.evaluation_status && !TASK_EVALUATION_EDITABLE_STATUSES.has(task.evaluation_status)) {
    throw createEvaluationValueWriteError(task.evaluation_status);
  }

  return task;
};

const assertTaskEvaluationEntryEditable = async (client, task, payload) => {
  const [{ rows: evaluationRows }, { rows: entryRows }] = await Promise.all([
    client.query(
      `
        SELECT
          e.evaluatee_id,
          emp.evaluator_id AS assigned_evaluator_id
        FROM evaluations e
        LEFT JOIN employees emp ON emp.employee_id = e.evaluatee_id
        WHERE e.id = $1
        LIMIT 1
      `,
      [task.evaluation_id]
    ),
    client.query(
      `
        SELECT evaluator_id, evaluator_name
        FROM task_evaluation_entries
        WHERE evaluation_id = $1
          AND COALESCE(status, 'active') = 'active'
      `,
      [task.evaluation_id]
    ),
  ]);

  const evaluation = evaluationRows[0];
  const isAssignedEvaluator = evaluation?.assigned_evaluator_id === payload.evaluator_id;
  const ownsAnyEntry = entryRows.some(
    (entry) =>
      entry.evaluator_id === payload.evaluator_id ||
      (entry.evaluator_id?.startsWith('legacy:') && entry.evaluator_name === payload.evaluator_name)
  );

  if (ownsAnyEntry || isAssignedEvaluator) {
    return;
  }

  throw Object.assign(
    new Error('This evaluation has entries owned by another evaluator; only that evaluator can edit them.'),
    { statusCode: 423 }
  );
};

const getAssignmentHistoryIdForEvaluationEntry = async (client, task, payload) => {
  try {
    const { rows } = await client.query(
      `
        SELECT h.id
        FROM evaluator_assignment_history h
        INNER JOIN evaluations ev ON ev.evaluatee_id = h.employee_id
        WHERE ev.id = $1
          AND h.new_evaluator_id = $2
          AND h.status = 'applied'
          AND h.change_type <> 'cancel'
          AND (h.evaluation_id IS NULL OR h.evaluation_id = ev.id)
        ORDER BY h.changed_at DESC, h.id DESC
        LIMIT 1
      `,
      [task.evaluation_id, payload.evaluator_id]
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    if (MISSING_PERIOD_SCHEMA_CODES.has(err.code)) {
      return null;
    }
    throw err;
  }
};

const assertFeedbackWritableById = async (feedbackId) => {
  if (!feedbackId || !isDbAvailable || !pool?.query) {
    return;
  }

  try {
    const { rows } = await pool.query(
      `
        SELECT
          p.status AS period_status,
          f.status AS feedback_status,
          e.record_status,
          cancelled_assignment.id AS cancelled_assignment_id
        FROM feedback_history f
        LEFT JOIN tasks t ON t.id = f.task_uuid OR t.task_id = f.task_id
        LEFT JOIN evaluations e ON e.id = COALESCE(f.evaluation_id, t.evaluation_id)
        LEFT JOIN evaluator_assignment_history cancelled_assignment
          ON cancelled_assignment.evaluation_id = e.id
          AND cancelled_assignment.status = 'cancelled'
        LEFT JOIN evaluation_periods p ON p.id = t.evaluation_period_id
        WHERE f.id = $1
        LIMIT 1
      `,
      [feedbackId]
    );
    const row = rows[0];
    if (
      row?.feedback_status === 'cancelled' ||
      row?.record_status === 'cancelled' ||
      row?.cancelled_assignment_id
    ) {
      throw Object.assign(new Error('Feedback is cancelled; writes are disabled.'), { statusCode: 423 });
    }
    const status = row?.period_status;
    if (status && NON_WRITABLE_PERIOD_STATUSES.has(status)) {
      throw createPeriodWriteError(status);
    }
  } catch (err) {
    if (err.statusCode || !MISSING_PERIOD_SCHEMA_CODES.has(err.code)) {
      throw err;
    }
  }
};

// Create Express app
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use((req, res, next) => {
  if (req.headers['content-type']?.includes('application/json')) {
    let rawData = '';
    req.on('data', chunk => {
      rawData += chunk;
    });
    req.on('end', () => {
      // Replace any CR/LF characters that would break JSON parsing
      const sanitized = rawData.replace(/[\r\n]+/g, ' ');
      try {
        req.body = JSON.parse(sanitized);
        next();
      } catch (err) {
        console.error('??JSON parse error (sanitized):', err);
        res.status(400).json({ error: 'Invalid JSON payload' });
      }
    });
  } else {
    next();
  }
});

/* ==================== Employee Routes ==================== */

// Get single employee by ID
app.get('/api/employee/:id', async (req, res) => {
  if (!isDbAvailable) {
    const employee = getMockEmployeeById(req.params.id);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    return res.json(employee);
  }

  try {
    const { rows } = await pool.query(
      'SELECT * FROM employees WHERE employee_id::text = $1',
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching employee:', err);
    const employee = getMockEmployeeById(req.params.id);
    if (employee) {
      return res.json(employee);
    }
    res.status(500).json({ error: 'Database error' });
  }
});

// Get all employees
app.get('/api/employees', async (req, res) => {
  if (!isDbAvailable) {
    return res.json([...mockEmployees].sort((a, b) => a.name.localeCompare(b.name)));
  }

  try {
    const { rows } = await pool.query('SELECT * FROM employees ORDER BY name');
    res.json(rows);
  } catch (err) {
    console.error('Error fetching employees:', err);
    res.json([...mockEmployees].sort((a, b) => a.name.localeCompare(b.name)));
  }
});

// Get employees by evaluator ID
app.get('/api/employees/evaluator/:evaluatorId', async (req, res) => {
  if (!isDbAvailable) {
    return res.json(getMockEmployeesByEvaluator(req.params.evaluatorId));
  }

  try {
    const { rows } = await pool.query(
      'SELECT * FROM employees WHERE evaluator_id = $1 ORDER BY name',
      [req.params.evaluatorId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching employees by evaluator:', err);
    res.json(getMockEmployeesByEvaluator(req.params.evaluatorId));
  }
});

// Get employees who used to be assigned to an evaluator, or have entries owned by that evaluator.
app.get('/api/employees/former-evaluator/:evaluatorId', async (req, res) => {
  if (!isDbAvailable) {
    return res.json([]);
  }

  try {
    const { rows } = await pool.query(
      `
        SELECT DISTINCT e.*
        FROM employees e
        LEFT JOIN evaluator_assignment_history h
          ON h.employee_id = e.employee_id
          AND h.previous_evaluator_id = $1
          AND h.status = 'applied'
          AND h.change_type <> 'cancel'
        LEFT JOIN evaluations ev
          ON ev.evaluatee_id = e.employee_id
        LEFT JOIN task_evaluation_entries tee
          ON tee.evaluation_id = ev.id
          AND tee.evaluator_id = $1
          AND COALESCE(tee.status, 'active') = 'active'
        WHERE
          (e.evaluator_id IS DISTINCT FROM $1)
          AND (h.id IS NOT NULL OR tee.id IS NOT NULL)
        ORDER BY e.department, e.name
      `,
      [req.params.evaluatorId]
    );
    res.json(rows);
  } catch (err) {
    if (MISSING_PERIOD_SCHEMA_CODES.has(err.code)) {
      return res.json([]);
    }
    console.error('Error fetching former evaluatees:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get employees by department
app.get('/api/employees/department/:dept', async (req, res) => {
  if (!isDbAvailable) {
    return res.json(getMockEmployeesByDepartment(req.params.dept));
  }

  try {
    const { rows } = await pool.query(
      'SELECT * FROM employees WHERE department = $1 ORDER BY name',
      [req.params.dept]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching employees by department:', err);
    res.json(getMockEmployeesByDepartment(req.params.dept));
  }
});

app.get('/api/matching-imports', async (req, res) => {
  if (!isDbAvailable) {
    return res.json([]);
  }

  try {
    const { rows } = await pool.query(
      `
        SELECT *
        FROM matching_import_batches
        ORDER BY created_at DESC
        LIMIT 20
      `
    );
    res.json(rows);
  } catch (err) {
    if (MISSING_PERIOD_SCHEMA_CODES.has(err.code)) {
      return res.json([]);
    }
    console.error('Error fetching matching imports:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/matching-imports', async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }

  const sourceFileName = normalizeOptionalText(req.body?.source_file_name ?? req.body?.sourceFileName);
  const sourceSheetName = normalizeOptionalText(req.body?.source_sheet_name ?? req.body?.sourceSheetName);
  const requestedImportedBy = getAssignmentActor(req.body);
  const rawRows = Array.isArray(req.body?.rows) ? req.body.rows : [];

  if (!sourceFileName) {
    return res.status(400).json({ error: 'source_file_name is required' });
  }
  if (rawRows.length === 0) {
    return res.status(400).json({ error: 'rows are required' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let importedBy = requestedImportedBy;
    if (importedBy) {
      const { rows: actorRows } = await client.query(
        'SELECT employee_id FROM employees WHERE employee_id = $1 LIMIT 1',
        [importedBy]
      );
      if (!actorRows[0]) importedBy = null;
    }

    const normalizedRows = rawRows.map((row, index) => normalizeMatchingImportRow(row, index));
    const primaryByEmployee = selectPrimaryMatchingRows(normalizedRows);
    const primaryRows = [...primaryByEmployee.values()];
    const primaryIds = new Set(primaryRows.map((row) => row.employee_id));
    const evaluatorRefs = new Map();
    normalizedRows.forEach((row) => {
      if (row.evaluator_id) {
        evaluatorRefs.set(row.evaluator_id, row.evaluator_name ?? row.evaluator_id);
      }
    });

    const employeeIds = primaryRows.map((row) => row.employee_id);
    const existingEmployees = new Map();
    if (employeeIds.length > 0) {
      const { rows } = await client.query(
        'SELECT employee_id, evaluator_id FROM employees WHERE employee_id = ANY($1::text[])',
        [employeeIds]
      );
      rows.forEach((employee) => existingEmployees.set(employee.employee_id, employee));
    }

    const { rows: batchRows } = await client.query(
      `
        INSERT INTO matching_import_batches (
          source_file_name,
          source_sheet_name,
          imported_by,
          row_count,
          status
        )
        VALUES ($1,$2,$3,$4,'applied')
        RETURNING *
      `,
      [sourceFileName, sourceSheetName, importedBy, normalizedRows.length]
    );
    const batch = batchRows[0];

    for (const row of normalizedRows) {
      await client.query(
        `
          INSERT INTO matching_import_rows (
            batch_id,
            row_number,
            employee_id,
            employee_name,
            org_sequence,
            department_id,
            department_name,
            work_start_date,
            work_end_date,
            evaluator_id,
            evaluator_name,
            confirmer_id,
            confirmer_name,
            evaluation_type,
            matching_result,
            is_primary,
            validation_status,
            validation_message,
            raw_data
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)
        `,
        [
          batch.id,
          row.row_number,
          row.employee_id,
          row.employee_name,
          row.org_sequence,
          row.department_id,
          row.department_name,
          row.work_start_date,
          row.work_end_date,
          row.evaluator_id,
          row.evaluator_name,
          row.confirmer_id,
          row.confirmer_name,
          row.evaluation_type,
          row.matching_result,
          primaryIds.has(row.employee_id) && primaryByEmployee.get(row.employee_id) === row,
          row.validation_status,
          row.validation_message,
          JSON.stringify(row.raw_data ?? {}),
        ]
      );
    }

    for (const [evaluatorId, evaluatorName] of evaluatorRefs.entries()) {
      await client.query(
        `
          INSERT INTO employees (
            employee_id,
            name,
            position,
            department,
            available_roles,
            created_at,
            updated_at
          )
          VALUES ($1,$2,'평가자','미지정',ARRAY['evaluator']::text[],NOW(),NOW())
          ON CONFLICT (employee_id) DO UPDATE SET
            name = COALESCE(EXCLUDED.name, employees.name),
            available_roles = (
              SELECT array_agg(role ORDER BY CASE role WHEN 'evaluatee' THEN 1 WHEN 'evaluator' THEN 2 WHEN 'hr' THEN 3 ELSE 9 END)
              FROM (
                SELECT DISTINCT role
                FROM unnest(
                EXCLUDED.available_roles ||
                CASE
                  WHEN 'hr' = ANY(employees.available_roles) THEN ARRAY['hr']::text[]
                  ELSE ARRAY[]::text[]
                END
                ) AS roles(role)
              ) AS unique_roles
            ),
            updated_at = NOW()
        `,
        [evaluatorId, evaluatorName]
      );
    }

    let changedEvaluatorCount = 0;
    let transferredEntries = 0;
    let mergedEntries = 0;
    let transferredFeedbacks = 0;
    let reconciledHistories = 0;
    let createdEvaluations = 0;
    let cancelledEvaluations = 0;
    let cancelledEntries = 0;
    let cancelledFeedbacks = 0;

    for (const row of primaryRows) {
      const employeeRoles = evaluatorRefs.has(row.employee_id)
        ? ['evaluatee', 'evaluator']
        : ['evaluatee'];
      const department = row.department_name ?? '미지정';
      const { rows: upsertedEmployeeRows } = await client.query(
        `
          INSERT INTO employees (
            employee_id,
            name,
            position,
            department,
            department_id,
            growth_level,
            evaluator_id,
            available_roles,
            org_sequence,
            work_start_date,
            work_end_date,
            evaluation_type,
            matching_result,
            confirmer_id,
            confirmer_name,
            last_matching_batch_id,
            created_at,
            updated_at
          )
          VALUES ($1,$2,'구성원',$3,$4,NULL,$5,$6::text[],$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
          ON CONFLICT (employee_id) DO UPDATE SET
            name = EXCLUDED.name,
            department = EXCLUDED.department,
            department_id = EXCLUDED.department_id,
            evaluator_id = EXCLUDED.evaluator_id,
            available_roles = (
              SELECT array_agg(role ORDER BY CASE role WHEN 'evaluatee' THEN 1 WHEN 'evaluator' THEN 2 WHEN 'hr' THEN 3 ELSE 9 END)
              FROM (
                SELECT DISTINCT role
                FROM unnest(
                EXCLUDED.available_roles ||
                CASE
                  WHEN 'hr' = ANY(employees.available_roles) THEN ARRAY['hr']::text[]
                  ELSE ARRAY[]::text[]
                END
                ) AS roles(role)
              ) AS unique_roles
            ),
            org_sequence = EXCLUDED.org_sequence,
            work_start_date = EXCLUDED.work_start_date,
            work_end_date = EXCLUDED.work_end_date,
            evaluation_type = EXCLUDED.evaluation_type,
            matching_result = EXCLUDED.matching_result,
            confirmer_id = EXCLUDED.confirmer_id,
            confirmer_name = EXCLUDED.confirmer_name,
            last_matching_batch_id = EXCLUDED.last_matching_batch_id,
            updated_at = NOW()
          RETURNING *
        `,
        [
          row.employee_id,
          row.employee_name,
          department,
          row.department_id,
          row.evaluator_id,
          employeeRoles,
          row.org_sequence,
          row.work_start_date,
          row.work_end_date,
          row.evaluation_type,
          row.matching_result,
          row.confirmer_id,
          row.confirmer_name,
          batch.id,
        ]
      );
      const upsertedEmployee = upsertedEmployeeRows[0] ?? null;

      const previousEvaluatorId = existingEmployees.get(row.employee_id)?.evaluator_id ?? null;
      if (row.evaluator_id) {
        const createdEvaluation = await ensureActiveEvaluationForImportedEmployee(
          client,
          upsertedEmployee
        );
        if (createdEvaluation) createdEvaluations += 1;
      } else {
        const cancelled = await cancelActiveEvaluationsForUnassignedEmployee(client, {
          employeeId: row.employee_id,
          actorId: importedBy,
          reason: `Matching import: ${sourceFileName}`,
        });
        cancelledEvaluations += cancelled.cancelledEvaluations;
        cancelledEntries += cancelled.cancelledEntries;
        cancelledFeedbacks += cancelled.cancelledFeedbacks;
      }

      if ((previousEvaluatorId ?? null) !== (row.evaluator_id ?? null)) {
        changedEvaluatorCount += 1;
        const result = await transferEvaluatorEntriesForCorrection(client, {
          employeeId: row.employee_id,
          previousEvaluatorId,
          newEvaluatorId: row.evaluator_id ?? null,
          actorId: importedBy,
          reason: `Matching import: ${sourceFileName}`,
        });
        const historyRows = await reconcileAssignmentHistoryForDirectEvaluatorEdit(client, {
          employeeId: row.employee_id,
          currentEvaluatorId: row.evaluator_id ?? null,
          actorId: importedBy,
          reason: `Matching import: ${sourceFileName}`,
        });
        transferredEntries += result.transferredEntries.length;
        mergedEntries += result.mergedEntries.length;
        transferredFeedbacks += result.transferredFeedbackCount;
        reconciledHistories += historyRows.length;
      }
    }

    const warningCount = normalizedRows.filter((row) => row.validation_status === 'warning').length;
    const errorCount = normalizedRows.filter((row) => row.validation_status === 'error').length;
    const { rows: updatedBatchRows } = await client.query(
      `
        UPDATE matching_import_batches
        SET
          applied_count = $2,
          warning_count = $3,
          error_count = $4
        WHERE id = $1
        RETURNING *
      `,
      [batch.id, primaryRows.length, warningCount, errorCount]
    );

    await insertAdminAuditLog(client, {
      actionType: 'matching_import',
      actorId: importedBy,
      targetEmployeeId: null,
      previousValue: { source_file_name: sourceFileName },
      newValue: {
        batch_id: batch.id,
        row_count: normalizedRows.length,
        applied_count: primaryRows.length,
        evaluator_count: evaluatorRefs.size,
        created_evaluations: createdEvaluations,
        cancelled_evaluations: cancelledEvaluations,
      },
      reason: `Matching import: ${sourceFileName}`,
    });

    await client.query('COMMIT');
    res.json({
      batch: updatedBatchRows[0],
      row_count: normalizedRows.length,
      applied_count: primaryRows.length,
      evaluator_count: evaluatorRefs.size,
      changed_evaluator_count: changedEvaluatorCount,
      warning_count: warningCount,
      error_count: errorCount,
      transferred_entries: transferredEntries,
      merged_entries: mergedEntries,
      transferred_feedbacks: transferredFeedbacks,
      reconciled_histories: reconciledHistories,
      created_evaluations: createdEvaluations,
      cancelled_evaluations: cancelledEvaluations,
      cancelled_entries: cancelledEntries,
      cancelled_feedbacks: cancelledFeedbacks,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error importing matching file:', err);
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

// Update employee (partial)
app.put('/api/employee/:id', async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }

  const updates = req.body ?? {};
  const updateEntries = Object.entries(updates).filter(([key]) => EMPLOYEE_UPDATE_FIELDS.has(key));

  if (updateEntries.length === 0) {
    return res.status(400).json({ error: 'No supported employee fields were provided' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: existingRows } = await client.query(
      'SELECT * FROM employees WHERE employee_id = $1 FOR UPDATE',
      [req.params.id]
    );
    const existingEmployee = existingRows[0];
    if (!existingEmployee) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Employee not found' });
    }

    const setClauses = [];
    const values = [];
    let idx = 1;
    for (const [key, value] of updateEntries) {
      setClauses.push(`${key} = $${idx}`);
      values.push(value);
      idx++;
    }
    setClauses.push('updated_at = NOW()');
    values.push(req.params.id);

    const { rows } = await client.query(
      `
        UPDATE employees
        SET ${setClauses.join(', ')}
        WHERE employee_id = $${idx}
        RETURNING *
      `,
      values
    );

    const updatedEmployee = rows[0];
    const evaluatorChanged =
      Object.prototype.hasOwnProperty.call(updates, 'evaluator_id') &&
      (existingEmployee.evaluator_id ?? null) !== (updates.evaluator_id ?? null);

    if (evaluatorChanged) {
      const assignmentEvaluation =
        updatedEmployee.evaluator_id == null
          ? null
          : await createDraftEvaluationForEmployeeAssignment(client, updatedEmployee);
      const assignmentHistory = await insertEvaluatorAssignmentHistory(client, {
        employeeId: req.params.id,
        previousEvaluatorId: existingEmployee.evaluator_id ?? null,
        newEvaluatorId: updates.evaluator_id ?? null,
        changedBy: getAssignmentActor(updates),
        reason: getAssignmentReason(updates),
        changeType: 'change',
        evaluationId: assignmentEvaluation?.id ?? null,
        evaluationPeriodId: assignmentEvaluation?.evaluation_period_id ?? null,
      });
      if (assignmentEvaluation?.id && assignmentHistory?.id) {
        await client.query(
          'UPDATE evaluations SET assignment_history_id = $2, updated_at = NOW() WHERE id = $1',
          [assignmentEvaluation.id, assignmentHistory.id]
        );
      }
    }

    await client.query('COMMIT');
    res.json(updatedEmployee);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error updating employee:', err);
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

app.post('/api/employee/:id/evaluator-edit', async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }

  const evaluatorId = normalizeOptionalText(req.body?.evaluator_id ?? req.body?.evaluatorId);
  const actorId = getAssignmentActor(req.body);
  const reason = getAssignmentReason(req.body) || 'HR evaluator edit';

  if (evaluatorId === req.params.id) {
    return res.status(400).json({ error: 'Employee cannot evaluate themselves' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: existingRows } = await client.query(
      'SELECT * FROM employees WHERE employee_id = $1 FOR UPDATE',
      [req.params.id]
    );
    const existingEmployee = existingRows[0];
    if (!existingEmployee) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Employee not found' });
    }

    if (evaluatorId) {
      const { rows: evaluatorRows } = await client.query(
        'SELECT employee_id FROM employees WHERE employee_id = $1 LIMIT 1',
        [evaluatorId]
      );
      if (!evaluatorRows[0]) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Evaluator not found' });
      }
    }

    const previousEvaluatorId = existingEmployee.evaluator_id ?? null;
    const { rows: updatedRows } = await client.query(
      `
        UPDATE employees
        SET evaluator_id = $2, updated_at = NOW()
        WHERE employee_id = $1
        RETURNING *
      `,
      [req.params.id, evaluatorId ?? null]
    );
    const updatedEmployee = updatedRows[0];

    const correctionResult = await transferEvaluatorEntriesForCorrection(client, {
      employeeId: req.params.id,
      previousEvaluatorId,
      newEvaluatorId: evaluatorId ?? null,
      actorId,
      reason,
    });
    const reconciledHistories = await reconcileAssignmentHistoryForDirectEvaluatorEdit(client, {
      employeeId: req.params.id,
      currentEvaluatorId: evaluatorId ?? null,
      actorId,
      reason,
    });

    await insertAdminAuditLog(client, {
      actionType: 'evaluator_edit',
      actorId,
      targetEmployeeId: req.params.id,
      previousValue: { evaluator_id: previousEvaluatorId },
      newValue: { evaluator_id: evaluatorId ?? null },
      reason,
    });

    await client.query('COMMIT');
    res.json({
      employee: updatedEmployee,
      transferred_entries: correctionResult.transferredEntries.length,
      merged_entries: correctionResult.mergedEntries.length,
      transferred_feedbacks: correctionResult.transferredFeedbackCount,
      reconciled_histories: reconciledHistories.length,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error editing evaluator:', err);
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

app.get('/api/evaluator-assignment-history/employee/:employeeId', async (req, res) => {
  if (!isDbAvailable) {
    return res.json([]);
  }

  try {
    const { rows } = await pool.query(
      `
        SELECT
          h.*,
          prev.name AS previous_evaluator_name,
          next.name AS new_evaluator_name,
          actor.name AS changed_by_name,
          cancel_actor.name AS cancelled_by_name,
          p.name AS evaluation_period_name,
          p.evaluation_year
        FROM evaluator_assignment_history h
        LEFT JOIN employees prev ON prev.employee_id = h.previous_evaluator_id
        LEFT JOIN employees next ON next.employee_id = h.new_evaluator_id
        LEFT JOIN employees actor ON actor.employee_id = h.changed_by
        LEFT JOIN employees cancel_actor ON cancel_actor.employee_id = h.cancelled_by
        LEFT JOIN evaluation_periods p ON p.id = h.evaluation_period_id
        WHERE h.employee_id = $1
        ORDER BY h.changed_at DESC, h.id DESC
      `,
      [req.params.employeeId]
    );
    res.json(rows);
  } catch (err) {
    if (MISSING_PERIOD_SCHEMA_CODES.has(err.code)) {
      return res.json([]);
    }
    console.error('Error fetching evaluator assignment history:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/evaluator-assignment-history/:id/cancel', async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `
        SELECT h.*, e.evaluator_id AS current_evaluator_id
        FROM evaluator_assignment_history h
        INNER JOIN employees e ON e.employee_id = h.employee_id
        WHERE h.id = $1
        FOR UPDATE OF h, e
      `,
      [req.params.id]
    );
    const history = rows[0];
    if (!history) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Assignment history not found' });
    }
    if (history.status === 'cancelled') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Assignment history is already cancelled' });
    }
    if (history.change_type === 'cancel') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cancellation events cannot be cancelled' });
    }

    const { rows: latestRows } = await client.query(
      `
        SELECT id
        FROM evaluator_assignment_history
        WHERE employee_id = $1
          AND status = 'applied'
          AND change_type <> 'cancel'
        ORDER BY changed_at DESC, id DESC
        LIMIT 1
      `,
      [history.employee_id]
    );
    if (latestRows[0]?.id !== history.id) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Only the latest applied assignment can be cancelled' });
    }

    const cancelledBy = getAssignmentActor(req.body);
    const cancelReason = getAssignmentCancellationReason(req.body);

    const { rows: cancelledRows } = await client.query(
      `
        UPDATE evaluator_assignment_history
        SET
          status = 'cancelled',
          cancelled_at = NOW(),
          cancelled_by = $2,
          cancel_reason = $3
        WHERE id = $1
        RETURNING *
      `,
      [history.id, cancelledBy, cancelReason]
    );

    if (history.evaluation_id) {
      await client.query(
        `
          UPDATE evaluations
          SET
            record_status = 'cancelled',
            updated_at = NOW()
          WHERE id = $1
        `,
        [history.evaluation_id]
      );
    }

    let updatedEmployee = null;
    if ((history.current_evaluator_id ?? null) === (history.new_evaluator_id ?? null)) {
      const { rows: employeeRows } = await client.query(
        `
          UPDATE employees
          SET evaluator_id = $2, updated_at = NOW()
          WHERE employee_id = $1
          RETURNING *
        `,
        [history.employee_id, history.previous_evaluator_id ?? null]
      );
      updatedEmployee = employeeRows[0] ?? null;
    }

    const { rows: cancelledEntryRows } = await client.query(
      `
        UPDATE task_evaluation_entries tee
        SET
          status = 'cancelled',
          assignment_history_id = COALESCE(tee.assignment_history_id, $1),
          cancelled_at = NOW(),
          cancelled_by = $2,
          cancel_reason = $3,
          updated_at = NOW()
        FROM evaluations ev
        WHERE ev.id = tee.evaluation_id
          AND ev.evaluatee_id = $4
          AND tee.evaluator_id IS NOT DISTINCT FROM $5
          AND COALESCE(tee.status, 'active') = 'active'
          AND (
            tee.assignment_history_id IS NULL
            OR tee.assignment_history_id = $1
            OR tee.evaluation_id = $6::uuid
          )
        RETURNING tee.task_uuid
      `,
      [
        history.id,
        cancelledBy,
        cancelReason,
        history.employee_id,
        history.new_evaluator_id ?? null,
        history.evaluation_id ?? null,
      ]
    );

    const affectedTaskIds = [
      ...new Set(cancelledEntryRows.map((entry) => entry.task_uuid).filter(Boolean)),
    ];
    await rebuildTaskEvaluationSnapshot(client, affectedTaskIds);

    const { rows: evaluatorRows } = await client.query(
      'SELECT name FROM employees WHERE employee_id = $1 LIMIT 1',
      [history.new_evaluator_id]
    );
    const cancelledEvaluatorName = evaluatorRows[0]?.name ?? null;
    await client.query(
      `
        UPDATE feedback_history fh
        SET
          status = 'cancelled',
          cancelled_at = NOW(),
          cancelled_by = $2,
          cancel_reason = $3
        FROM tasks t
        INNER JOIN evaluations ev ON ev.id = t.evaluation_id
        WHERE fh.task_id = t.task_id
          AND ev.evaluatee_id = $4
          AND COALESCE(fh.status, 'active') = 'active'
          AND (
            fh.task_evaluation_entry_id IN (
              SELECT id
              FROM task_evaluation_entries
              WHERE assignment_history_id = $1
                 OR evaluator_id IS NOT DISTINCT FROM $5
            )
            OR fh.evaluator_id IS NOT DISTINCT FROM $5
            OR ($6::text IS NOT NULL AND fh.evaluator_name = $6)
          )
      `,
      [
        history.id,
        cancelledBy,
        cancelReason,
        history.employee_id,
        history.new_evaluator_id ?? null,
        cancelledEvaluatorName,
      ]
    );

    await client.query('COMMIT');
    res.json({
      cancelled: cancelledRows[0],
      employee: updatedEmployee,
      cancelled_entries: cancelledEntryRows.length,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error cancelling evaluator assignment:', err);
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});
// Get evaluation by employee ID (latest)
app.get('/api/evaluations/by-employee/:employeeId', async (req, res) => {
  if (!isDbAvailable) {
    return res.json(null);
  }

  try {
    // Simple query ??the `evaluations` table has an `id` column.
    // No `evaluation_id` column exists, so we just select all fields.
    const filter = await resolveEvaluationPeriodFilter(req.query, 2);
    const { rows } = await pool.query(
      `
        SELECT ev.*
        FROM evaluations ev
        LEFT JOIN employees emp ON emp.employee_id = ev.evaluatee_id
        LEFT JOIN evaluator_assignment_history assignment
          ON assignment.id = ev.assignment_history_id
        LEFT JOIN evaluator_assignment_history h
          ON h.evaluation_id = ev.id
          AND h.employee_id = ev.evaluatee_id
          AND h.status = 'cancelled'
        WHERE ev.evaluatee_id = $1
          AND ${filter.clause.replaceAll('evaluation_period_id', 'ev.evaluation_period_id').replaceAll('evaluation_year', 'ev.evaluation_year')}
          AND COALESCE(ev.record_status, 'active') = 'active'
          AND h.id IS NULL
        ORDER BY
          CASE
            WHEN assignment.status = 'applied' AND assignment.new_evaluator_id IS NOT DISTINCT FROM emp.evaluator_id THEN 0
            WHEN assignment.id IS NULL THEN 1
            ELSE 2
          END,
          ev.created_at DESC
        LIMIT 1
      `,
      [req.params.employeeId, ...filter.values]
    );
    res.json(rows[0] ?? null);
  } catch (err) {
    console.error('Error fetching evaluation by employee:', err);
    res.json(null);
  }
});

app.get('/api/evaluator-mappings', async (req, res) => {
  try {
    // Fetch evaluator?멷valuatee mappings using the employees table.
    // The evaluator_id column references another employee (the evaluator).
    const query = `
      SELECT
        ev.name AS "evaluatorName",
        ev.department AS "evaluatorDepartment",
        e.name AS "evaluateeName",
        e.department AS "evaluateeDepartment",
        '' AS "evaluationPeriod",
        'active' AS "status"
      FROM employees e
      LEFT JOIN employees ev ON e.evaluator_id = ev.employee_id
      WHERE e.evaluator_id IS NOT NULL
    `;
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching evaluator mappings:', err);
    res.status(500).json({ error: 'Database error' });
  }
});
// POST endpoint to bulk update evaluator?멷valuatee mappings (used for migration from localStorage)
app.post('/api/evaluator-mappings', async (req, res) => {
  try {
    const mappings = req.body; // Expected: array of objects with evaluatorName & evaluateeName
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const m of mappings) {
        // Find evaluator employee_id by name
        const { rows: evRows } = await client.query(
          'SELECT employee_id FROM employees WHERE name = $1',
          [m.evaluatorName]
        );
        if (evRows.length === 0) {
          console.warn(`Evaluator not found for name: ${m.evaluatorName}`);
          continue;
        }
        const evaluatorId = evRows[0].employee_id;

        // Update evaluatee's evaluator_id
        await client.query(
          'UPDATE employees SET evaluator_id = $1 WHERE name = $2',
          [evaluatorId, m.evaluateeName]
        );
      }
      await client.query('COMMIT');
      res.json({ success: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error updating evaluator mappings:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

/* ==================== Evaluation Routes ==================== */

app.get('/api/evaluation-periods', async (req, res) => {
  if (!isDbAvailable) {
    return res.json([]);
  }

  try {
    const { rows } = await pool.query(
      'SELECT * FROM evaluation_periods ORDER BY evaluation_year DESC, starts_on DESC NULLS LAST, created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching evaluation periods:', err);
    res.json([]);
  }
});

app.get('/api/evaluation-periods/current', async (req, res) => {
  try {
    const period = await getActiveEvaluationPeriod();
    res.json(period);
  } catch (err) {
    console.error('Error fetching current evaluation period:', err);
    res.json(null);
  }
});

app.post('/api/evaluation-periods', async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }

  const client = await pool.connect();
  try {
    const payload = normalizePeriodPayload(req.body);
    await client.query('BEGIN');
    const period = await savePeriodWithActivationRules(client, payload);
    await client.query('COMMIT');
    res.status(201).json(period);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error creating evaluation period:', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Evaluation period code already exists' });
    }
    res.status(err.statusCode ?? 500).json({ error: err.message ?? 'Database error' });
  } finally {
    client.release();
  }
});

app.put('/api/evaluation-periods/:id', async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }

  const client = await pool.connect();
  try {
    const payload = normalizePeriodPayload(req.body, { partial: true });
    await client.query('BEGIN');
    const period = await savePeriodWithActivationRules(client, payload, req.params.id);
    await client.query('COMMIT');
    res.json(period);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error updating evaluation period:', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Evaluation period code already exists' });
    }
    res.status(err.statusCode ?? 500).json({ error: err.message ?? 'Database error' });
  } finally {
    client.release();
  }
});

app.get('/api/evaluations', async (req, res) => {
  try {
    const filter = await resolveEvaluationPeriodFilter(req.query);
    const { rows } = await pool.query(
      `
        SELECT ev.*
        FROM evaluations ev
        LEFT JOIN evaluator_assignment_history h
          ON h.evaluation_id = ev.id
          AND h.status = 'cancelled'
        WHERE ${filter.clause.replaceAll('evaluation_period_id', 'ev.evaluation_period_id').replaceAll('evaluation_year', 'ev.evaluation_year')}
          AND COALESCE(ev.record_status, 'active') = 'active'
          AND h.id IS NULL
        ORDER BY ev.evaluatee_name
      `,
      filter.values
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching evaluations:', err);
    res.json([]);
  }
});
// Get evaluations for a specific employee
app.get('/api/evaluations/employee/:employeeId', async (req, res) => {
  try {
    const filter = await resolveEvaluationPeriodFilter(req.query, 2);
    const { rows } = await pool.query(
      `
        SELECT ev.*
        FROM evaluations ev
        LEFT JOIN evaluator_assignment_history h
          ON h.evaluation_id = ev.id
          AND h.employee_id = ev.evaluatee_id
          AND h.status = 'cancelled'
        WHERE ev.evaluatee_id = $1
          AND ${filter.clause.replaceAll('evaluation_period_id', 'ev.evaluation_period_id').replaceAll('evaluation_year', 'ev.evaluation_year')}
          AND COALESCE(ev.record_status, 'active') = 'active'
          AND h.id IS NULL
        ORDER BY ev.created_at DESC
      `,
      [req.params.employeeId, ...filter.values]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching evaluations for employee:', err);
    res.json([]);
  }
});

app.get('/api/evaluation/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT ev.*
        FROM evaluations ev
        LEFT JOIN evaluator_assignment_history h
          ON h.evaluation_id = ev.id
          AND h.status = 'cancelled'
        WHERE ev.id = $1
          AND COALESCE(ev.record_status, 'active') = 'active'
          AND h.id IS NULL
        LIMIT 1
      `,
      [req.params.id]
    );
    res.json(rows[0] ?? null);
  } catch (err) {
    console.error('Error fetching evaluation:', err);
    res.json(null);
  }
});

app.post('/api/evaluation', async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }

  try {
    const evaluation = await attachDefaultEvaluationPeriod(req.body);
    if (evaluation.evaluatee_id) {
      const existingFilter = evaluation.evaluation_period_id
        ? {
            clause: 'evaluatee_id = $1 AND evaluation_period_id = $2',
            values: [evaluation.evaluatee_id, evaluation.evaluation_period_id],
          }
        : {
            clause: 'evaluatee_id = $1 AND evaluation_year = $2',
            values: [evaluation.evaluatee_id, evaluation.evaluation_year],
          };
      const { rows: existingRows } = await pool.query(
        `
          SELECT ev.*
          FROM evaluations ev
          LEFT JOIN evaluator_assignment_history h
            ON h.evaluation_id = ev.id
            AND h.status = 'cancelled'
          WHERE ${existingFilter.clause.replaceAll('evaluation_period_id', 'ev.evaluation_period_id').replaceAll('evaluation_year', 'ev.evaluation_year').replaceAll('evaluatee_id', 'ev.evaluatee_id')}
            AND COALESCE(ev.record_status, 'active') = 'active'
            AND h.id IS NULL
          ORDER BY ev.created_at DESC
          LIMIT 1
        `,
        existingFilter.values
      );
      if (existingRows[0]) {
        return res.json(existingRows[0]);
      }
    }
    await assertPeriodWritableById(evaluation.evaluation_period_id);

    const cols = Object.keys(evaluation);
    const vals = Object.values(evaluation);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await pool.query(
      `INSERT INTO evaluations (${cols.join(',')}) VALUES (${placeholders}) RETURNING *`,
      vals
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error creating evaluation:', err);
    res.status(err.statusCode ?? 500).json({ error: err.message ?? 'Database error' });
  }
});

app.put('/api/evaluation/:id', async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }

  try {
    await assertEvaluationWritableById(req.params.id);
    const updates = req.body;
    const set = Object.keys(updates)
      .map((k, i) => `${k} = $${i + 1}`)
      .join(', ');
    const values = [...Object.values(updates), req.params.id];
    const { rows } = await pool.query(
      `UPDATE evaluations SET ${set}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
      values
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating evaluation:', err);
    res.status(err.statusCode ?? 500).json({ error: err.message ?? 'Database error' });
  }
});

app.delete('/api/evaluation/:id', async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }

  try {
    await assertEvaluationWritableById(req.params.id);
    const { rowCount } = await pool.query('DELETE FROM evaluations WHERE id = $1', [req.params.id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Evaluation not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting evaluation:', err);
    res.status(err.statusCode ?? 500).json({ error: err.message ?? 'Database error' });
  }
});
// Get evaluations by status ('in-progress' or 'completed')
app.get('/api/evaluations/status/:status', async (req, res) => {
  try {
    const filter = await resolveEvaluationPeriodFilter(req.query, 2);
    const { rows } = await pool.query(
      `
        SELECT ev.*
        FROM evaluations ev
        LEFT JOIN evaluator_assignment_history h
          ON h.evaluation_id = ev.id
          AND h.status = 'cancelled'
        WHERE ev.evaluation_status = $1
          AND ${filter.clause.replaceAll('evaluation_period_id', 'ev.evaluation_period_id').replaceAll('evaluation_year', 'ev.evaluation_year')}
          AND COALESCE(ev.record_status, 'active') = 'active'
          AND h.id IS NULL
        ORDER BY ev.created_at DESC
      `,
      [req.params.status, ...filter.values]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching evaluations by status:', err);
    res.status(500).json({ error: 'Database error' });
  }
});
// Get tasks by evaluation ID
app.get('/api/tasks/evaluation/:evaluationId', async (req, res) => {
  if (!isDbAvailable) {
    return res.json([]);
  }

  try {
    const { rows } = await pool.query(
      `
        SELECT
          t.id,
          t.task_id,
          t.evaluation_id,
          t.title,
          t.weight,
          t.description,
          t.start_date,
          t.end_date,
          CASE WHEN entry_counts.total_count > 0 THEN latest.contribution_method ELSE t.contribution_method END AS contribution_method,
          CASE WHEN entry_counts.total_count > 0 THEN latest.contribution_scope ELSE t.contribution_scope END AS contribution_scope,
          CASE WHEN entry_counts.total_count > 0 THEN latest.score ELSE t.score END AS score,
          CASE WHEN entry_counts.total_count > 0 THEN latest.feedback ELSE t.feedback END AS feedback,
          CASE WHEN entry_counts.total_count > 0 THEN latest.feedback_date ELSE t.feedback_date END AS feedback_date,
          CASE WHEN entry_counts.total_count > 0 THEN latest.evaluator_name ELSE t.evaluator_name END AS evaluator_name,
          t.created_at,
          t.deleted_at,
          t.evaluation_year,
          t.evaluation_period_id
        FROM tasks t
        INNER JOIN evaluations ev ON ev.id = t.evaluation_id
        LEFT JOIN evaluator_assignment_history h
          ON h.evaluation_id = ev.id
          AND h.status = 'cancelled'
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS total_count
          FROM task_evaluation_entries tee
          WHERE tee.task_uuid = t.id
        ) entry_counts ON true
        LEFT JOIN LATERAL (
          SELECT
            tee.contribution_method,
            tee.contribution_scope,
            tee.score,
            tee.feedback,
            tee.feedback_date,
            tee.evaluator_name
          FROM task_evaluation_entries tee
          WHERE tee.task_uuid = t.id
            AND COALESCE(tee.status, 'active') = 'active'
          ORDER BY tee.updated_at DESC, tee.created_at DESC
          LIMIT 1
        ) latest ON true
        WHERE t.evaluation_id = $1
          AND COALESCE(ev.record_status, 'active') = 'active'
          AND h.id IS NULL
        ORDER BY t.created_at DESC
      `,
      [req.params.evaluationId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching tasks by evaluation:', err);
    res.json([]);
  }
});

// Get tasks for the active evaluation period, with year fallback for legacy data.
app.get('/api/tasks/current-year', async (req, res) => {
  if (!isDbAvailable) {
    return res.json([]);
  }

  try {
    const filter = await resolveEvaluationPeriodFilter(req.query);
    const { rows } = await pool.query(
      `
        SELECT
          t.id,
          t.task_id,
          t.evaluation_id,
          t.title,
          t.weight,
          t.description,
          t.start_date,
          t.end_date,
          CASE WHEN entry_counts.total_count > 0 THEN latest.contribution_method ELSE t.contribution_method END AS contribution_method,
          CASE WHEN entry_counts.total_count > 0 THEN latest.contribution_scope ELSE t.contribution_scope END AS contribution_scope,
          CASE WHEN entry_counts.total_count > 0 THEN latest.score ELSE t.score END AS score,
          CASE WHEN entry_counts.total_count > 0 THEN latest.feedback ELSE t.feedback END AS feedback,
          CASE WHEN entry_counts.total_count > 0 THEN latest.feedback_date ELSE t.feedback_date END AS feedback_date,
          CASE WHEN entry_counts.total_count > 0 THEN latest.evaluator_name ELSE t.evaluator_name END AS evaluator_name,
          t.created_at,
          t.deleted_at,
          t.evaluation_year,
          t.evaluation_period_id
        FROM tasks t
        INNER JOIN evaluations ev ON ev.id = t.evaluation_id
        LEFT JOIN evaluator_assignment_history h
          ON h.evaluation_id = ev.id
          AND h.status = 'cancelled'
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS total_count
          FROM task_evaluation_entries tee
          WHERE tee.task_uuid = t.id
        ) entry_counts ON true
        LEFT JOIN LATERAL (
          SELECT
            tee.contribution_method,
            tee.contribution_scope,
            tee.score,
            tee.feedback,
            tee.feedback_date,
            tee.evaluator_name
          FROM task_evaluation_entries tee
          WHERE tee.task_uuid = t.id
            AND COALESCE(tee.status, 'active') = 'active'
          ORDER BY tee.updated_at DESC, tee.created_at DESC
          LIMIT 1
        ) latest ON true
        WHERE ${filter.clause.replaceAll('evaluation_period_id', 't.evaluation_period_id').replaceAll('evaluation_year', 't.evaluation_year')}
          AND COALESCE(ev.record_status, 'active') = 'active'
          AND h.id IS NULL
        ORDER BY t.created_at DESC
      `,
      filter.values
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching tasks for current year:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get evaluator-specific task evaluation entries by evaluation ID
app.get('/api/task-evaluation-entries/evaluation/:evaluationId', async (req, res) => {
  if (!isDbAvailable) {
    return res.json([]);
  }

  try {
    const { rows } = await pool.query(
      `
        SELECT tee.*
        FROM task_evaluation_entries tee
        INNER JOIN tasks t ON t.id = tee.task_uuid
        INNER JOIN evaluations ev ON ev.id = tee.evaluation_id
        LEFT JOIN evaluator_assignment_history h
          ON h.evaluation_id = ev.id
          AND h.status = 'cancelled'
        WHERE tee.evaluation_id = $1
          AND COALESCE(tee.status, 'active') = 'active'
          AND COALESCE(ev.record_status, 'active') = 'active'
          AND h.id IS NULL
        ORDER BY tee.updated_at DESC, tee.created_at DESC
      `,
      [req.params.evaluationId]
    );
    res.json(rows);
  } catch (err) {
    if (MISSING_PERIOD_SCHEMA_CODES.has(err.code)) {
      return res.json([]);
    }
    console.error('Error fetching task evaluation entries:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Upsert the current evaluator's score/feedback without overwriting other evaluators' entries.
app.put('/api/task-evaluation-entry', async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }

  const payload = normalizeTaskEvaluationEntryPayload(req.body);

  if (!payload.evaluator_id || !payload.evaluator_name) {
    return res.status(400).json({ error: 'evaluator_id and evaluator_name are required' });
  }

  if (payload.score !== null && !Number.isFinite(payload.score)) {
    return res.status(400).json({ error: 'score must be a number or null' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const task = await getTaskForEvaluationEntry(client, payload);
    await assertTaskEvaluationEntryEditable(client, task, payload);
    const assignmentHistoryId = await getAssignmentHistoryIdForEvaluationEntry(client, task, payload);

    const entryValues = [
      task.id,
      task.task_id,
      task.evaluation_id,
      payload.evaluator_id,
      payload.evaluator_name,
      payload.contribution_method,
      payload.contribution_scope,
      payload.score,
      payload.feedback,
      payload.feedback_date,
      assignmentHistoryId,
    ];

    const { rows } = await client.query(
      `
        INSERT INTO task_evaluation_entries (
          task_uuid,
          task_id,
          evaluation_id,
          evaluator_id,
          evaluator_name,
          contribution_method,
          contribution_scope,
          score,
          feedback,
          feedback_date,
          assignment_history_id,
          status
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::timestamptz, NOW()),$11,'active')
        ON CONFLICT (task_uuid, evaluator_id) DO UPDATE SET
          evaluator_name = EXCLUDED.evaluator_name,
          contribution_method = EXCLUDED.contribution_method,
          contribution_scope = EXCLUDED.contribution_scope,
          score = EXCLUDED.score,
          feedback = EXCLUDED.feedback,
          feedback_date = EXCLUDED.feedback_date,
          assignment_history_id = COALESCE(EXCLUDED.assignment_history_id, task_evaluation_entries.assignment_history_id),
          status = 'active',
          cancelled_at = NULL,
          cancelled_by = NULL,
          cancel_reason = NULL,
          updated_at = NOW()
        RETURNING *
      `,
      entryValues
    );

    await rebuildTaskEvaluationSnapshot(client, [task.id]);

    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error upserting task evaluation entry:', err);
    res.status(err.statusCode ?? 500).json({ error: err.message ?? 'Database error' });
  } finally {
    client.release();
  }
});
// Create a new task
app.post('/api/task', async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }

  try {
    const task = await attachTaskEvaluationPeriod(req.body);
    if (task.evaluation_id) {
      await assertEvaluationWritableById(task.evaluation_id);
      await assertEvaluationTaskStructureEditableById(task.evaluation_id);
    } else {
      await assertPeriodWritableById(task.evaluation_period_id);
    }
    // Build dynamic INSERT based on provided fields
    const cols = Object.keys(task);
    const vals = Object.values(task);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await pool.query(
      `INSERT INTO tasks (${cols.join(',')}) VALUES (${placeholders}) RETURNING *`,
      vals
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error creating task:', err);
    res.status(err.statusCode ?? 500).json({ error: err.message ?? 'Database error' });
  }
});

// ==================== Task Update / Delete Routes ====================

// Update an existing task (partial update)
app.put('/api/task/:id', async (req, res) => {
  try {
    await assertTaskWritableById(req.params.id);
    const updates = req.body;
    if (hasTaskStructureChanges(updates)) {
      await assertTaskStructureEditableById(req.params.id);
    }
    if (hasTaskEvaluationContentChanges(updates)) {
      await assertTaskEvaluationEditableById(req.params.id);
    }

    const setClauses = [];
    const values = [];
    let idx = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) continue; // skip undefined
      // Translate key if needed
      const dbKey = TASK_FIELD_MAP[key] ?? key;
      // Skip attempts to modify a non?멷xistent updated_at column
      if (dbKey === 'updated_at') continue;
      setClauses.push(`${dbKey} = $${idx}`);
      values.push(value);
      idx++;
    }

    if (setClauses.length === 0) {
      console.warn('?좑툘 No valid fields provided for task update.');
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Use the raw task ID (UUID string) as provided
    const taskId = req.params.id;

    const query = `
      UPDATE tasks
      SET ${setClauses.join(', ')}
      WHERE id = $${idx}
      RETURNING *;
    `;
    values.push(taskId);


    const { rows } = await pool.query(query, values);
    if (rows.length === 0) {
      console.warn('?좑툘 Task not found for id:', taskId);
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating task:', err);
    res.status(err.statusCode ?? 500).json({ error: err.message ?? 'Database error' });
  }
});

// Soft?멶elete a task (set deleted_at timestamp) ??PATCH endpoint
app.patch('/api/task/:id', async (req, res) => {
  try {
    await assertTaskWritableById(req.params.id);
    await assertTaskStructureEditableById(req.params.id);
    const { rowCount } = await pool.query(
      'UPDATE tasks SET deleted_at = NOW() WHERE id = $1',
      [req.params.id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    // Soft?멶elete successful
    res.json({ success: true });
  } catch (err) {
    console.error('Error soft deleting task:', err);
    res.status(err.statusCode ?? 500).json({ error: err.message ?? 'Database error' });
  }
});

// Hard delete a task (remove task and related feedback) ??retained for legacy use
app.delete('/api/task/:id', async (req, res) => {
  try {
    await assertTaskWritableById(req.params.id);
    await assertTaskStructureEditableById(req.params.id);
    // 1. Retrieve the task to obtain its human?몉eadable task_id
    const taskResult = await pool.query(
      'SELECT task_id FROM tasks WHERE id = $1',
      [req.params.id]
    );
    if (taskResult.rowCount === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    const taskId = taskResult.rows[0].task_id;

    // 2. Delete associated feedback_history rows first to avoid FK violations
    await pool.query(
      'DELETE FROM feedback_history WHERE task_id = $1',
      [taskId]
    );

    // 3. Delete the task itself
    const { rows } = await pool.query(
      `DELETE FROM tasks
       WHERE id = $1
       RETURNING *`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    // Deletion successful
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting task:', err);
    res.status(err.statusCode ?? 500).json({ error: err.message ?? 'Database error' });
  }
});

/* ==================== Feedback Routes ==================== */

app.get('/api/feedbacks', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT fh.*
        FROM feedback_history fh
        LEFT JOIN evaluations ev ON ev.id = fh.evaluation_id
        LEFT JOIN evaluator_assignment_history h
          ON h.evaluation_id = ev.id
          AND h.status = 'cancelled'
        WHERE COALESCE(fh.status, 'active') = 'active'
          AND (ev.id IS NULL OR COALESCE(ev.record_status, 'active') = 'active')
          AND h.id IS NULL
        ORDER BY fh.created_at DESC
      `
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching feedbacks:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/feedback/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT fh.*
        FROM feedback_history fh
        LEFT JOIN evaluations ev ON ev.id = fh.evaluation_id
        LEFT JOIN evaluator_assignment_history h
          ON h.evaluation_id = ev.id
          AND h.status = 'cancelled'
        WHERE fh.id = $1
          AND COALESCE(fh.status, 'active') = 'active'
          AND (ev.id IS NULL OR COALESCE(ev.record_status, 'active') = 'active')
          AND h.id IS NULL
        LIMIT 1
      `,
      [req.params.id]
    );
    res.json(rows[0] ?? null);
  } catch (err) {
    console.error('Error fetching feedback:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/feedback', async (req, res) => {
  try {
    const payload = normalizeFeedbackPayload(req.body);
    if (!payload.task_id || !payload.content) {
      return res.status(400).json({ error: 'task_id and content are required' });
    }

    await assertTaskWritableByTaskId(payload.task_id);
    await assertTaskEvaluationEditableByTaskId(payload.task_id);

    if (!payload.task_uuid || !payload.evaluation_id) {
      const { rows: taskRows } = await pool.query(
        'SELECT id, evaluation_id FROM tasks WHERE task_id = $1 LIMIT 1',
        [payload.task_id]
      );
      payload.task_uuid = payload.task_uuid ?? taskRows[0]?.id ?? null;
      payload.evaluation_id = payload.evaluation_id ?? taskRows[0]?.evaluation_id ?? null;
    }

    const cols = [
      'task_id',
      'task_uuid',
      'evaluation_id',
      'evaluator_id',
      'task_evaluation_entry_id',
      'content',
      'evaluator_name',
      'status',
    ];
    const vals = cols.map((column) => payload[column]);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await pool.query(
      `INSERT INTO feedback_history (${cols.join(',')}) VALUES (${placeholders}) RETURNING *`,
      vals
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error creating feedback:', err);
    res.status(err.statusCode ?? 500).json({ error: err.message ?? 'Database error' });
  }
});

app.delete('/api/feedback/:id', async (req, res) => {
  try {
    await assertFeedbackWritableById(req.params.id);
    const { rowCount } = await pool.query('DELETE FROM feedback_history WHERE id = $1', [req.params.id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Feedback not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting feedback:', err);
    res.status(err.statusCode ?? 500).json({ error: err.message ?? 'Database error' });
  }
});
// Get feedback history by task ID
app.get('/api/feedbacks/task/:taskId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT fh.*
        FROM feedback_history fh
        LEFT JOIN evaluations ev ON ev.id = fh.evaluation_id
        LEFT JOIN evaluator_assignment_history h
          ON h.evaluation_id = ev.id
          AND h.status = 'cancelled'
        WHERE fh.task_id = $1
          AND COALESCE(fh.status, 'active') = 'active'
          AND (ev.id IS NULL OR COALESCE(ev.record_status, 'active') = 'active')
          AND h.id IS NULL
        ORDER BY fh.created_at DESC
      `,
      [req.params.taskId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching feedbacks by task:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

/* ==================== Notification Routes ==================== */

app.get('/api/notifications', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM notifications ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    console.error('Error fetching notifications:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/notification/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM notifications WHERE id = $1', [req.params.id]);
    res.json(rows[0] ?? null);
  } catch (err) {
    console.error('Error fetching notification:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/notification', async (req, res) => {
  try {
    // ----- Validation -----
    const {
      notification_type,
      title,
      message,
      priority,
      sender_id,
      sender_name,
      recipient_id,
      related_evaluation_id,
      related_task_id,
    } = req.body;
    // ----- Validate related IDs -----
    // If a value is missing or not a valid UUID, set it to null.
    // This avoids foreign?멾ey violations when the related evaluation does not exist.
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!related_evaluation_id || !uuidRegex.test(related_evaluation_id)) {
      req.body.related_evaluation_id = null;
    }
    if (!related_task_id || !uuidRegex.test(related_task_id)) {
      req.body.related_task_id = null;
    }

    // ----- Ensure sender exists (auto?멵reate placeholder if missing) -----
    // Look up employee by employee_id (text). If not found, insert a placeholder.
    const senderCheck = await pool.query(
      'SELECT employee_id FROM employees WHERE employee_id = $1',
      [sender_id]
    );
    if (senderCheck.rowCount === 0) {
      await pool.query(
        'INSERT INTO employees (employee_id, name, position, department) VALUES ($1, $2, $3, $4)',
        [sender_id, 'Admin', 'Administrator', 'HR']
      );
    }
    // Keep the original sender_id (employee_id) for the notification record.

    // ----- Ensure recipient exists (auto?멵reate placeholder if missing) -----
    // Look up employee by employee_id (text). If not found, insert a placeholder.
    const recipientCheck = await pool.query(
      'SELECT employee_id FROM employees WHERE employee_id = $1',
      [recipient_id]
    );
    if (recipientCheck.rowCount === 0) {
      await pool.query(
        'INSERT INTO employees (employee_id, name, position, department) VALUES ($1, $2, $3, $4)',
        [recipient_id, 'Recipient', 'User', 'HR']
      );
    }

    // Sanitize message to remove raw newline/control characters that break JSON parsing
    const sanitizedMessage = typeof message === 'string' ? message.replace(/[\r\n]+/g, ' ') : message;
    // Override the original message in the request body before DB insertion
    req.body.message = sanitizedMessage;

    // Required fields check
    const required = {
      notification_type,
      title,
      message,
      priority,
      sender_id,
      sender_name,
      recipient_id,
    };
    const missing = Object.entries(required).filter(
      ([, v]) => v === undefined || v === null || v === ''
    );
    if (missing.length) {
      console.warn('?좑툘 Missing required notification fields', missing.map(([k]) => k));
      return res
        .status(400)
        .json({ error: `Missing fields: ${missing.map(([k]) => k).join(', ')}` });
    }
    
    // ----- Priority validation (must be one of low, medium, high) -----
    const allowedPriorities = ['low', 'medium', 'high'];
    if (!allowedPriorities.includes(priority)) {
      console.warn('?좑툘 Invalid priority value', { priority });
      return res
        .status(400)
        .json({ error: `Invalid priority: ${priority}. Allowed values are ${allowedPriorities.join(', ')}` });
    }

    // Optional related IDs (related_evaluation_id, related_task_id) are stored as text.
    // No strict UUID validation is performed here to allow flexibility.
    // If stricter validation is required in the future, add appropriate checks.

    // ----- Insert into DB -----
    // Filter out undefined / null values (e.g., optional related IDs not provided)
    const filtered = Object.entries(req.body).filter(([, v]) => v !== undefined && v !== null);
    const cols = filtered.map(([k]) => k);
    const vals = filtered.map(([, v]) => v);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await pool.query(
      `INSERT INTO notifications (${cols.join(',')}) VALUES (${placeholders}) RETURNING *`,
      vals
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error creating notification:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.put('/api/notification/:id/read', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'UPDATE notifications SET is_read = true WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error marking notification as read:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.delete('/api/notification/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM notifications WHERE id = $1', [req.params.id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting notification:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

/* ==================== Setting Routes ==================== */

app.get('/api/settings/:userId/:type', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM settings WHERE user_id = $1 AND setting_type = $2 LIMIT 1',
      [req.params.userId, req.params.type]
    );
    res.json(rows[0] ?? null);
  } catch (err) {
    console.error('Error fetching setting:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/settings/:userId', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM settings WHERE user_id = $1', [req.params.userId]);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching user settings:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/setting', async (req, res) => {
  try {
    const cols = ['user_id', 'setting_type', 'setting_data', 'updated_at'];
    const vals = [
      req.body.user_id,
      req.body.setting_type,
      req.body.setting_data,
      new Date().toISOString()
    ];
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await pool.query(
      `INSERT INTO settings (${cols.join(',')}) VALUES (${placeholders})
       ON CONFLICT (user_id, setting_type) DO UPDATE
       SET setting_data = EXCLUDED.setting_data,
           updated_at = EXCLUDED.updated_at
       RETURNING *`,
      vals
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error upserting setting:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.delete('/api/setting/:userId/:type', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM settings WHERE user_id = $1 AND setting_type = $2',
      [req.params.userId, req.params.type]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Setting not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting setting:', err);
    res.status(500).json({ error: 'Database error' });
  }
});
// ==================== Prompt Routes ====================
app.get('/api/prompts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT key, description, content, updated_at FROM prompt_templates ORDER BY key'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching prompts:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/prompt/:key', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT content FROM prompt_templates WHERE key = $1',
      [req.params.key]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Prompt not found' });
    }
    res.json({ content: rows[0].content });
  } catch (err) {
    console.error('Error fetching prompt:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.put('/api/prompt/:key', async (req, res) => {
  try {
    const { content, description } = req.body;
    const key = req.params.key;
    
    // UPSERT: Insert if not exists, Update if exists
    // Default description if not provided
    const desc = description || '?ъ슜???뺤쓽 ?꾨＼?꾪듃';
    
    const { rows } = await pool.query(
      `INSERT INTO prompt_templates (key, description, content)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE
       SET content = EXCLUDED.content,
           description = COALESCE(EXCLUDED.description, prompt_templates.description),
           updated_at = NOW()
       RETURNING *`,
      [key, desc, content]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating prompt:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Health?멵heck endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});
/* ==================== Server Start ==================== */

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`?윟 API server listening on http://localhost:${PORT}`);
});

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

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
    let value = rest.join('=').trim();
    // .env 값의 둘러싼 따옴표 허용(dotenv 호환) — 수제 파서라 직접 벗긴다.
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key.trim()] = value;
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
  'job_role',
  'org_corporation',
  'org_division',
  'org_department',
  'org_team',
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

// 조직 계층(법인/본부/부/팀) 정규화. 업로드 양식은 빈 계층을 "-" 로 표기 → null 로 본다.
const normalizeOrgText = (value) => {
  const text = normalizeOptionalText(value);
  return text === '-' ? null : text;
};

// 사번이 영문으로 시작하면 잘못된 데이터로 본다(정상 사번은 숫자로 시작).
// import 시 이런 사번으로 직원/평가자 계정이 생성되지 않도록 거르는 데 쓴다.
const startsWithLetter = (id) =>
  typeof id === 'string' && /^[A-Za-z]/.test(id.trim());

const getAssignmentActor = (body = {}) =>
  normalizeOptionalText(body.changed_by ?? body.changedBy ?? body.actor_id ?? body.actorId);

const getAssignmentReason = (body = {}) =>
  normalizeOptionalText(body.assignment_change_reason ?? body.change_reason ?? body.reason);

const getAssignmentCancellationReason = (body = {}) =>
  normalizeOptionalText(body.cancel_reason ?? body.reason);

const getAssignmentEffectiveDate = (body = {}) =>
  normalizeImportDate(
    body.changed_at ??
      body.changedAt ??
      body.assignment_start_date ??
      body.assignmentStartDate ??
      body.effective_date ??
      body.effectiveDate
  );

const getAssignmentPeriodId = (body = {}) =>
  normalizeOptionalText(body.evaluation_period_id ?? body.evaluationPeriodId);

const normalizeImportDate = (value) => {
  const text = normalizeOptionalText(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    return text.slice(0, 10);
  }
  if (/^\d{4}\.\d{1,2}\.\d{1,2}$/.test(text)) {
    const [year, month, day] = text.split('.');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
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
    org_corporation: normalizeOrgText(row.org_corporation ?? row.orgCorporation),
    org_division: normalizeOrgText(row.org_division ?? row.orgDivision),
    org_department: normalizeOrgText(row.org_department ?? row.orgDepartment),
    org_team: normalizeOrgText(row.org_team ?? row.orgTeam),
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
  // 매칭파일에서 가장 큰 소속순번 = 가장 최근 투어 = 현재 상태
  // (과거 투어는 빈 end_date, 현재 투어는 평가기간 만료일이 채워져 있어
  //  end_date 유무로는 현재를 식별할 수 없음)
  const score = (row) => ({
    sequence: Number(row.org_sequence) || 0,
    startTime: row.work_start_date ? Date.parse(row.work_start_date) || 0 : 0,
    hasEvaluator: row.evaluator_id ? 1 : 0,
  });
  const left = score(a);
  const right = score(b);
  if (left.sequence !== right.sequence) return left.sequence - right.sequence;
  if (left.startTime !== right.startTime) return left.startTime - right.startTime;
  return left.hasEvaluator - right.hasEvaluator;
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

const parseGrowthLevel = (value) => {
  const text = normalizeOptionalText(value);
  if (!text) return null;
  const match = text.match(/\d+/);
  if (!match) return null;
  const level = Number(match[0]);
  return Number.isInteger(level) ? level : null;
};

const VALID_PROFILE_ROLES = new Set(['evaluatee', 'evaluator', 'hr']);
const PROFILE_ROLE_LABEL_MAP = {
  '피평가자': 'evaluatee',
  '평가자': 'evaluator',
  HR: 'hr',
};

const normalizeAvailableRoles = (value) => {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  const seen = new Set();
  list.forEach((entry) => {
    const text = normalizeOptionalText(entry);
    if (!text) return;
    const mapped = PROFILE_ROLE_LABEL_MAP[text] ?? text;
    if (VALID_PROFILE_ROLES.has(mapped)) seen.add(mapped);
  });
  return [...seen];
};

const parseEvaluationGroup = (value) => {
  const text = normalizeOptionalText(value);
  if (!text) return { evaluationGroup: null, evaluationGroupName: null, evaluationGroupId: null };
  if (text === '[]') return { evaluationGroup: null, evaluationGroupName: null, evaluationGroupId: null };
  const match = text.match(/^(.*)\[([^\]]+)\]$/);
  return {
    evaluationGroup: text,
    evaluationGroupName: normalizeOptionalText(match?.[1]) ?? text,
    evaluationGroupId: normalizeOptionalText(match?.[2]),
  };
};

const normalizeEmployeeProfileImportRow = (row = {}, index = 0) => {
  const employeeId = normalizeOptionalText(row.employee_id ?? row.employeeId);
  const employeeName = normalizeOptionalText(row.employee_name ?? row.employeeName);
  const rowNumber = Number(row.row_number ?? row.rowNumber ?? index + 2);
  const group = parseEvaluationGroup(row.evaluation_group ?? row.evaluationGroup);
  const growthLevelLabel = normalizeOptionalText(row.growth_level_label ?? row.growthLevelLabel);
  const growthLevel = parseGrowthLevel(row.growth_level ?? row.growthLevel ?? growthLevelLabel);

  let validationStatus = 'valid';
  const messages = [];
  if (!employeeId) messages.push('사번 누락');
  if (!employeeName) messages.push('성명 누락');
  if (!growthLevel) {
    validationStatus = 'warning';
    messages.push('성장레벨 확인 필요');
  }
  if (messages.some((message) => message.includes('누락'))) {
    validationStatus = 'error';
  }

  return {
    sheet_name: normalizeOptionalText(row.sheet_name ?? row.sheetName) ?? 'Sheet1',
    row_number: Number.isInteger(rowNumber) ? rowNumber : index + 2,
    evaluation_group: group.evaluationGroup,
    evaluation_group_id:
      normalizeOptionalText(row.evaluation_group_id ?? row.evaluationGroupId) ??
      group.evaluationGroupId,
    evaluation_group_name:
      normalizeOptionalText(row.evaluation_group_name ?? row.evaluationGroupName) ??
      group.evaluationGroupName,
    employee_id: employeeId,
    employee_name: employeeName,
    org_sequence: normalizeOptionalText(row.org_sequence ?? row.orgSequence),
    department_id: normalizeOptionalText(row.department_id ?? row.departmentId),
    org_corporation: normalizeOrgText(row.org_corporation ?? row.orgCorporation),
    org_division: normalizeOrgText(row.org_division ?? row.orgDivision),
    org_department: normalizeOrgText(row.org_department ?? row.orgDepartment),
    org_team: normalizeOrgText(row.org_team ?? row.orgTeam),
    department_name: normalizeOptionalText(row.department_name ?? row.departmentName),
    work_start_date: normalizeImportDate(row.work_start_date ?? row.workStartDate),
    work_end_date: normalizeImportDate(row.work_end_date ?? row.workEndDate),
    growth_level: growthLevel,
    growth_level_label: growthLevelLabel,
    position: normalizeOptionalText(row.position),
    job_role: normalizeOptionalText(row.job_role ?? row.jobRole),
    evaluator_id: normalizeOptionalText(row.evaluator_id ?? row.evaluatorId),
    evaluator_name: normalizeOptionalText(row.evaluator_name ?? row.evaluatorName),
    evaluator_position: normalizeOptionalText(row.evaluator_position ?? row.evaluatorPosition),
    target_status: normalizeOptionalText(row.target_status ?? row.targetStatus),
    available_roles: normalizeAvailableRoles(row.available_roles ?? row.availableRoles),
    validation_status: validationStatus,
    validation_message: messages.join(', ') || null,
    raw_data: row.raw_data ?? row.rawData ?? row,
  };
};

const mergeEmployeeProfileRows = (rows) => {
  const mergedByEmployee = new Map();
  const primaryRowKeys = new Set();
  const validRows = rows.filter((row) => row.validation_status !== 'error' && row.employee_id);

  validRows.forEach((row) => {
    const current = mergedByEmployee.get(row.employee_id) ?? {
      employee_id: row.employee_id,
      employee_name: null,
      evaluation_group_id: null,
      evaluation_group_name: null,
      org_sequence: null,
      department_id: null,
      org_corporation: null,
      org_division: null,
      org_department: null,
      org_team: null,
      department_name: null,
      work_start_date: null,
      work_end_date: null,
      growth_level: null,
      position: null,
      job_role: null,
      evaluator_id: null,
      evaluator_name: null,
      evaluator_position: null,
      target_status: null,
      available_roles: [],
      primary_row: null,
    };
    const isDetailed = row.department_id || row.org_sequence || row.evaluator_id || row.target_status;
    const currentIsDetailed =
      current.primary_row?.department_id ||
      current.primary_row?.org_sequence ||
      current.primary_row?.evaluator_id ||
      current.primary_row?.target_status;

    const mergedRoles = [
      ...new Set([...(current.available_roles ?? []), ...(row.available_roles ?? [])]),
    ];

    mergedByEmployee.set(row.employee_id, {
      employee_id: row.employee_id,
      employee_name: row.employee_name ?? current.employee_name,
      evaluation_group_id: row.evaluation_group_id ?? current.evaluation_group_id,
      evaluation_group_name: row.evaluation_group_name ?? current.evaluation_group_name,
      org_sequence: row.org_sequence ?? current.org_sequence,
      department_id: row.department_id ?? current.department_id,
      org_corporation: row.org_corporation ?? current.org_corporation,
      org_division: row.org_division ?? current.org_division,
      org_department: row.org_department ?? current.org_department,
      org_team: row.org_team ?? current.org_team,
      department_name: row.department_name ?? current.department_name,
      work_start_date: row.work_start_date ?? current.work_start_date,
      work_end_date: row.work_end_date ?? current.work_end_date,
      growth_level: row.growth_level ?? current.growth_level,
      position: row.position ?? current.position,
      job_role: row.job_role ?? current.job_role,
      evaluator_id: row.evaluator_id ?? current.evaluator_id,
      evaluator_name: row.evaluator_name ?? current.evaluator_name,
      evaluator_position: row.evaluator_position ?? current.evaluator_position,
      target_status: row.target_status ?? current.target_status,
      available_roles: mergedRoles,
      primary_row:
        !current.primary_row || (isDetailed && !currentIsDetailed) ? row : current.primary_row,
    });
  });

  mergedByEmployee.forEach((row) => {
    if (row.primary_row) {
      primaryRowKeys.add(`${row.primary_row.sheet_name}:${row.primary_row.row_number}`);
    }
  });

  return { mergedRows: [...mergedByEmployee.values()], primaryRowKeys };
};

const getEvaluationContextForEmployee = async (client, employeeId) => {
  try {
    const { rows } = await client.query(
      `
        SELECT
          ev.id AS evaluation_id,
          ev.evaluation_period_id
        FROM evaluations ev
        LEFT JOIN evaluation_periods p ON p.id = ev.evaluation_period_id
        WHERE ev.evaluatee_id = $1
          AND COALESCE(ev.record_status, 'active') = 'active'
          AND EXISTS (
            SELECT 1
            FROM evaluator_assignment_history h
            WHERE h.evaluation_id = ev.id
              AND h.status = 'applied'
              AND h.change_type <> 'cancel'
          )
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

const getAssignmentEvaluationPeriod = async (client, evaluationPeriodId = null) => {
  if (evaluationPeriodId) {
    const { rows } = await client.query(
      'SELECT * FROM evaluation_periods WHERE id = $1 LIMIT 1',
      [evaluationPeriodId]
    );
    if (!rows[0]) {
      const err = new Error('Evaluation period not found');
      err.statusCode = 400;
      throw err;
    }
    return rows[0];
  }

  const { rows } = await client.query(`
    SELECT *
    FROM evaluation_periods
    WHERE status = 'active'
    ORDER BY is_default DESC, starts_on DESC NULLS LAST, created_at DESC
    LIMIT 1
  `);
  return rows[0] ?? null;
};

const createDraftEvaluationForEmployeeAssignment = async (
  client,
  employee,
  evaluationPeriodId = null
) => {
  const activePeriod = await getAssignmentEvaluationPeriod(client, evaluationPeriodId);

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
  if (!employee?.employee_id || !employee.evaluator_id) {
    return { evaluation: null, created: false };
  }

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
    return {
      evaluation: {
        id: context.evaluation_id,
        evaluation_period_id: context.evaluation_period_id ?? null,
      },
      created: false,
    };
  }

  const evaluation = await createDraftEvaluationForEmployeeAssignment(client, employee);
  return { evaluation, created: Boolean(evaluation) };
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
    changedAt = null,
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
        supersedes_history_id,
        changed_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::timestamptz,NOW()))
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
      changedAt ?? null,
    ]
  );

  return rows[0];
};

const cancelStaleEmptyDraftsForEvaluatorChange = async (
  client,
  { employeeId, currentEvaluatorId }
) => {
  const { rows } = await client.query(
    `
      SELECT ev.id
        FROM evaluations ev
        JOIN evaluator_assignment_history h ON h.id = ev.assignment_history_id
       WHERE ev.evaluatee_id = $1
         AND COALESCE(ev.evaluation_status, 'draft') = 'draft'
         AND ev.record_status = 'active'
         AND COALESCE(h.new_evaluator_id, '') IS DISTINCT FROM COALESCE($2, '')
         AND NOT EXISTS (
           SELECT 1 FROM task_evaluation_entries te
            WHERE te.evaluation_id = ev.id
              AND COALESCE(te.status, 'active') = 'active'
         )
         AND NOT EXISTS (
           SELECT 1 FROM tasks t
            WHERE t.evaluation_id = ev.id
              AND t.deleted_at IS NULL
         )
    `,
    [employeeId, currentEvaluatorId]
  );
  if (rows.length === 0) return 0;
  const ids = rows.map((r) => r.id);
  await client.query(
    `UPDATE evaluations SET record_status = 'cancelled', updated_at = NOW() WHERE id = ANY($1::uuid[])`,
    [ids]
  );
  return ids.length;
};

const createHistoricalTourEvaluation = async (
  client,
  {
    employee,
    historicalRow,
    previousEvaluatorId = null,
    importedBy,
    sourceFileName,
    evaluationPeriodId,
    evaluationYear,
  }
) => {
  if (!historicalRow?.evaluator_id || !employee?.employee_id) return null;

  const { rows: existingRows } = await client.query(
    `
      SELECT h.id AS history_id, ev.id AS evaluation_id
      FROM evaluator_assignment_history h
      JOIN evaluations ev ON ev.id = h.evaluation_id
      WHERE h.employee_id = $1
        AND h.new_evaluator_id = $2
        AND h.status = 'applied'
        AND h.change_type = 'change'
        AND ev.evaluation_status = 'completed'
        AND ev.record_status = 'active'
        AND COALESCE(ev.evaluation_period_id::text, '') = COALESCE($3::text, '')
      LIMIT 1
    `,
    [historicalRow.employee_id, historicalRow.evaluator_id, evaluationPeriodId]
  );
  if (existingRows[0]) return null;

  const { rows: evalRows } = await client.query(
    `
      INSERT INTO evaluations (
        evaluatee_id,
        evaluatee_name,
        evaluatee_position,
        evaluatee_department,
        growth_level,
        evaluation_status,
        evaluation_year,
        evaluation_period_id,
        record_status
      )
      VALUES ($1,$2,$3,$4,$5,'completed',$6,$7,'active')
      RETURNING *
    `,
    [
      employee.employee_id,
      employee.name,
      employee.position ?? '미등록',
      historicalRow.department_name ?? employee.department ?? '미지정',
      employee.growth_level ?? 0,
      evaluationYear,
      evaluationPeriodId,
    ]
  );
  const newEvaluation = evalRows[0];

  const history = await insertEvaluatorAssignmentHistory(client, {
    employeeId: historicalRow.employee_id,
    previousEvaluatorId: previousEvaluatorId ?? null,
    newEvaluatorId: historicalRow.evaluator_id,
    changedBy: importedBy,
    reason: `Matching past tour: ${sourceFileName}`,
    changeType: 'change',
    evaluationId: newEvaluation.id,
    evaluationPeriodId,
  });

  if (history?.id && historicalRow.work_start_date) {
    await client.query(
      'UPDATE evaluator_assignment_history SET changed_at = $2 WHERE id = $1',
      [history.id, historicalRow.work_start_date]
    );
  }
  if (history?.id) {
    await client.query(
      'UPDATE evaluations SET assignment_history_id = $2 WHERE id = $1',
      [newEvaluation.id, history.id]
    );
  }

  return { evaluationId: newEvaluation.id, historyId: history?.id };
};

const resolveEmployeeName = async (client, employeeId, fallback = null) => {
  if (!employeeId) return fallback;
  try {
    const { rows } = await client.query(
      'SELECT name FROM employees WHERE employee_id = $1 LIMIT 1',
      [employeeId]
    );
    return rows[0]?.name ?? fallback;
  } catch {
    return fallback;
  }
};

const insertNotificationRow = async (
  client,
  {
    notificationType,
    title,
    message,
    priority = 'medium',
    senderId,
    senderName,
    recipientId,
    relatedEvaluationId = null,
    relatedTaskId = null,
  }
) => {
  if (!recipientId || !title || !message || !senderId) return null;
  const sanitizedMessage = String(message).replace(/[\r\n]+/g, ' ');
  await client.query('SAVEPOINT notif_insert');
  try {
    const { rows } = await client.query(
      `
        INSERT INTO notifications (
          notification_type, title, message, priority,
          sender_id, sender_name, recipient_id,
          related_evaluation_id, related_task_id, is_read
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false)
        RETURNING *
      `,
      [
        notificationType,
        title,
        sanitizedMessage,
        priority,
        senderId,
        senderName ?? '시스템',
        recipientId,
        relatedEvaluationId,
        relatedTaskId,
      ]
    );
    await client.query('RELEASE SAVEPOINT notif_insert');
    return rows[0] ?? null;
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT notif_insert').catch(() => {});
    if (err.code !== '23503') {
      console.error('insertNotificationRow failed:', err.message);
    }
    return null;
  }
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

// 정정 시 점수/피드백 ownership 을 evaluation 한 건 내에서만 안전하게 이전한다.
// (전체 evaluatee 단위 이전은 다른 evaluation 의 entries 까지 무차별 이동시킬 위험이 있어,
//  정정의 정확한 범위인 evaluation_id 로 한정한다.)
const transferEvaluatorEntriesForCorrectionScoped = async (
  client,
  { evaluationId, previousEvaluatorId, newEvaluatorId, actorId, reason }
) => {
  if (!evaluationId || !previousEvaluatorId || !newEvaluatorId || previousEvaluatorId === newEvaluatorId) {
    return { transferredEntries: [], mergedEntries: [], transferredFeedbackCount: 0 };
  }

  const { rows: evaluatorRows } = await client.query(
    'SELECT name FROM employees WHERE employee_id = $1 LIMIT 1',
    [newEvaluatorId]
  );
  const newEvaluatorName = evaluatorRows[0]?.name ?? newEvaluatorId;

  const { rows: targetEntries } = await client.query(
    `
      SELECT *
      FROM task_evaluation_entries
      WHERE evaluation_id = $1
        AND evaluator_id IS NOT DISTINCT FROM $2
        AND COALESCE(status, 'active') = 'active'
      ORDER BY updated_at DESC, created_at DESC
    `,
    [evaluationId, previousEvaluatorId]
  );

  const transferredEntries = [];
  const mergedEntries = [];
  let transferredFeedbackCount = 0;
  const affectedTaskIds = new Set();

  for (const entry of targetEntries) {
    let targetEntry = null;
    await client.query('SAVEPOINT scoped_transfer');
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
      await client.query('RELEASE SAVEPOINT scoped_transfer');
      if (targetEntry) transferredEntries.push(targetEntry);
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT scoped_transfer');
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
          SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $2, cancel_reason = $3,
              updated_at = NOW()
          WHERE id = $1
        `,
        [entry.id, actorId ?? null, reason || 'Merged into corrected evaluator']
      );
      await client.query('RELEASE SAVEPOINT scoped_transfer');
    }
    if (entry.task_uuid) affectedTaskIds.add(entry.task_uuid);
    if (targetEntry?.id) {
      const { rowCount } = await client.query(
        `
          UPDATE feedback_history
          SET evaluator_id = $4, evaluator_name = $5, task_evaluation_entry_id = $6,
              status = 'active', cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL
          WHERE task_uuid = $1
            AND COALESCE(status, 'active') = 'active'
            AND (task_evaluation_entry_id = $2 OR evaluator_id IS NOT DISTINCT FROM $3)
        `,
        [entry.task_uuid, entry.id, previousEvaluatorId, newEvaluatorId, newEvaluatorName, targetEntry.id]
      );
      transferredFeedbackCount += rowCount ?? 0;
    }
  }

  await rebuildTaskEvaluationSnapshot(client, [...affectedTaskIds]);
  return { transferredEntries, mergedEntries, transferredFeedbackCount };
};

// 한 직원의 applied non-cancel history 행들의 previous_evaluator_id 를
// 시간순 직전 행의 new_evaluator_id 로 일관 동기화한다.
// (정정 후 직전 평가자가 바뀌면 그 다음 행들의 prev 도 그에 맞춰 따라가도록.)
const reconcilePreviousEvaluatorIds = async (client, employeeId) => {
  if (!employeeId) return;
  await client.query(
    `
      WITH numbered AS (
        SELECT
          id,
          new_evaluator_id,
          supersedes_history_id,
          ROW_NUMBER() OVER (ORDER BY changed_at, id) AS rn
        FROM evaluator_assignment_history
        WHERE employee_id = $1
          AND status = 'applied'
          AND change_type <> 'cancel'
      ),
      expected AS (
        SELECT
          curr.id AS row_id,
          COALESCE(orig.new_evaluator_id, prev.new_evaluator_id) AS expected_prev
        FROM numbered curr
        LEFT JOIN evaluator_assignment_history orig
          ON orig.id = curr.supersedes_history_id
        LEFT JOIN numbered prev ON prev.rn = curr.rn - 1
      )
      UPDATE evaluator_assignment_history h
      SET previous_evaluator_id = e.expected_prev
      FROM expected e
      WHERE h.id = e.row_id
        AND h.previous_evaluator_id IS DISTINCT FROM e.expected_prev
    `,
    [employeeId]
  );
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
  const payload = { ...period };

  // 기본(default) 지정은 1개만 유지: payload가 명시적으로 is_default=true 일 때만 다른 기본을 해제.
  if (payload.is_default === true) {
    await client.query(`
      UPDATE evaluation_periods
      SET is_default = false, updated_at = NOW()
      WHERE ($1::uuid IS NULL OR id <> $1::uuid)
    `, [id]);
  }

  // 마감/잠금/작성 전 상태로 바뀐 기간은 기본에서 자동 제외.
  if (payload.status && payload.status !== 'active' && payload.is_default !== true) {
    payload.is_default = false;
  }

  // 활성 기간이 한 개도 기본이 아닌 상태가 되지 않도록 자동 보정.
  // (사용자가 status='active'로 새 기간을 만들거나 활성화할 때, 다른 기본이 없으면 이번 기간을 기본으로.)
  if (payload.status === 'active' && payload.is_default === undefined) {
    const { rows: defaultRows } = await client.query(
      `
        SELECT COUNT(*)::int AS cnt
        FROM evaluation_periods
        WHERE is_default = TRUE
          AND ($1::uuid IS NULL OR id <> $1::uuid)
      `,
      [id],
    );
    if ((defaultRows[0]?.cnt ?? 0) === 0) {
      payload.is_default = true;
    }
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
          CASE
            WHEN e.record_status = 'cancelled' AND EXISTS (
              SELECT 1 FROM evaluator_assignment_history h2
              WHERE h2.evaluation_id = e.id
                AND h2.status = 'applied'
                AND h2.change_type <> 'cancel'
            ) THEN 'active'
            ELSE COALESCE(e.record_status, 'active')
          END AS record_status,
          cancelled_assignment.id AS cancelled_assignment_id
        FROM evaluations e
        LEFT JOIN evaluation_periods p ON p.id = e.evaluation_period_id
        LEFT JOIN evaluator_assignment_history cancelled_assignment
          ON cancelled_assignment.evaluation_id = e.id
          AND cancelled_assignment.status = 'cancelled'
          AND NOT EXISTS (
            SELECT 1
            FROM evaluator_assignment_history live
            WHERE live.evaluation_id = cancelled_assignment.evaluation_id
              AND live.status = 'applied'
              AND live.change_type <> 'cancel'
          )
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

const assertEvaluationTaskStructureEditableById = async (
  evaluationId,
  { bypassCompletedLock = false } = {},
) => {
  if (!evaluationId || !isDbAvailable || !pool?.query) {
    return;
  }

  try {
    const { rows } = await pool.query(
      `
        SELECT
          e.evaluation_status,
          CASE
            WHEN e.record_status = 'cancelled' AND EXISTS (
              SELECT 1 FROM evaluator_assignment_history h2
              WHERE h2.evaluation_id = e.id
                AND h2.status = 'applied'
                AND h2.change_type <> 'cancel'
            ) THEN 'active'
            ELSE COALESCE(e.record_status, 'active')
          END AS record_status,
          cancelled_assignment.id AS cancelled_assignment_id
        FROM evaluations e
        LEFT JOIN evaluator_assignment_history cancelled_assignment
          ON cancelled_assignment.evaluation_id = e.id
          AND cancelled_assignment.status = 'cancelled'
          AND NOT EXISTS (
            SELECT 1
            FROM evaluator_assignment_history live
            WHERE live.evaluation_id = cancelled_assignment.evaluation_id
              AND live.status = 'applied'
              AND live.change_type <> 'cancel'
          )
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
      // 'completed' 상태는 항상 잠금 — 반려(평가 수정으로 status 변경) 후에만 편집.
      // submitted/evaluating/locked 등은 bypassCompletedLock가 있으면 우회(과거 평가 편집).
      if (status === 'completed') {
        throw createEvaluationStructureWriteError(status);
      }
      if (bypassCompletedLock) {
        return;
      }
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
          CASE
            WHEN e.record_status = 'cancelled' AND EXISTS (
              SELECT 1 FROM evaluator_assignment_history h2
              WHERE h2.evaluation_id = e.id
                AND h2.status = 'applied'
                AND h2.change_type <> 'cancel'
            ) THEN 'active'
            ELSE COALESCE(e.record_status, 'active')
          END AS record_status,
          cancelled_assignment.id AS cancelled_assignment_id
        FROM tasks t
        LEFT JOIN evaluations e ON e.id = t.evaluation_id
        LEFT JOIN evaluation_periods p ON p.id = t.evaluation_period_id
        LEFT JOIN evaluator_assignment_history cancelled_assignment
          ON cancelled_assignment.evaluation_id = e.id
          AND cancelled_assignment.status = 'cancelled'
          AND NOT EXISTS (
            SELECT 1
            FROM evaluator_assignment_history live
            WHERE live.evaluation_id = cancelled_assignment.evaluation_id
              AND live.status = 'applied'
              AND live.change_type <> 'cancel'
          )
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

const assertTaskStructureEditableById = async (
  taskId,
  { bypassCompletedLock = false } = {},
) => {
  if (!taskId || !isDbAvailable || !pool?.query) {
    return;
  }

  try {
    const { rows } = await pool.query(
      `
        SELECT
          e.evaluation_status,
          CASE
            WHEN e.record_status = 'cancelled' AND EXISTS (
              SELECT 1 FROM evaluator_assignment_history h2
              WHERE h2.evaluation_id = e.id
                AND h2.status = 'applied'
                AND h2.change_type <> 'cancel'
            ) THEN 'active'
            ELSE COALESCE(e.record_status, 'active')
          END AS record_status,
          cancelled_assignment.id AS cancelled_assignment_id
        FROM tasks t
        LEFT JOIN evaluations e ON e.id = t.evaluation_id
        LEFT JOIN evaluator_assignment_history cancelled_assignment
          ON cancelled_assignment.evaluation_id = e.id
          AND cancelled_assignment.status = 'cancelled'
          AND NOT EXISTS (
            SELECT 1
            FROM evaluator_assignment_history live
            WHERE live.evaluation_id = cancelled_assignment.evaluation_id
              AND live.status = 'applied'
              AND live.change_type <> 'cancel'
          )
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
      // 'completed' 상태는 항상 잠금 — 반려(평가 수정으로 status 변경) 후에만 편집.
      // submitted/evaluating/locked 등은 bypassCompletedLock가 있으면 우회(과거 평가 편집).
      if (status === 'completed') {
        throw createEvaluationStructureWriteError(status);
      }
      if (bypassCompletedLock) {
        return;
      }
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
          CASE
            WHEN e.record_status = 'cancelled' AND EXISTS (
              SELECT 1 FROM evaluator_assignment_history h2
              WHERE h2.evaluation_id = e.id
                AND h2.status = 'applied'
                AND h2.change_type <> 'cancel'
            ) THEN 'active'
            ELSE COALESCE(e.record_status, 'active')
          END AS record_status,
          cancelled_assignment.id AS cancelled_assignment_id
        FROM tasks t
        LEFT JOIN evaluations e ON e.id = t.evaluation_id
        LEFT JOIN evaluator_assignment_history cancelled_assignment
          ON cancelled_assignment.evaluation_id = e.id
          AND cancelled_assignment.status = 'cancelled'
          AND NOT EXISTS (
            SELECT 1
            FROM evaluator_assignment_history live
            WHERE live.evaluation_id = cancelled_assignment.evaluation_id
              AND live.status = 'applied'
              AND live.change_type <> 'cancel'
          )
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
          CASE
            WHEN e.record_status = 'cancelled' AND EXISTS (
              SELECT 1 FROM evaluator_assignment_history h2
              WHERE h2.evaluation_id = e.id
                AND h2.status = 'applied'
                AND h2.change_type <> 'cancel'
            ) THEN 'active'
            ELSE COALESCE(e.record_status, 'active')
          END AS record_status,
          cancelled_assignment.id AS cancelled_assignment_id
        FROM tasks t
        LEFT JOIN evaluations e ON e.id = t.evaluation_id
        LEFT JOIN evaluation_periods p ON p.id = t.evaluation_period_id
        LEFT JOIN evaluator_assignment_history cancelled_assignment
          ON cancelled_assignment.evaluation_id = e.id
          AND cancelled_assignment.status = 'cancelled'
          AND NOT EXISTS (
            SELECT 1
            FROM evaluator_assignment_history live
            WHERE live.evaluation_id = cancelled_assignment.evaluation_id
              AND live.status = 'applied'
              AND live.change_type <> 'cancel'
          )
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
          CASE
            WHEN e.record_status = 'cancelled' AND EXISTS (
              SELECT 1 FROM evaluator_assignment_history h2
              WHERE h2.evaluation_id = e.id
                AND h2.status = 'applied'
                AND h2.change_type <> 'cancel'
            ) THEN 'active'
            ELSE COALESCE(e.record_status, 'active')
          END AS record_status,
          cancelled_assignment.id AS cancelled_assignment_id
        FROM tasks t
        LEFT JOIN evaluations e ON e.id = t.evaluation_id
        LEFT JOIN evaluator_assignment_history cancelled_assignment
          ON cancelled_assignment.evaluation_id = e.id
          AND cancelled_assignment.status = 'cancelled'
          AND NOT EXISTS (
            SELECT 1
            FROM evaluator_assignment_history live
            WHERE live.evaluation_id = cancelled_assignment.evaluation_id
              AND live.status = 'applied'
              AND live.change_type <> 'cancel'
          )
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
        CASE
          WHEN e.record_status = 'cancelled' AND EXISTS (
            SELECT 1 FROM evaluator_assignment_history h2
            WHERE h2.evaluation_id = e.id
              AND h2.status = 'applied'
              AND h2.change_type <> 'cancel'
          ) THEN 'active'
          ELSE COALESCE(e.record_status, 'active')
        END AS record_status,
        cancelled_assignment.id AS cancelled_assignment_id,
        p.status AS period_status
      FROM tasks t
      LEFT JOIN evaluations e ON e.id = t.evaluation_id
      LEFT JOIN evaluator_assignment_history cancelled_assignment
        ON cancelled_assignment.evaluation_id = e.id
        AND cancelled_assignment.status = 'cancelled'
        AND NOT EXISTS (
          SELECT 1
          FROM evaluator_assignment_history live
          WHERE live.evaluation_id = cancelled_assignment.evaluation_id
            AND live.status = 'applied'
            AND live.change_type <> 'cancel'
        )
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
          e.evaluation_status,
          emp.evaluator_id AS assigned_evaluator_id,
          ah.new_evaluator_id AS evaluation_evaluator_id
        FROM evaluations e
        LEFT JOIN employees emp ON emp.employee_id = e.evaluatee_id
        LEFT JOIN evaluator_assignment_history ah ON ah.id = e.assignment_history_id
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
  // 'completed' 상태는 잠금 — 평가 수정(=반려)으로 status 변경 후에만 편집 가능
  if (evaluation?.evaluation_status === 'completed') {
    throw Object.assign(
      new Error('Evaluation is completed; reopen via evaluator action before editing scores or feedback.'),
      { statusCode: 423 }
    );
  }

  const isAssignedEvaluator = evaluation?.assigned_evaluator_id === payload.evaluator_id;
  // 이 평가의 assignment_history가 가리키는 평가자(과거 평가자 포함)이면 본인 평가 편집 허용
  const isEvaluationOwnerEvaluator =
    evaluation?.evaluation_evaluator_id === payload.evaluator_id;
  const ownsAnyEntry = entryRows.some(
    (entry) =>
      entry.evaluator_id === payload.evaluator_id ||
      (entry.evaluator_id?.startsWith('legacy:') && entry.evaluator_name === payload.evaluator_name)
  );

  if (ownsAnyEntry || isAssignedEvaluator || isEvaluationOwnerEvaluator) {
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
          CASE
            WHEN e.record_status = 'cancelled' AND EXISTS (
              SELECT 1 FROM evaluator_assignment_history h2
              WHERE h2.evaluation_id = e.id
                AND h2.status = 'applied'
                AND h2.change_type <> 'cancel'
            ) THEN 'active'
            ELSE COALESCE(e.record_status, 'active')
          END AS record_status,
          cancelled_assignment.id AS cancelled_assignment_id
        FROM feedback_history f
        LEFT JOIN tasks t ON t.id = f.task_uuid OR t.task_id = f.task_id
        LEFT JOIN evaluations e ON e.id = COALESCE(f.evaluation_id, t.evaluation_id)
        LEFT JOIN evaluator_assignment_history cancelled_assignment
          ON cancelled_assignment.evaluation_id = e.id
          AND cancelled_assignment.status = 'cancelled'
          AND NOT EXISTS (
            SELECT 1
            FROM evaluator_assignment_history live
            WHERE live.evaluation_id = cancelled_assignment.evaluation_id
              AND live.status = 'applied'
              AND live.change_type <> 'cancel'
          )
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

/* ==================== AI Proxy Routes ==================== */
// 브라우저가 LLM 서버를 직접 호출하지 않도록 서버가 중계한다. (모델·키는 서버가 강제)
// - 이식 전(임시): GitHub Models(외부 API) 기본값 — AI_API_KEY 필수
// - 내부망 이식 후: .env 의 AI_BASE_URL 만 GPT-OSS 주소로 바꾸면 복귀 (키 불필요)
const AI_BASE_URL_DEFAULT = 'https://models.github.ai/inference';
const AI_MODEL_DEFAULT = 'openai/gpt-4.1-mini';
const aiBaseUrl = (process.env.AI_BASE_URL || AI_BASE_URL_DEFAULT).replace(/\/+$/, '');
const aiApiKey = (process.env.AI_API_KEY || '').trim();
const aiModel = process.env.AI_MODEL || AI_MODEL_DEFAULT;
// 명시적 AI_BASE_URL(내부 GPT-OSS 등)은 키 없이 동작, 외부 기본값은 키가 있어야 동작.
const aiConfigured = Boolean(process.env.AI_BASE_URL) || aiApiKey.length > 0;
const aiIsExternal = !process.env.AI_BASE_URL || aiBaseUrl.startsWith('https://models.github.ai');

// 인증 도입(Phase S) 전 임시 레이트리밋: IP별 분당 호출 수 제한. 인증 후 세션 주체 기준으로 교체.
const AI_RATE_LIMIT_PER_MINUTE = 20;
const aiRateBuckets = new Map();
const aiRateLimited = (key) => {
  const now = Date.now();
  const bucket = aiRateBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= 60_000) {
    aiRateBuckets.set(key, { windowStart: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > AI_RATE_LIMIT_PER_MINUTE;
};
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of aiRateBuckets) {
    if (now - bucket.windowStart >= 60_000) aiRateBuckets.delete(key);
  }
}, 5 * 60_000).unref();

// 클라이언트가 설정 상태를 조회해 "AI 미설정" 안내·외부 API 주의 캡션을 띄운다. (키 값은 노출 금지)
app.get('/api/ai/status', (req, res) => {
  res.json({ configured: aiConfigured, external: aiIsExternal, model: aiModel });
});

app.post('/api/ai/chat', async (req, res) => {
  if (!aiConfigured) {
    return res.status(503).json({
      configured: false,
      error: 'AI not configured',
      message: 'AI_API_KEY(임시 GitHub Models) 또는 AI_BASE_URL(내부 GPT-OSS)을 .env에 설정해 주세요.',
    });
  }

  const fwd = req.headers['x-forwarded-for'];
  const clientKey =
    (typeof fwd === 'string' ? fwd.split(',')[0].trim() : '') || req.socket?.remoteAddress || 'unknown';
  if (aiRateLimited(clientKey)) {
    return res.status(429).json({
      error: 'Too many requests',
      message: `AI 호출이 분당 ${AI_RATE_LIMIT_PER_MINUTE}회를 초과했습니다. 잠시 후 다시 시도해 주세요.`,
    });
  }

  const { messages, temperature, max_tokens: maxTokens } = req.body ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages 배열이 필요합니다.' });
  }
  const safeMessages = messages
    .filter((m) => m && typeof m.content === 'string' && ['system', 'user', 'assistant'].includes(m.role))
    .map((m) => ({ role: m.role, content: m.content }));
  if (safeMessages.length === 0) {
    return res.status(400).json({ error: 'messages 형식이 올바르지 않습니다.' });
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (aiApiKey) headers.Authorization = `Bearer ${aiApiKey}`;
    const payload = { model: aiModel, messages: safeMessages };
    if (typeof temperature === 'number') payload.temperature = temperature;
    if (typeof maxTokens === 'number') payload.max_tokens = maxTokens;

    const upstream = await fetch(`${aiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      // 업스트림 에러 본문은 서버 로그에만 남긴다(키·내부 정보 노출 방지).
      console.error('AI upstream error:', upstream.status, text.slice(0, 500));
      return res.status(502).json({ error: 'AI upstream error', status: upstream.status });
    }
    res.type('application/json').send(text);
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    console.error('AI proxy error:', err?.message ?? err);
    res.status(timedOut ? 504 : 500).json({ error: timedOut ? 'AI timeout' : 'AI proxy error' });
  }
});

/* ==================== Auth Routes ==================== */
// 자체 비밀번호(G-1) + httpOnly 쿠키 세션. 세션은 인메모리(단일 인스턴스 전제) —
// 서버 재시작 시 전원 재로그인. password_hash NULL = 초기 상태(초기 비밀번호=사번, 변경 강제).
const SESSION_COOKIE = 'egs_session';
const SESSION_ABS_TTL_MS = 8 * 60 * 60 * 1000; // 절대 8시간
const SESSION_IDLE_TTL_MS = 2 * 60 * 60 * 1000; // 유휴 2시간
const BCRYPT_ROUNDS = 10;
const sessions = new Map(); // token -> { employeeId, createdAt, lastSeenAt }

setInterval(() => {
  const now = Date.now();
  for (const [token, s] of sessions) {
    if (now - s.createdAt > SESSION_ABS_TTL_MS || now - s.lastSeenAt > SESSION_IDLE_TTL_MS) {
      sessions.delete(token);
    }
  }
}, 10 * 60_000).unref();

const parseCookies = (req) => {
  const header = req.headers.cookie;
  if (!header) return {};
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
};

const setSessionCookie = (res, token) => {
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_ABS_TTL_MS / 1000)}`,
  ];
  // 리버스 프록시 TLS 종단 뒤에서는 COOKIE_SECURE=true 로 Secure 속성 부여
  if (process.env.COOKIE_SECURE === 'true') attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
};

const clearSessionCookie = (res) => {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
};

// 만료 검사 + 유휴 타임스탬프 갱신. 라우트 가드(S-2)가 이 함수를 공용으로 사용한다.
const getSession = (req) => {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  const now = Date.now();
  if (now - s.createdAt > SESSION_ABS_TTL_MS || now - s.lastSeenAt > SESSION_IDLE_TTL_MS) {
    sessions.delete(token);
    return null;
  }
  s.lastSeenAt = now;
  return s;
};

// 응답에서 인증 비밀은 항상 제거한다.
const sanitizeEmployee = (employee) => {
  if (!employee) return employee;
  const { password_hash: _ph, ...safe } = employee;
  return safe;
};

// 로그인 브루트포스 완화: IP별 분당 10회.
const LOGIN_RATE_LIMIT_PER_MINUTE = 10;
const loginRateBuckets = new Map();
const loginRateLimited = (key) => {
  const now = Date.now();
  const bucket = loginRateBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= 60_000) {
    loginRateBuckets.set(key, { windowStart: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > LOGIN_RATE_LIMIT_PER_MINUTE;
};
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of loginRateBuckets) {
    if (now - bucket.windowStart >= 60_000) loginRateBuckets.delete(key);
  }
}, 5 * 60_000).unref();

const clientIpOf = (req) => {
  const fwd = req.headers['x-forwarded-for'];
  return (typeof fwd === 'string' ? fwd.split(',')[0].trim() : '') || req.socket?.remoteAddress || 'unknown';
};

app.post('/api/auth/login', async (req, res) => {
  if (!isDbAvailable) return sendDbUnavailable(res);
  if (loginRateLimited(clientIpOf(req))) {
    return res.status(429).json({ error: '로그인 시도가 너무 잦습니다. 잠시 후 다시 시도해 주세요.' });
  }
  const { employee_id: employeeIdRaw, password } = req.body ?? {};
  if (typeof employeeIdRaw !== 'string' || !employeeIdRaw.trim() || typeof password !== 'string' || !password) {
    return res.status(400).json({ error: '사번과 비밀번호를 입력해 주세요.' });
  }
  const employeeId = employeeIdRaw.trim();
  // 사번 존재 여부를 구분해 노출하지 않는다(계정 열거 방지).
  const fail = () => res.status(401).json({ error: '사번 또는 비밀번호가 올바르지 않습니다.' });
  try {
    const { rows } = await pool.query('SELECT * FROM employees WHERE employee_id::text = $1', [employeeId]);
    const employee = rows[0];
    if (!employee) return fail();

    let mustChange;
    if (employee.password_hash) {
      const ok = await bcrypt.compare(password, employee.password_hash);
      if (!ok) return fail();
      mustChange = employee.must_change_password === true;
    } else {
      // 초기 상태: 초기 비밀번호 = 사번. 로그인 후 변경 강제.
      if (password !== String(employee.employee_id)) return fail();
      mustChange = true;
    }

    const token = randomUUID();
    const now = Date.now();
    sessions.set(token, { employeeId: String(employee.employee_id), createdAt: now, lastSeenAt: now });
    setSessionCookie(res, token);
    res.json({ employee: sanitizeEmployee(employee), must_change_password: mustChange });
  } catch (err) {
    console.error('로그인 처리 실패:', err.message);
    res.status(500).json({ error: '로그인 처리 중 오류가 발생했습니다.' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: '로그인이 필요합니다.' });
  if (!isDbAvailable) return sendDbUnavailable(res);
  try {
    const { rows } = await pool.query('SELECT * FROM employees WHERE employee_id::text = $1', [session.employeeId]);
    const employee = rows[0];
    if (!employee) {
      return res.status(401).json({ error: '계정을 찾을 수 없습니다.' });
    }
    res.json({ employee: sanitizeEmployee(employee), must_change_password: employee.must_change_password === true || !employee.password_hash });
  } catch (err) {
    console.error('세션 조회 실패:', err.message);
    res.status(500).json({ error: '세션 확인 중 오류가 발생했습니다.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) sessions.delete(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.post('/api/auth/change-password', async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: '로그인이 필요합니다.' });
  if (!isDbAvailable) return sendDbUnavailable(res);
  const { current_password: currentPassword, new_password: newPassword } = req.body ?? {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return res.status(400).json({ error: '현재 비밀번호와 새 비밀번호를 입력해 주세요.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: '새 비밀번호는 8자 이상이어야 합니다.' });
  }
  if (newPassword === session.employeeId) {
    return res.status(400).json({ error: '새 비밀번호로 사번을 사용할 수 없습니다.' });
  }
  try {
    const { rows } = await pool.query('SELECT * FROM employees WHERE employee_id::text = $1', [session.employeeId]);
    const employee = rows[0];
    if (!employee) return res.status(401).json({ error: '계정을 찾을 수 없습니다.' });

    const currentOk = employee.password_hash
      ? await bcrypt.compare(currentPassword, employee.password_hash)
      : currentPassword === String(employee.employee_id);
    if (!currentOk) return res.status(401).json({ error: '현재 비밀번호가 올바르지 않습니다.' });

    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await pool.query(
      'UPDATE employees SET password_hash = $1, must_change_password = FALSE WHERE employee_id::text = $2',
      [hash, session.employeeId],
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('비밀번호 변경 실패:', err.message);
    res.status(500).json({ error: '비밀번호 변경 중 오류가 발생했습니다.' });
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
    const { rows } = await pool.query(
      `
        SELECT
          e.*,
          EXISTS (
            SELECT 1 FROM evaluations ev
            WHERE ev.evaluatee_id = e.employee_id
              AND COALESCE(ev.record_status, 'active') = 'active'
          ) AS has_any_evaluation
        FROM employees e
        ORDER BY e.name
      `
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching employees:', err);
    res.json([...mockEmployees].sort((a, b) => a.name.localeCompare(b.name)));
  }
});

// 단건 사용자 추가
app.post('/api/employees', async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }

  const body = req.body || {};
  const employeeId = normalizeOptionalText(body.employee_id ?? body.employeeId);
  const name = normalizeOptionalText(body.name);
  if (!employeeId || !name) {
    return res.status(400).json({ error: '사번과 이름은 필수입니다.' });
  }
  if (/^[A-Za-z]/.test(employeeId)) {
    return res.status(400).json({ error: '사번은 영문자로 시작할 수 없습니다.' });
  }

  const roles =
    Array.isArray(body.available_roles) && body.available_roles.length > 0
      ? body.available_roles
      : ['evaluatee'];
  const growthLevelRaw = body.growth_level ?? body.growthLevel;
  const growthLevel =
    growthLevelRaw === '' || growthLevelRaw === null || growthLevelRaw === undefined
      ? null
      : Number(growthLevelRaw);
  if (growthLevel !== null && (!Number.isInteger(growthLevel) || growthLevel < 1)) {
    return res.status(400).json({ error: '성장레벨은 1 이상의 정수여야 합니다.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: existing } = await client.query(
      'SELECT 1 FROM employees WHERE employee_id = $1',
      [employeeId]
    );
    if (existing[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: '이미 존재하는 사번입니다.' });
    }
    const evaluatorId = normalizeOptionalText(body.evaluator_id ?? body.evaluatorId);
    const { rows } = await client.query(
      `
        INSERT INTO employees (
          employee_id, name, position, department, growth_level,
          evaluator_id, available_roles, job_role, created_at, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7::text[],$8,NOW(),NOW())
        RETURNING *
      `,
      [
        employeeId,
        name,
        normalizeOptionalText(body.position) ?? '미지정',
        normalizeOptionalText(body.department) ?? '미지정',
        growthLevel,
        evaluatorId,
        roles,
        normalizeOptionalText(body.job_role ?? body.jobRole),
      ]
    );
    const employee = rows[0];

    // 선택한 평가기간 기준으로 evaluation 을 맞춘다.
    // (AFTER INSERT 트리거가 active 평가기간으로 만든 evaluation 이 있으면 선택 기간으로 보정,
    //  트리거가 만들지 않았고 평가 대상이면 선택 기간으로 직접 생성.)
    const evaluationPeriodId = normalizeOptionalText(
      body.evaluation_period_id ?? body.evaluationPeriodId,
    );
    if (evaluationPeriodId) {
      const { rows: periodRows } = await client.query(
        'SELECT id, evaluation_year FROM evaluation_periods WHERE id = $1 LIMIT 1',
        [evaluationPeriodId]
      );
      const selectedPeriod = periodRows[0];
      if (selectedPeriod) {
        const { rowCount: updated } = await client.query(
          `
            UPDATE evaluations
            SET evaluation_period_id = $2, evaluation_year = $3, updated_at = NOW()
            WHERE evaluatee_id = $1
              AND COALESCE(record_status, 'active') = 'active'
              AND evaluation_period_id IS DISTINCT FROM $2
          `,
          [employee.employee_id, selectedPeriod.id, selectedPeriod.evaluation_year]
        );
        // 트리거가 evaluation 을 만들지 않았고(active 없음 등) 평가 대상이면 직접 생성.
        const { rows: existingEval } = await client.query(
          `SELECT 1 FROM evaluations WHERE evaluatee_id = $1 AND COALESCE(record_status, 'active') = 'active' LIMIT 1`,
          [employee.employee_id]
        );
        if (updated === 0 && existingEval.length === 0 && roles.includes('evaluatee') && evaluatorId) {
          await client.query(
            `
              INSERT INTO evaluations (
                evaluatee_id, evaluatee_name, evaluatee_position, evaluatee_department,
                growth_level, evaluation_status, evaluation_year, evaluation_period_id,
                created_at, updated_at
              )
              VALUES ($1,$2,$3,$4,$5,'draft',$6,$7,NOW(),NOW())
            `,
            [
              employee.employee_id,
              employee.name,
              employee.position,
              employee.department,
              employee.growth_level ?? 0,
              selectedPeriod.evaluation_year,
              selectedPeriod.id,
            ]
          );
        }
      }
    }

    // 평가자 배정 baseline 이력 생성.
    // (이게 없으면 by-employee 조회의 latest_ah.id IS NOT NULL 조건 때문에 evaluation 이 화면에 나타나지 않는다.)
    if (evaluatorId && roles.includes('evaluatee')) {
      const { rows: evalRows } = await client.query(
        `
          SELECT id, evaluation_period_id
          FROM evaluations
          WHERE evaluatee_id = $1 AND COALESCE(record_status, 'active') = 'active'
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [employee.employee_id]
      );
      const evaluationId = evalRows[0]?.id ?? null;
      if (evaluationId) {
        const { rows: histRows } = await client.query(
          `
            SELECT 1 FROM evaluator_assignment_history
            WHERE employee_id = $1 AND status = 'applied' AND change_type <> 'cancel'
            LIMIT 1
          `,
          [employee.employee_id]
        );
        if (!histRows[0]) {
          const assignmentHistory = await insertEvaluatorAssignmentHistory(client, {
            employeeId: employee.employee_id,
            previousEvaluatorId: null,
            newEvaluatorId: evaluatorId,
            changedBy: getAssignmentActor(body),
            reason: 'Manual employee creation',
            changeType: 'change',
            evaluationId,
            evaluationPeriodId: evalRows[0]?.evaluation_period_id ?? null,
          });
          if (assignmentHistory?.id) {
            await client.query(
              `UPDATE evaluations SET assignment_history_id = $2, updated_at = NOW()
                WHERE id = $1 AND assignment_history_id IS NULL`,
              [evaluationId, assignmentHistory.id]
            );
          }
        }
      }
    }

    await client.query('COMMIT');
    res.status(201).json(employee);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error creating employee:', err);
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

// 단건 사용자 삭제 (admin 제외, 관련 데이터 cascade 정리)
app.delete('/api/employee/:id', async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }
  const employeeId = req.params.id;
  if (employeeId === 'admin') {
    return res.status(409).json({ error: 'admin 계정은 삭제할 수 없습니다.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT 1 FROM employees WHERE employee_id = $1', [employeeId]);
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '직원을 찾을 수 없습니다.' });
    }

    await client.query(
      `DELETE FROM feedback_history
        WHERE evaluator_id = $1
           OR evaluation_id IN (SELECT id FROM evaluations WHERE evaluatee_id = $1)`,
      [employeeId]
    );
    await client.query(
      `DELETE FROM task_evaluation_entries
        WHERE evaluator_id = $1
           OR evaluation_id IN (SELECT id FROM evaluations WHERE evaluatee_id = $1)`,
      [employeeId]
    );
    await client.query(
      `DELETE FROM tasks WHERE evaluation_id IN (SELECT id FROM evaluations WHERE evaluatee_id = $1)`,
      [employeeId]
    );
    await client.query(
      `DELETE FROM evaluator_assignment_history
        WHERE employee_id = $1 OR previous_evaluator_id = $1 OR new_evaluator_id = $1`,
      [employeeId]
    );
    await client.query(
      `DELETE FROM notifications WHERE recipient_id = $1 OR sender_id = $1`,
      [employeeId]
    );
    await client.query(
      `DELETE FROM final_assessment WHERE evaluation_id IN (SELECT id FROM evaluations WHERE evaluatee_id = $1)`,
      [employeeId]
    );
    await client.query(
      `DELETE FROM admin_audit_logs WHERE actor_id = $1 OR target_employee_id = $1`,
      [employeeId]
    );
    await client.query(`DELETE FROM evaluations WHERE evaluatee_id = $1`, [employeeId]);
    // 이 직원을 평가자로 가리키던 다른 직원 정리.
    await client.query(
      `UPDATE employees SET evaluator_id = NULL, updated_at = NOW() WHERE evaluator_id = $1`,
      [employeeId]
    );
    const { rowCount } = await client.query('DELETE FROM employees WHERE employee_id = $1', [employeeId]);
    await client.query('COMMIT');
    res.json({ ok: true, deleted_id: employeeId, deleted: rowCount });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error deleting employee:', err);
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
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
  // 과거 평가자 화면에 노출되는 조건:
  //   1) 현재 마스터 평가자(employees.evaluator_id)가 이 사용자가 아니어야 함.
  //   2) evaluator_assignment_history 에서 이 사용자가 new_evaluator 였던 applied non-cancel 행이 있고,
  //   3) 그 행 이후 다른 평가자로 변경된 applied non-cancel 행이 존재해야 함.
  //   (cancelled 행만 가진 평가자는 자동으로 제외되어, 정정으로 사라진 김남엽/정호영 같은
  //    이력은 노출되지 않는다.)
  if (!isDbAvailable) {
    return res.json([]);
  }

  try {
    const { rows } = await pool.query(
      `
        SELECT DISTINCT e.*
        FROM employees e
        WHERE e.evaluator_id IS DISTINCT FROM $1
          AND EXISTS (
            SELECT 1
            FROM evaluator_assignment_history h
            WHERE h.employee_id = e.employee_id
              AND h.new_evaluator_id = $1
              AND h.status = 'applied'
              AND h.change_type <> 'cancel'
              AND EXISTS (
                SELECT 1
                FROM evaluator_assignment_history later
                WHERE later.employee_id = e.employee_id
                  AND later.status = 'applied'
                  AND later.change_type <> 'cancel'
                  AND (later.changed_at, later.id::text) > (h.changed_at, h.id::text)
                  AND later.new_evaluator_id IS DISTINCT FROM $1
              )
          )
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

app.get('/api/matching-imports/latest-rows', async (req, res) => {
  if (!isDbAvailable) {
    return res.json([]);
  }

  const periodId = req.query.periodId ? String(req.query.periodId) : null;

  try {
    const params = [];
    let periodClause = '';
    if (periodId) {
      params.push(periodId);
      periodClause = ` WHERE evaluation_period_id = $${params.length}::uuid`;
    }
    const { rows } = await pool.query(
      `
        WITH latest_batch AS (
          SELECT id
          FROM matching_import_batches
          ${periodClause}
          ORDER BY created_at DESC
          LIMIT 1
        )
        SELECT
          r.id,
          r.batch_id,
          r.row_number,
          r.employee_id,
          r.employee_name,
          r.org_sequence,
          r.department_id,
          r.department_name,
          TO_CHAR(r.work_start_date, 'YYYY-MM-DD') AS work_start_date,
          TO_CHAR(r.work_end_date, 'YYYY-MM-DD') AS work_end_date,
          r.evaluator_id,
          r.evaluator_name,
          r.confirmer_id,
          r.confirmer_name,
          r.evaluation_type,
          r.matching_result,
          r.is_primary,
          r.validation_status,
          r.validation_message,
          r.raw_data,
          r.created_at,
          b.source_file_name,
          b.source_sheet_name,
          b.created_at AS imported_at
        FROM matching_import_rows r
        INNER JOIN latest_batch lb ON lb.id = r.batch_id
        INNER JOIN matching_import_batches b ON b.id = r.batch_id
        ORDER BY r.row_number
      `,
      params,
    );
    res.json(rows);
  } catch (err) {
    if (MISSING_PERIOD_SCHEMA_CODES.has(err.code)) {
      return res.json([]);
    }
    console.error('Error fetching latest matching import rows:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/employee-profile-imports', async (req, res) => {
  if (!isDbAvailable) {
    return res.json([]);
  }

  try {
    const { rows } = await pool.query(
      `
        SELECT *
        FROM employee_profile_import_batches
        ORDER BY created_at DESC
        LIMIT 20
      `
    );
    res.json(rows);
  } catch (err) {
    if (MISSING_PERIOD_SCHEMA_CODES.has(err.code)) {
      return res.json([]);
    }
    console.error('Error fetching employee profile imports:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/employee-profile-imports/latest-rows', async (req, res) => {
  if (!isDbAvailable) {
    return res.json([]);
  }

  const periodId = req.query.periodId ? String(req.query.periodId) : null;

  try {
    const params = [];
    let periodClause = '';
    if (periodId) {
      params.push(periodId);
      periodClause = ` WHERE evaluation_period_id = $${params.length}::uuid`;
    }
    const { rows } = await pool.query(
      `
        WITH latest_batch AS (
          SELECT id
          FROM employee_profile_import_batches
          ${periodClause}
          ORDER BY created_at DESC
          LIMIT 1
        )
        SELECT
          r.*,
          b.source_file_name,
          b.created_at AS imported_at
        FROM employee_profile_import_rows r
        INNER JOIN latest_batch lb ON lb.id = r.batch_id
        INNER JOIN employee_profile_import_batches b ON b.id = r.batch_id
        ORDER BY r.sheet_name, r.row_number
      `,
      params,
    );
    res.json(rows);
  } catch (err) {
    if (MISSING_PERIOD_SCHEMA_CODES.has(err.code)) {
      return res.json([]);
    }
    console.error('Error fetching latest employee profile import rows:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/employee-profile-imports', async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }

  const sourceFileName = normalizeOptionalText(req.body?.source_file_name ?? req.body?.sourceFileName);
  const evaluationPeriodId = normalizeOptionalText(
    req.body?.evaluation_period_id ?? req.body?.evaluationPeriodId,
  );
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

    const normalizedRows = rawRows
      .map((row, index) => normalizeEmployeeProfileImportRow(row, index))
      // 영문 사번(잘못된 데이터)은 직원으로 만들지 않는다. 평가자 사번이 영문이면 미배정 처리.
      .filter((row) => !startsWithLetter(row.employee_id))
      .map((row) =>
        startsWithLetter(row.evaluator_id) ? { ...row, evaluator_id: null, evaluator_name: null } : row
      );
    const { mergedRows, primaryRowKeys } = mergeEmployeeProfileRows(normalizedRows);
    const sheetNames = [...new Set(normalizedRows.map((row) => row.sheet_name).filter(Boolean))];

    const evaluatorRefs = new Map();
    normalizedRows.forEach((row) => {
      if (row.evaluation_group_id && !startsWithLetter(row.evaluation_group_id)) {
        evaluatorRefs.set(row.evaluation_group_id, {
          name: row.evaluation_group_name ?? row.evaluation_group_id,
          position: null,
        });
      }
      if (row.evaluator_id && !startsWithLetter(row.evaluator_id)) {
        evaluatorRefs.set(row.evaluator_id, {
          name: row.evaluator_name ?? row.evaluator_id,
          position: row.evaluator_position ?? null,
        });
      }
    });

    const { rows: batchRows } = await client.query(
      `
        INSERT INTO employee_profile_import_batches (
          source_file_name,
          source_sheet_names,
          imported_by,
          row_count,
          status,
          evaluation_period_id
        )
        VALUES ($1,$2::text[],$3,$4,'applied',$5)
        RETURNING *
      `,
      [sourceFileName, sheetNames, importedBy, normalizedRows.length, evaluationPeriodId]
    );
    const batch = batchRows[0];

    for (const row of normalizedRows) {
      await client.query(
        `
          INSERT INTO employee_profile_import_rows (
            batch_id,
            sheet_name,
            row_number,
            evaluation_group,
            evaluation_group_id,
            evaluation_group_name,
            employee_id,
            employee_name,
            org_sequence,
            department_id,
            department_name,
            work_start_date,
            work_end_date,
            growth_level,
            growth_level_label,
            position,
            job_role,
            evaluator_id,
            evaluator_name,
            evaluator_position,
            target_status,
            available_roles,
            is_primary,
            validation_status,
            validation_message,
            raw_data,
            org_corporation,
            org_division,
            org_department,
            org_team
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::text[],$23,$24,$25,$26::jsonb,$27,$28,$29,$30)
        `,
        [
          batch.id,
          row.sheet_name,
          row.row_number,
          row.evaluation_group,
          row.evaluation_group_id,
          row.evaluation_group_name,
          row.employee_id,
          row.employee_name,
          row.org_sequence,
          row.department_id,
          row.department_name,
          row.work_start_date,
          row.work_end_date,
          row.growth_level,
          row.growth_level_label,
          row.position,
          row.job_role,
          row.evaluator_id,
          row.evaluator_name,
          row.evaluator_position,
          row.target_status,
          row.available_roles ?? [],
          primaryRowKeys.has(`${row.sheet_name}:${row.row_number}`),
          row.validation_status,
          row.validation_message,
          JSON.stringify(row.raw_data ?? {}),
          row.org_corporation ?? null,
          row.org_division ?? null,
          row.org_department ?? null,
          row.org_team ?? null,
        ]
      );
    }

    for (const [evaluatorId, evaluator] of evaluatorRefs.entries()) {
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
          VALUES ($1,$2,$3,'미지정',ARRAY['evaluator']::text[],NOW(),NOW())
          ON CONFLICT (employee_id) DO UPDATE SET
            name = COALESCE(EXCLUDED.name, employees.name),
            position = CASE
              WHEN employees.position IN ('평가자', '미등록') THEN COALESCE(EXCLUDED.position, employees.position)
              ELSE employees.position
            END,
            available_roles = (
              SELECT array_agg(role ORDER BY CASE role WHEN 'evaluatee' THEN 1 WHEN 'evaluator' THEN 2 WHEN 'hr' THEN 3 ELSE 9 END)
              FROM (
                SELECT DISTINCT role
                FROM unnest(employees.available_roles || ARRAY['evaluator']::text[]) AS roles(role)
              ) AS unique_roles
            ),
            updated_at = NOW()
        `,
        [evaluatorId, evaluator.name, evaluator.position ?? '평가자']
      );
    }

    for (const row of mergedRows) {
      const fileRoles = row.available_roles ?? [];
      const isEvaluatorRef = evaluatorRefs.has(row.employee_id);
      const hasFileRoles = fileRoles.length > 0;
      const fallbackRoles = isEvaluatorRef ? ['evaluatee', 'evaluator'] : ['evaluatee'];
      const baseRoles = hasFileRoles ? fileRoles : fallbackRoles;
      const roles =
        isEvaluatorRef && !baseRoles.includes('evaluator')
          ? [...baseRoles, 'evaluator']
          : baseRoles;
      await client.query(
        `
          INSERT INTO employees (
            employee_id,
            name,
            position,
            department,
            department_id,
            growth_level,
            available_roles,
            org_sequence,
            work_start_date,
            work_end_date,
            evaluation_group_id,
            evaluation_group_name,
            job_role,
            target_status,
            last_profile_batch_id,
            org_corporation,
            org_division,
            org_department,
            org_team,
            created_at,
            updated_at
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7::text[],$8,$9,$10,$11,$12,$13,$14,$15,$17,$18,$19,$20,NOW(),NOW())
          ON CONFLICT (employee_id) DO UPDATE SET
            name = EXCLUDED.name,
            position = EXCLUDED.position,
            department = EXCLUDED.department,
            department_id = EXCLUDED.department_id,
            growth_level = EXCLUDED.growth_level,
            available_roles = CASE
              WHEN $16::boolean THEN (
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
              )
              ELSE (
                SELECT array_agg(role ORDER BY CASE role WHEN 'evaluatee' THEN 1 WHEN 'evaluator' THEN 2 WHEN 'hr' THEN 3 ELSE 9 END)
                FROM (
                  SELECT DISTINCT role
                  FROM unnest(employees.available_roles || EXCLUDED.available_roles) AS roles(role)
                ) AS unique_roles
              )
            END,
            org_sequence = EXCLUDED.org_sequence,
            work_start_date = EXCLUDED.work_start_date,
            work_end_date = EXCLUDED.work_end_date,
            evaluation_group_id = EXCLUDED.evaluation_group_id,
            evaluation_group_name = EXCLUDED.evaluation_group_name,
            job_role = EXCLUDED.job_role,
            target_status = EXCLUDED.target_status,
            last_profile_batch_id = EXCLUDED.last_profile_batch_id,
            org_corporation = EXCLUDED.org_corporation,
            org_division = EXCLUDED.org_division,
            org_department = EXCLUDED.org_department,
            org_team = EXCLUDED.org_team,
            updated_at = NOW()
        `,
        [
          row.employee_id,
          row.employee_name,
          row.position ?? '미등록',
          row.department_name ?? '미지정',
          row.department_id,
          row.growth_level,
          roles,
          row.org_sequence,
          row.work_start_date,
          row.work_end_date,
          row.evaluation_group_id,
          row.evaluation_group_name,
          row.job_role,
          row.target_status,
          batch.id,
          hasFileRoles,
          row.org_corporation ?? null,
          row.org_division ?? null,
          row.org_department ?? null,
          row.org_team ?? null,
        ]
      );
    }

    // 대상자 업로드 평가기간 귀속:
    // 업로드한 평가기간에 evaluatee 대상자의 evaluation 을 보장한다(평가자 유무 무관).
    // 이게 있어야 "그 평가기간에 업로드한 대상자는 그 기간 화면에만 표시"가 성립한다.
    if (evaluationPeriodId) {
      const { rows: periodRows } = await client.query(
        'SELECT id, evaluation_year FROM evaluation_periods WHERE id = $1 LIMIT 1',
        [evaluationPeriodId]
      );
      const targetPeriod = periodRows[0];
      if (targetPeriod) {
        for (const row of mergedRows) {
          const { rows: empRows } = await client.query(
            'SELECT * FROM employees WHERE employee_id = $1 LIMIT 1',
            [row.employee_id]
          );
          const emp = empRows[0];
          if (!emp || !(emp.available_roles ?? []).includes('evaluatee')) continue;

          // 이 평가기간에 evaluation 이 없으면 생성.
          const { rows: existing } = await client.query(
            `SELECT id FROM evaluations
              WHERE evaluatee_id = $1 AND evaluation_period_id = $2
                AND COALESCE(record_status, 'active') = 'active'
              LIMIT 1`,
            [emp.employee_id, targetPeriod.id]
          );
          let evaluationId = existing[0]?.id ?? null;
          if (!evaluationId) {
            const { rows: created } = await client.query(
              `
                INSERT INTO evaluations (
                  evaluatee_id, evaluatee_name, evaluatee_position, evaluatee_department,
                  growth_level, evaluation_status, evaluation_year, evaluation_period_id,
                  created_at, updated_at
                )
                VALUES ($1,$2,$3,$4,$5,'draft',$6,$7,NOW(),NOW())
                RETURNING id
              `,
              [
                emp.employee_id,
                emp.name,
                emp.position,
                emp.department,
                emp.growth_level ?? 0,
                targetPeriod.evaluation_year,
                targetPeriod.id,
              ]
            );
            evaluationId = created[0].id;
          }

          // 평가자가 지정되어 있으면 baseline 이력 보장.
          if (evaluationId && emp.evaluator_id) {
            const { rows: histRows } = await client.query(
              `SELECT 1 FROM evaluator_assignment_history
                WHERE evaluation_id = $1 AND status = 'applied' AND change_type <> 'cancel' LIMIT 1`,
              [evaluationId]
            );
            if (!histRows[0]) {
              const ah = await insertEvaluatorAssignmentHistory(client, {
                employeeId: emp.employee_id,
                previousEvaluatorId: null,
                newEvaluatorId: emp.evaluator_id,
                changedBy: importedBy,
                reason: 'Profile import baseline',
                changeType: 'change',
                evaluationId,
                evaluationPeriodId: targetPeriod.id,
              });
              if (ah?.id) {
                await client.query(
                  `UPDATE evaluations SET assignment_history_id = $2, updated_at = NOW()
                    WHERE id = $1 AND assignment_history_id IS NULL`,
                  [evaluationId, ah.id]
                );
              }
            }
          }
        }
      }
    }

    const warningCount = normalizedRows.filter((row) => row.validation_status === 'warning').length;
    const errorCount = normalizedRows.filter((row) => row.validation_status === 'error').length;
    const { rows: updatedBatchRows } = await client.query(
      `
        UPDATE employee_profile_import_batches
        SET
          applied_count = $2,
          warning_count = $3,
          error_count = $4
        WHERE id = $1
        RETURNING *
      `,
      [batch.id, mergedRows.length, warningCount, errorCount]
    );

    await insertAdminAuditLog(client, {
      actionType: 'employee_profile_import',
      actorId: importedBy,
      targetEmployeeId: null,
      previousValue: { source_file_name: sourceFileName },
      newValue: {
        batch_id: batch.id,
        row_count: normalizedRows.length,
        applied_count: mergedRows.length,
        evaluator_count: evaluatorRefs.size,
      },
      reason: `Employee profile import: ${sourceFileName}`,
    });

    const importerName = await resolveEmployeeName(client, importedBy, 'HR');
    const { rows: hrRecipients } = await client.query(
      `SELECT employee_id FROM employees WHERE 'hr' = ANY(available_roles)`
    );
    const summaryMessage = `${sourceFileName} · ${mergedRows.length}명 반영 · 평가자 ${evaluatorRefs.size}명 · 경고 ${warningCount}건`;
    for (const recipient of hrRecipients) {
      await insertNotificationRow(client, {
        notificationType: 'profile_imported',
        title: '평가대상자가 반영되었습니다',
        message: summaryMessage,
        priority: 'low',
        senderId: importedBy,
        senderName: importerName,
        recipientId: recipient.employee_id,
      });
    }

    await client.query('COMMIT');
    res.json({
      batch: updatedBatchRows[0],
      row_count: normalizedRows.length,
      applied_count: mergedRows.length,
      evaluator_count: evaluatorRefs.size,
      warning_count: warningCount,
      error_count: errorCount,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error importing employee profile file:', err);
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

// ── 매칭 reconcile 엔진 ────────────────────────────────────────────
// 매칭 파일 = 해당 직원의 평가자 단계(타임라인)에 대한 "정답(source of truth)".
// 같은 파일 안 여러 행을 시간순 단계로 묶고, DB 이력을 그 단계 집합에 맞춰 동기화한다.
//   - 같은 발령일·같은 평가자        → 동일(unchanged): 그대로 둠
//   - 같은 발령일·다른 평가자        → 정정(corrected): 기존 행을 supersede (평행 baseline 금지)
//   - 같은 평가자·다른 발령일        → 무시(ignoredDate): 기존 발령일 유지, 파일 날짜 미반영
//   - 파일에만 있는 단계            → 신규(created): 새 평가+이력 생성
//   - 파일에 없는 기존 단계         → 삭제(removed): 이력·평가 취소
// 종료일/근무기간은 저장 컬럼이 아니라 다음 단계 발령일로부터 파생되므로,
// 단계 집합만 맞으면 "연말까지" 등 종료일은 자동으로 일관된다.

// 한 직원의 매칭 행들을 시간순 평가자 단계로 변환(연속 동일 평가자 병합).
// 정렬: work_start_date 가 있는 행을 먼저(ASC), 빈 날짜 행은 뒤로.
//   (이렇게 해야 한 평가자에 대해 정상 날짜 행과 빈 날짜 행이 섞여 있을 때
//    빈 날짜가 stage 의 startDate 를 덮어쓰지 않는다 — 빈 날짜 행은 병합 단계에서
//    같은 평가자면 endDate 만 갱신하고 startDate 는 정상 날짜를 유지.)
const buildMatchingStagesForEmployee = (rows) => {
  const valid = rows.filter((r) => r.evaluator_id && r.validation_status !== 'error');
  const sorted = [...valid].sort((a, b) => {
    const hasA = !!a.work_start_date;
    const hasB = !!b.work_start_date;
    if (hasA !== hasB) return hasA ? -1 : 1; // null/empty 는 뒤로
    if (hasA && hasB) {
      const sa = Date.parse(a.work_start_date) || 0;
      const sb = Date.parse(b.work_start_date) || 0;
      if (sa !== sb) return sa - sb;
    }
    return (Number(a.org_sequence) || 0) - (Number(b.org_sequence) || 0);
  });
  const stages = [];
  for (const r of sorted) {
    const startDate = r.work_start_date ? String(r.work_start_date).slice(0, 10) : null;
    const endDate = r.work_end_date ? String(r.work_end_date).slice(0, 10) : null;
    const last = stages[stages.length - 1];
    if (last && last.evaluatorId === r.evaluator_id) {
      // 같은 평가자 연속 행: startDate 는 처음 들어온(정상) 값 유지, endDate 만 채움.
      last.endDate = endDate ?? last.endDate;
      if (!last.startDate && startDate) last.startDate = startDate;
      continue;
    }
    stages.push({
      evaluatorId: r.evaluator_id,
      evaluatorName: r.evaluator_name ?? null,
      startDate,
      endDate,
      department: r.department_name ?? null,
    });
  }
  return stages;
};

// 같은 평가(evaluation) 위에서 평가자만 정정(supersede). 점수/피드백 ownership 이전.
// employees.evaluator_id 갱신과 prev 보정은 호출부(reconcile)에서 일괄 처리한다.
const supersedeAssignmentEvaluator = async (
  client,
  { history, newEvaluatorId, actorId, reason, changedAt }
) => {
  const correctionRow = await insertEvaluatorAssignmentHistory(client, {
    employeeId: history.employee_id,
    previousEvaluatorId: history.new_evaluator_id ?? null,
    newEvaluatorId: newEvaluatorId ?? null,
    changedBy: actorId,
    reason: reason || 'Matching reconcile correction',
    changeType: 'change',
    status: 'applied',
    supersedesHistoryId: history.id,
    evaluationId: history.evaluation_id ?? null,
    evaluationPeriodId: history.evaluation_period_id ?? null,
    changedAt: changedAt ?? null,
  });
  await client.query(
    `UPDATE evaluator_assignment_history
       SET status='cancelled', cancelled_at=NOW(), cancelled_by=$2,
           cancel_reason='Superseded by matching reconcile'
     WHERE id=$1`,
    [history.id, actorId ?? null]
  );
  if (history.evaluation_id) {
    await client.query(
      `UPDATE evaluations SET record_status='active', assignment_history_id=$2, updated_at=NOW()
       WHERE id=$1`,
      [history.evaluation_id, correctionRow.id]
    );
    await transferEvaluatorEntriesForCorrectionScoped(client, {
      evaluationId: history.evaluation_id,
      previousEvaluatorId: history.new_evaluator_id ?? null,
      newEvaluatorId: newEvaluatorId ?? null,
      actorId,
      reason: reason || 'Matching reconcile correction',
    });
  }
  return correctionRow;
};

// 직원별 평가자 단계 동기화. result 카운트와 평가자 배정 변동(알림용)을 반환.
const reconcileEmployeeMatchingStages = async (
  client,
  { employee, stages, periodId, periodYear, importedBy, sourceFileName }
) => {
  const employeeId = employee.employee_id;
  const result = {
    created: 0,
    corrected: 0,
    unchanged: 0,
    ignoredDate: 0,
    removed: 0,
    assignedEvaluators: [],
    releasedEvaluators: [],
  };

  // ── 빈 중복 평가 정리 ─────────────────────────────────────────
  // 프로필 업로드가 "평가기간 노출용"으로 만들어둔 빈 draft 평가가 있으면
  // reconcile 들어오기 전에 제거한다. 매칭이 들어왔다는 건 이 사람의
  // 단계별 평가가 새로 생성될 거라는 뜻이므로, 이력·과업·엔트리·피드백이
  // 전혀 없는 빈 껍데기는 잉여(빈 중복)다. 안전 조건을 모두 만족할 때만 삭제.
  await client.query(
    `DELETE FROM evaluations e
      WHERE COALESCE(e.record_status,'active')='active'
        AND e.evaluatee_id = $1
        AND COALESCE(e.evaluation_period_id::text,'') = COALESCE($2::text,'')
        AND e.assignment_history_id IS NULL
        AND e.evaluation_status = 'draft'
        AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.evaluation_id = e.id)
        AND NOT EXISTS (SELECT 1 FROM task_evaluation_entries x WHERE x.evaluation_id = e.id)
        AND NOT EXISTS (SELECT 1 FROM feedback_history f WHERE f.evaluation_id = e.id)
        AND NOT EXISTS (SELECT 1 FROM evaluator_assignment_history h WHERE h.evaluation_id = e.id)`,
    [employeeId, periodId ?? null]
  );

  const { rows: existing } = await client.query(
    `SELECT id, evaluation_id, new_evaluator_id, to_char(changed_at,'YYYY-MM-DD') AS date_str
       FROM evaluator_assignment_history
      WHERE employee_id=$1 AND status='applied' AND change_type<>'cancel'
      ORDER BY changed_at ASC, id ASC`,
    [employeeId]
  );
  const reason = `Matching reconcile: ${sourceFileName}`;
  const existingMatched = new Array(existing.length).fill(false);
  const stageMatched = new Array(stages.length).fill(false);

  // pass 1: 정확 일치(발령일+평가자) → 동일
  stages.forEach((fs, si) => {
    const ei = existing.findIndex(
      (e, idx) =>
        !existingMatched[idx] &&
        e.date_str === fs.startDate &&
        (e.new_evaluator_id ?? null) === (fs.evaluatorId ?? null)
    );
    if (ei >= 0) {
      existingMatched[ei] = true;
      stageMatched[si] = true;
      result.unchanged += 1;
    }
  });

  // pass 2: 같은 발령일·다른 평가자 → 정정(supersede)
  for (let si = 0; si < stages.length; si += 1) {
    if (stageMatched[si]) continue;
    const fs = stages[si];
    const ei = existing.findIndex(
      (e, idx) =>
        !existingMatched[idx] &&
        e.date_str === fs.startDate &&
        (e.new_evaluator_id ?? null) !== (fs.evaluatorId ?? null)
    );
    if (ei >= 0) {
      const e = existing[ei];
      await supersedeAssignmentEvaluator(client, {
        history: {
          id: e.id,
          employee_id: employeeId,
          new_evaluator_id: e.new_evaluator_id,
          evaluation_id: e.evaluation_id,
          evaluation_period_id: periodId,
        },
        newEvaluatorId: fs.evaluatorId,
        actorId: importedBy,
        reason,
        changedAt: fs.startDate,
      });
      result.assignedEvaluators.push(fs.evaluatorId);
      if (e.new_evaluator_id) result.releasedEvaluators.push(e.new_evaluator_id);
      existingMatched[ei] = true;
      stageMatched[si] = true;
      result.corrected += 1;
    }
  }

  // pass 3: 같은 평가자·다른 발령일 → 무시(기존 발령일 유지)
  for (let si = 0; si < stages.length; si += 1) {
    if (stageMatched[si]) continue;
    const fs = stages[si];
    const ei = existing.findIndex(
      (e, idx) => !existingMatched[idx] && (e.new_evaluator_id ?? null) === (fs.evaluatorId ?? null)
    );
    if (ei >= 0) {
      existingMatched[ei] = true;
      stageMatched[si] = true;
      result.ignoredDate += 1;
    }
  }

  // pass 4: 파일에만 있는 단계 → 신규 평가+이력
  for (let si = 0; si < stages.length; si += 1) {
    if (stageMatched[si]) continue;
    const fs = stages[si];
    const prevStage = stages.slice(0, si).reverse().find((s) => s.evaluatorId);
    const evaluation = await createDraftEvaluationForEmployeeAssignment(client, employee, periodId);
    const hist = await insertEvaluatorAssignmentHistory(client, {
      employeeId,
      previousEvaluatorId: prevStage?.evaluatorId ?? null,
      newEvaluatorId: fs.evaluatorId,
      changedBy: importedBy,
      reason,
      changeType: 'change',
      evaluationId: evaluation?.id ?? null,
      evaluationPeriodId: evaluation?.evaluation_period_id ?? periodId,
      changedAt: fs.startDate,
    });
    if (evaluation?.id && hist?.id) {
      await client.query(
        `UPDATE evaluations SET assignment_history_id=$2, updated_at=NOW() WHERE id=$1`,
        [evaluation.id, hist.id]
      );
    }
    result.assignedEvaluators.push(fs.evaluatorId);
    stageMatched[si] = true;
    result.created += 1;
  }

  // pass 5: 파일에 없는 기존 단계 → 삭제(이력·평가 취소)
  for (let ei = 0; ei < existing.length; ei += 1) {
    if (existingMatched[ei]) continue;
    const e = existing[ei];
    await client.query(
      `UPDATE evaluator_assignment_history
         SET status='cancelled', cancelled_at=NOW(), cancelled_by=$2,
             cancel_reason='Removed by matching reconcile (not in file)'
       WHERE id=$1`,
      [e.id, importedBy ?? null]
    );
    if (e.evaluation_id) {
      await client.query(
        `UPDATE evaluations SET record_status='cancelled', updated_at=NOW()
         WHERE id=$1 AND COALESCE(record_status,'active')='active'`,
        [e.evaluation_id]
      );
      await client.query(
        `UPDATE task_evaluation_entries SET status='cancelled', cancelled_at=NOW(), cancelled_by=$2,
               cancel_reason='Removed by matching reconcile'
         WHERE evaluation_id=$1 AND COALESCE(status,'active')='active'`,
        [e.evaluation_id, importedBy ?? null]
      );
      await client.query(
        `UPDATE feedback_history SET status='cancelled', cancelled_at=NOW(), cancelled_by=$2,
               cancel_reason='Removed by matching reconcile'
         WHERE evaluation_id=$1 AND COALESCE(status,'active')='active'`,
        [e.evaluation_id, importedBy ?? null]
      );
    }
    if (e.new_evaluator_id) result.releasedEvaluators.push(e.new_evaluator_id);
    result.removed += 1;
  }

  // 현재 평가자 = 마지막(가장 늦은 발령일) 단계의 평가자. prev 링크 일관화.
  const orderedStages = stages.filter((s) => s.evaluatorId);
  const lastStage = orderedStages.length ? orderedStages[orderedStages.length - 1] : null;
  await client.query(`UPDATE employees SET evaluator_id=$2, updated_at=NOW() WHERE employee_id=$1`, [
    employeeId,
    lastStage?.evaluatorId ?? null,
  ]);
  await reconcilePreviousEvaluatorIds(client, employeeId);

  return result;
};

app.post('/api/matching-imports', async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }

  const sourceFileName = normalizeOptionalText(req.body?.source_file_name ?? req.body?.sourceFileName);
  const sourceSheetName = normalizeOptionalText(req.body?.source_sheet_name ?? req.body?.sourceSheetName);
  const evaluationPeriodId = normalizeOptionalText(
    req.body?.evaluation_period_id ?? req.body?.evaluationPeriodId,
  );
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

    const normalizedRows = rawRows
      .map((row, index) => normalizeMatchingImportRow(row, index))
      // 영문 사번(잘못된 데이터)은 직원으로 만들지 않는다. 평가자 사번이 영문이면 미배정 처리.
      .filter((row) => !startsWithLetter(row.employee_id))
      .map((row) =>
        startsWithLetter(row.evaluator_id) ? { ...row, evaluator_id: null, evaluator_name: null } : row
      );
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
        'SELECT * FROM employees WHERE employee_id = ANY($1::text[])',
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
          status,
          evaluation_period_id
        )
        VALUES ($1,$2,$3,$4,'applied',$5)
        RETURNING *
      `,
      [sourceFileName, sourceSheetName, importedBy, normalizedRows.length, evaluationPeriodId]
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
            raw_data,
            org_corporation,
            org_division,
            org_department,
            org_team
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21,$22,$23)
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
          row.org_corporation ?? null,
          row.org_division ?? null,
          row.org_department ?? null,
          row.org_team ?? null,
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
                  employees.available_roles ||
                  EXCLUDED.available_roles
                ) AS roles(role)
              ) AS unique_roles
            ),
            updated_at = NOW()
        `,
        [evaluatorId, evaluatorName]
      );
    }

    // 매칭 reconcile 결과 집계 (파일=정답 기준)
    let createdEvaluations = 0;
    let correctedAssignments = 0;
    let removedStages = 0;
    let ignoredDateStages = 0;
    let unchangedStages = 0;
    const evaluatorAssignmentChanges = new Map();
    const evaluatorAssignmentReleases = new Map();
    const employeeAssignmentChanges = [];

    const recordAssignmentChange = (evaluatorId, employeeName) => {
      if (!evaluatorId) return;
      const list = evaluatorAssignmentChanges.get(evaluatorId) ?? [];
      list.push(employeeName);
      evaluatorAssignmentChanges.set(evaluatorId, list);
    };
    const recordAssignmentRelease = (evaluatorId, employeeName) => {
      if (!evaluatorId) return;
      const list = evaluatorAssignmentReleases.get(evaluatorId) ?? [];
      list.push(employeeName);
      evaluatorAssignmentReleases.set(evaluatorId, list);
    };

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
            org_corporation,
            org_division,
            org_department,
            org_team,
            created_at,
            updated_at
          )
          VALUES ($1,$2,'구성원',$3,$4,NULL,$5,$6::text[],$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),NOW())
          ON CONFLICT (employee_id) DO UPDATE SET
            evaluator_id = EXCLUDED.evaluator_id,
            available_roles = (
              SELECT array_agg(role ORDER BY CASE role WHEN 'evaluatee' THEN 1 WHEN 'evaluator' THEN 2 WHEN 'hr' THEN 3 ELSE 9 END)
              FROM (
                SELECT DISTINCT role
                FROM unnest(
                  employees.available_roles ||
                  EXCLUDED.available_roles
                ) AS roles(role)
              ) AS unique_roles
            ),
            evaluation_type = EXCLUDED.evaluation_type,
            matching_result = EXCLUDED.matching_result,
            confirmer_id = EXCLUDED.confirmer_id,
            confirmer_name = EXCLUDED.confirmer_name,
            last_matching_batch_id = EXCLUDED.last_matching_batch_id,
            org_corporation = EXCLUDED.org_corporation,
            org_division = EXCLUDED.org_division,
            org_department = EXCLUDED.org_department,
            org_team = EXCLUDED.org_team,
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
          row.org_corporation ?? null,
          row.org_division ?? null,
          row.org_department ?? null,
          row.org_team ?? null,
        ]
      );
    }

    // ── 파일=정답 기준 reconcile: 직원별 평가자 단계 동기화 ──────────
    const periodForReconcile = await getAssignmentEvaluationPeriod(client, evaluationPeriodId);
    const stagesByEmployee = new Map();
    for (const row of normalizedRows) {
      if (!row.employee_id || row.validation_status === 'error') continue;
      if (!stagesByEmployee.has(row.employee_id)) stagesByEmployee.set(row.employee_id, []);
      stagesByEmployee.get(row.employee_id).push(row);
    }
    for (const [empId, empRows] of stagesByEmployee.entries()) {
      const { rows: empRowResult } = await client.query(
        'SELECT * FROM employees WHERE employee_id=$1 LIMIT 1',
        [empId]
      );
      const employeeRow = empRowResult[0];
      if (!employeeRow) continue;
      const stages = buildMatchingStagesForEmployee(empRows);
      if (stages.length === 0) continue;
      const r = await reconcileEmployeeMatchingStages(client, {
        employee: employeeRow,
        stages,
        periodId: periodForReconcile?.id ?? evaluationPeriodId ?? null,
        periodYear: periodForReconcile?.evaluation_year ?? getCurrentEvaluationYear(),
        importedBy,
        sourceFileName,
      });
      createdEvaluations += r.created;
      correctedAssignments += r.corrected;
      removedStages += r.removed;
      ignoredDateStages += r.ignoredDate;
      unchangedStages += r.unchanged;
      const empName = employeeRow.name ?? empId;
      for (const evId of new Set(r.assignedEvaluators)) recordAssignmentChange(evId, empName);
      for (const evId of new Set(r.releasedEvaluators)) recordAssignmentRelease(evId, empName);
      if (r.created || r.corrected) {
        const finalEvaluatorName = stages[stages.length - 1]?.evaluatorName ?? null;
        employeeAssignmentChanges.push({ employeeId: empId, evaluatorName: finalEvaluatorName });
      }
    }

    if (importedBy) {
      const importerName = await resolveEmployeeName(client, importedBy, 'HR');
      for (const [evaluatorId, employeeNames] of evaluatorAssignmentChanges.entries()) {
        const sample = employeeNames.slice(0, 3).join(', ');
        const more = employeeNames.length > 3 ? ` 외 ${employeeNames.length - 3}명` : '';
        await insertNotificationRow(client, {
          notificationType: 'evaluator_changed',
          title: '담당 피평가자가 배정되었습니다',
          message: `${sample}${more} (총 ${employeeNames.length}명)이 회원님의 피평가자로 배정되었습니다.`,
          priority: 'medium',
          senderId: importedBy,
          senderName: importerName,
          recipientId: evaluatorId,
        });
      }
      for (const [evaluatorId, employeeNames] of evaluatorAssignmentReleases.entries()) {
        const sample = employeeNames.slice(0, 3).join(', ');
        const more = employeeNames.length > 3 ? ` 외 ${employeeNames.length - 3}명` : '';
        await insertNotificationRow(client, {
          notificationType: 'evaluator_unassigned',
          title: '담당 피평가자가 해제되었습니다',
          message: `${sample}${more} (총 ${employeeNames.length}명)이 담당에서 해제되었습니다.`,
          priority: 'low',
          senderId: importedBy,
          senderName: importerName,
          recipientId: evaluatorId,
        });
      }
      for (const change of employeeAssignmentChanges) {
        await insertNotificationRow(client, {
          notificationType: 'evaluator_changed',
          title: '평가자가 변경되었습니다',
          message: change.evaluatorName
            ? `${change.evaluatorName}님이 새로운 평가자로 배정되었습니다.`
            : '담당 평가자가 새로 배정되었습니다.',
          priority: 'medium',
          senderId: importedBy,
          senderName: importerName,
          recipientId: change.employeeId,
        });
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
        corrected_assignments: correctedAssignments,
        removed_stages: removedStages,
      },
      reason: `Matching import: ${sourceFileName}`,
    });

    await client.query('COMMIT');
    res.json({
      batch: updatedBatchRows[0],
      row_count: normalizedRows.length,
      applied_count: primaryRows.length,
      evaluator_count: evaluatorRefs.size,
      changed_evaluator_count: createdEvaluations + correctedAssignments,
      warning_count: warningCount,
      error_count: errorCount,
      created_evaluations: createdEvaluations,
      corrected_assignments: correctedAssignments,
      removed_stages: removedStages,
      ignored_date_stages: ignoredDateStages,
      unchanged_stages: unchangedStages,
      assignment_history_count: createdEvaluations + correctedAssignments,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error importing matching file:', err.message, err.code, err.where ?? '');
    res.status(500).json({ error: 'Database error', detail: err.message });
  } finally {
    client.release();
  }
});

// 매칭 업로드 변경 미리보기(dry-run): reconcile 규칙으로 분류만 하고 DB 는 건드리지 않는다.
app.post('/api/matching-imports/preview', async (req, res) => {
  const emptySummary = { new: 0, changed: 0, unchanged: 0, ignored: 0, error: 0, total: 0 };
  if (!isDbAvailable) return res.json({ items: [], summary: emptySummary });
  try {
    const rawRows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const byEmp = new Map();
    for (const r of rawRows) {
      const id = (r.employee_id ?? '').toString().trim();
      if (!id) continue;
      if (!byEmp.has(id)) byEmp.set(id, []);
      byEmp.get(id).push(r);
    }
    const empIds = [...byEmp.keys()];
    const evIds = new Set();
    for (const rows of byEmp.values())
      for (const r of rows) if (r.evaluator_id) evIds.add(String(r.evaluator_id).trim());
    const allIds = [...new Set([...empIds, ...evIds])];
    const nameMap = new Map();
    if (allIds.length) {
      const { rows } = await pool.query(
        'SELECT employee_id, name FROM employees WHERE employee_id = ANY($1::text[])',
        [allIds]
      );
      for (const e of rows) nameMap.set(e.employee_id, e.name);
    }
    const evName = (id) => (id ? nameMap.get(id) ?? id : '평가자 없음');
    const histByEmp = new Map();
    if (empIds.length) {
      const { rows: hist } = await pool.query(
        `SELECT employee_id, new_evaluator_id, to_char(changed_at,'YYYY-MM-DD') AS date_str
           FROM evaluator_assignment_history
          WHERE employee_id = ANY($1::text[]) AND status='applied' AND change_type<>'cancel'
          ORDER BY changed_at ASC, id ASC`,
        [empIds]
      );
      for (const h of hist) {
        if (!histByEmp.has(h.employee_id)) histByEmp.set(h.employee_id, []);
        histByEmp.get(h.employee_id).push({ evaluator: h.new_evaluator_id, date: h.date_str });
      }
    }
    const items = [];
    for (const [empId, rowsForEmp] of byEmp.entries()) {
      const name = rowsForEmp.find((r) => r.employee_name)?.employee_name ?? nameMap.get(empId) ?? empId;
      const stages = buildMatchingStagesForEmployee(rowsForEmp);
      const existing = histByEmp.get(empId) ?? [];
      const existingMatched = new Array(existing.length).fill(false);
      const stageMatched = new Array(stages.length).fill(false);
      const changes = [];
      let corrected = 0,
        created = 0,
        removed = 0,
        ignored = 0;
      stages.forEach((fs, si) => {
        const ei = existing.findIndex(
          (e, idx) => !existingMatched[idx] && e.date === fs.startDate && (e.evaluator ?? null) === (fs.evaluatorId ?? null)
        );
        if (ei >= 0) {
          existingMatched[ei] = true;
          stageMatched[si] = true;
        }
      });
      for (let si = 0; si < stages.length; si += 1) {
        if (stageMatched[si]) continue;
        const fs = stages[si];
        const ei = existing.findIndex(
          (e, idx) => !existingMatched[idx] && e.date === fs.startDate && (e.evaluator ?? null) !== (fs.evaluatorId ?? null)
        );
        if (ei >= 0) {
          existingMatched[ei] = true;
          stageMatched[si] = true;
          corrected += 1;
          changes.push({ field: `정정 · ${fs.startDate}`, before: evName(existing[ei].evaluator), after: evName(fs.evaluatorId) });
        }
      }
      for (let si = 0; si < stages.length; si += 1) {
        if (stageMatched[si]) continue;
        const fs = stages[si];
        const ei = existing.findIndex((e, idx) => !existingMatched[idx] && (e.evaluator ?? null) === (fs.evaluatorId ?? null));
        if (ei >= 0) {
          existingMatched[ei] = true;
          stageMatched[si] = true;
          ignored += 1;
          changes.push({ field: `발령일 무시 · ${evName(fs.evaluatorId)}`, before: existing[ei].date, after: `${fs.startDate} (평가자 동일)` });
        }
      }
      for (let si = 0; si < stages.length; si += 1) {
        if (stageMatched[si]) continue;
        const fs = stages[si];
        stageMatched[si] = true;
        created += 1;
        changes.push({ field: `신규 발령 · ${fs.startDate}`, before: '—', after: evName(fs.evaluatorId) });
      }
      for (let ei = 0; ei < existing.length; ei += 1) {
        if (existingMatched[ei]) continue;
        removed += 1;
        changes.push({ field: `삭제 · ${existing[ei].date}`, before: evName(existing[ei].evaluator), after: '제거' });
      }
      // 파일에 평가자 단계가 하나도 없으면(예: 모든 행이 평가자 미지정) apply 는 SKIP 한다.
      // 미리보기도 동일하게 "변동 없음"으로 표시한다.
      let status;
      if (stages.length === 0) {
        status = 'unchanged';
      } else if (existing.length === 0) {
        status = 'new';
      } else if (corrected || created || removed) {
        status = 'changed';
      } else if (ignored) {
        status = 'ignored';
      } else {
        status = 'unchanged';
      }
      // stages 가 없으면 pass 5 에서 잘못 쌓인 "삭제" 안내도 비운다(실제 apply 는 skip 이므로).
      if (stages.length === 0) {
        items.push({ employeeId: empId, name, status, changes: [] });
      } else {
        items.push({ employeeId: empId, name, status, changes });
      }
    }
    const summary = {
      new: items.filter((i) => i.status === 'new').length,
      changed: items.filter((i) => i.status === 'changed').length,
      unchanged: items.filter((i) => i.status === 'unchanged').length,
      ignored: items.filter((i) => i.status === 'ignored').length,
      error: items.filter((i) => i.status === 'error').length,
      total: items.length,
    };
    res.json({ items, summary });
  } catch (err) {
    console.error('Error previewing matching import:', err.message);
    res.status(500).json({ error: 'Database error' });
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
      const assignmentChangedAt = getAssignmentEffectiveDate(updates);
      const assignmentPeriodId = getAssignmentPeriodId(updates);
      if (assignmentPeriodId) {
        await getAssignmentEvaluationPeriod(client, assignmentPeriodId);
      }
      const assignmentEvaluation =
        updatedEmployee.evaluator_id == null
          ? null
          : await createDraftEvaluationForEmployeeAssignment(
              client,
              updatedEmployee,
              assignmentPeriodId
            );
      const assignmentHistory = await insertEvaluatorAssignmentHistory(client, {
        employeeId: req.params.id,
        previousEvaluatorId: existingEmployee.evaluator_id ?? null,
        newEvaluatorId: updates.evaluator_id ?? null,
        changedBy: getAssignmentActor(updates),
        reason: getAssignmentReason(updates),
        changeType: 'change',
        evaluationId: assignmentEvaluation?.id ?? null,
        evaluationPeriodId: assignmentEvaluation?.evaluation_period_id ?? assignmentPeriodId ?? null,
        changedAt: assignmentChangedAt,
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
    res.status(err.statusCode ?? 500).json({ error: err.statusCode ? err.message : 'Database error' });
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

    const actorName = await resolveEmployeeName(client, actorId, 'HR');
    const employeeName = updatedEmployee?.name ?? req.params.id;
    if (evaluatorId && evaluatorId !== previousEvaluatorId) {
      await insertNotificationRow(client, {
        notificationType: 'evaluator_changed',
        title: '담당 피평가자가 배정되었습니다',
        message: `${employeeName}님의 평가자가 회원님으로 변경되었습니다.`,
        priority: 'medium',
        senderId: actorId,
        senderName: actorName,
        recipientId: evaluatorId,
      });
      await insertNotificationRow(client, {
        notificationType: 'evaluator_changed',
        title: '평가자가 변경되었습니다',
        message: '담당 평가자가 새로 배정되었습니다.',
        priority: 'medium',
        senderId: actorId,
        senderName: actorName,
        recipientId: req.params.id,
      });
    }
    if (previousEvaluatorId && previousEvaluatorId !== (evaluatorId ?? null)) {
      await insertNotificationRow(client, {
        notificationType: 'evaluator_unassigned',
        title: '담당 피평가자가 해제되었습니다',
        message: `${employeeName}님이 담당에서 해제되었습니다.`,
        priority: 'low',
        senderId: actorId,
        senderName: actorName,
        recipientId: previousEvaluatorId,
      });
    }

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

// 단일 배정 이력 행을 취소(되돌림)한다. 정정행이면 superseded 된 원본을 다시 살린다.
// 호출자가 트랜잭션(BEGIN/COMMIT)을 관리한다. 가드 위반 시 statusCode 를 가진 에러를 throw.
const cancelEvaluatorAssignmentHistoryRow = async (client, { historyId, actorId, reason }) => {
    const { rows } = await client.query(
      `
        SELECT h.*, e.evaluator_id AS current_evaluator_id
        FROM evaluator_assignment_history h
        INNER JOIN employees e ON e.employee_id = h.employee_id
        WHERE h.id = $1
        FOR UPDATE OF h, e
      `,
      [historyId]
    );
    const history = rows[0];
    if (!history) {
      throw Object.assign(new Error('Assignment history not found'), { statusCode: 404 });
    }
    if (history.status === 'cancelled') {
      throw Object.assign(new Error('Assignment history is already cancelled'), { statusCode: 409 });
    }
    if (history.change_type === 'cancel') {
      throw Object.assign(new Error('Cancellation events cannot be cancelled'), { statusCode: 400 });
    }

    // 순차 취소 제약 제거 — 임의의 applied 행을 취소할 수 있다.
    // 단 employees.evaluator_id revert는 "현재 반영된 배정"일 때만 수행한다:
    // employees.evaluator_id 가 이 행의 new_evaluator_id 와 같고, 동시에 최신 applied·non-cancel 행.
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
    const isCurrentAssignment =
      (history.current_evaluator_id ?? null) === (history.new_evaluator_id ?? null) &&
      latestRows[0]?.id === history.id;

    const cancelledBy = actorId;
    const cancelReason = reason;

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

    // 정정으로 만들어진 보정 행을 취소할 때는 superseded 된 원본 행을 다시 살린다.
    // (원본이 'Superseded by correction' 사유로 cancelled 되어 있을 때만 복구)
    let restoredSupersededHistory = null;
    if (history.supersedes_history_id) {
      const { rows: restoredRows } = await client.query(
        `
          UPDATE evaluator_assignment_history
          SET
            status = 'applied',
            cancelled_at = NULL,
            cancelled_by = NULL,
            cancel_reason = NULL
          WHERE id = $1
            AND status = 'cancelled'
            AND cancel_reason = 'Superseded by correction'
          RETURNING *
        `,
        [history.supersedes_history_id]
      );
      restoredSupersededHistory = restoredRows[0] ?? null;
    }

    // evaluations.record_status 는 history 상태에 자동 동기화한다.
    // applied 이력이 하나라도 남아있으면 active, 전부 cancelled 면 cancelled.
    let reconciledEvaluation = null;
    if (history.evaluation_id) {
      const { rows: appliedRows } = await client.query(
        `
          SELECT 1
          FROM evaluator_assignment_history
          WHERE evaluation_id = $1
            AND status = 'applied'
            AND change_type <> 'cancel'
          LIMIT 1
        `,
        [history.evaluation_id]
      );
      const nextStatus = appliedRows.length > 0 ? 'active' : 'cancelled';
      const { rows: evaluationRows } = await client.query(
        `
          UPDATE evaluations
          SET record_status = $2, updated_at = NOW()
          WHERE id = $1
            AND COALESCE(record_status, 'active') <> $2
          RETURNING *
        `,
        [history.evaluation_id, nextStatus]
      );
      reconciledEvaluation = evaluationRows[0] ?? null;
    }

    let updatedEmployee = null;
    if (isCurrentAssignment) {
      // 이번에 cancelled 되는 행을 제외한 가장 최근 applied 이력의 평가자로 동기화.
      // history.previous_evaluator_id 만 신뢰하면 그 평가자도 이미 cancelled 됐을 때 mismatch 발생.
      const { rows: nextEvaluatorRows } = await client.query(
        `
          SELECT new_evaluator_id
          FROM evaluator_assignment_history
          WHERE employee_id = $1
            AND status = 'applied'
            AND change_type <> 'cancel'
            AND id <> $2
          ORDER BY changed_at DESC, id DESC
          LIMIT 1
        `,
        [history.employee_id, history.id]
      );
      const nextEvaluatorId = nextEvaluatorRows[0]?.new_evaluator_id ?? null;
      const { rows: employeeRows } = await client.query(
        `
          UPDATE employees
          SET evaluator_id = $2, updated_at = NOW()
          WHERE employee_id = $1
          RETURNING *
        `,
        [history.employee_id, nextEvaluatorId]
      );
      updatedEmployee = employeeRows[0] ?? null;
    }

    let cancelledEntryCount = 0;
    let reverseTransferResult = null;
    if (history.supersedes_history_id) {
      // 보정 취소: 정정 시점에 X→Y 로 옮겨진 entries 를 다시 X 쪽으로 되돌린다.
      if (history.new_evaluator_id && history.previous_evaluator_id) {
        reverseTransferResult = await transferEvaluatorEntriesForCorrection(client, {
          employeeId: history.employee_id,
          previousEvaluatorId: history.new_evaluator_id, // 현재 Y
          newEvaluatorId: history.previous_evaluator_id, // 복구 대상 X
          actorId: cancelledBy,
          reason: cancelReason || 'Correction cancel reverted entries',
        });
      }
    } else {
      // 일반 취소: 새 평가자에게 묶인 entries 를 cancelled 처리.
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

      cancelledEntryCount = cancelledEntryRows.length;
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
    }

    // 직원의 모든 applied 행 previous_evaluator_id 를 시간순 직전 행의 new_evaluator_id 로 보정.
    await reconcilePreviousEvaluatorIds(client, history.employee_id);

    return {
      cancelled: cancelledRows[0],
      employee: updatedEmployee,
      cancelled_entries: cancelledEntryCount,
      restored_history: restoredSupersededHistory,
      evaluation: reconciledEvaluation,
      reverse_transfer: reverseTransferResult
        ? {
            transferred: reverseTransferResult.transferredEntries.length,
            merged: reverseTransferResult.mergedEntries.length,
            feedback_count: reverseTransferResult.transferredFeedbackCount,
          }
        : null,
    };
};

app.post('/api/evaluator-assignment-history/:id/cancel', async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await cancelEvaluatorAssignmentHistoryRow(client, {
      historyId: req.params.id,
      actorId: getAssignmentActor(req.body),
      reason: getAssignmentCancellationReason(req.body),
    });
    await client.query('COMMIT');
    res.json(result);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error('Error cancelling evaluator assignment:', err);
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

// 임의의 applied 변경 이력을 "정정" — 원본을 cancelled 처리하고
// supersedes_history_id 로 원본을 가리키는 새 change 행을 삽입한다.
// 대상이 현재 반영된 배정(employees.evaluator_id 와 일치 + 최신 applied)일 때만
// employees.evaluator_id 와 하위 평가 데이터를 함께 정합화한다.
app.post('/api/evaluator-assignment-history/:id/correct', async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }

  const newEvaluatorId = normalizeOptionalText(
    req.body?.new_evaluator_id ?? req.body?.newEvaluatorId
  );
  const actorId = getAssignmentActor(req.body);
  const reason = getAssignmentReason(req.body) || 'HR assignment correction';
  const assignmentChangedAt = getAssignmentEffectiveDate(req.body);
  const assignmentPeriodId = getAssignmentPeriodId(req.body);

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
    if (history.status !== 'applied') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Only applied assignments can be corrected' });
    }
    if (history.change_type !== 'change') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cancellation events cannot be corrected' });
    }
    if (newEvaluatorId === history.employee_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Employee cannot evaluate themselves' });
    }
    const historyDateStr = history.changed_at
      ? new Date(history.changed_at).toISOString().slice(0, 10)
      : null;
    const sameEvaluator = (newEvaluatorId ?? null) === (history.new_evaluator_id ?? null);
    const sameDate = !assignmentChangedAt || assignmentChangedAt.slice(0, 10) === historyDateStr;
    const samePeriod =
      !assignmentPeriodId || assignmentPeriodId === (history.evaluation_period_id ?? null);
    if (sameEvaluator && sameDate && samePeriod) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No changes to apply' });
    }
    if (newEvaluatorId) {
      const { rows: evaluatorRows } = await client.query(
        'SELECT employee_id FROM employees WHERE employee_id = $1 LIMIT 1',
        [newEvaluatorId]
      );
      if (!evaluatorRows[0]) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Evaluator not found' });
      }
    }
    const selectedPeriod = assignmentPeriodId
      ? await getAssignmentEvaluationPeriod(client, assignmentPeriodId)
      : null;

    // 대상 행이 "현재 반영된 배정"인지 판정:
    // employees.evaluator_id 가 이 행의 new_evaluator_id 와 같고, 동시에 최신 applied·non-cancel 행.
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
    const isCurrentAssignment =
      (history.current_evaluator_id ?? null) === (history.new_evaluator_id ?? null) &&
      latestRows[0]?.id === history.id;

    // 1) superseding 정정 행 삽입
    const correctionRow = await insertEvaluatorAssignmentHistory(client, {
      employeeId: history.employee_id,
      previousEvaluatorId: history.new_evaluator_id ?? null,
      newEvaluatorId: newEvaluatorId ?? null,
      changedBy: actorId,
      reason,
      changeType: 'change',
      status: 'applied',
      supersedesHistoryId: history.id,
      evaluationId: history.evaluation_id ?? null,
      evaluationPeriodId: selectedPeriod?.id ?? history.evaluation_period_id ?? null,
      changedAt: assignmentChangedAt,
    });

    if (history.evaluation_id && selectedPeriod) {
      await client.query(
        `
          UPDATE evaluations
          SET evaluation_period_id = $2, evaluation_year = $3, updated_at = NOW()
          WHERE id = $1
        `,
        [history.evaluation_id, selectedPeriod.id, selectedPeriod.evaluation_year]
      );
    }

    // 2) 원본 행을 cancelled 처리
    await client.query(
      `
        UPDATE evaluator_assignment_history
        SET
          status = 'cancelled',
          cancelled_at = NOW(),
          cancelled_by = $2,
          cancel_reason = 'Superseded by correction'
        WHERE id = $1
      `,
      [history.id, actorId]
    );

    // 2.5) evaluation.record_status 를 history 상태에 자동 동기화.
    //      applied 이력이 하나라도 남아있으면 active, 전부 cancelled 면 cancelled.
    //      (정정으로 새 superseding 행이 applied 로 추가되었으므로 일반적으로 active 로 복구된다.)
    if (history.evaluation_id) {
      const { rows: appliedRows } = await client.query(
        `
          SELECT 1
          FROM evaluator_assignment_history
          WHERE evaluation_id = $1
            AND status = 'applied'
            AND change_type <> 'cancel'
          LIMIT 1
        `,
        [history.evaluation_id]
      );
      const nextStatus = appliedRows.length > 0 ? 'active' : 'cancelled';
      await client.query(
        `
          UPDATE evaluations
          SET record_status = $2, updated_at = NOW()
          WHERE id = $1
            AND COALESCE(record_status, 'active') <> $2
        `,
        [history.evaluation_id, nextStatus]
      );
    }

    // 3) employees.evaluator_id 마스터 갱신은 현재 반영된 배정일 때만.
    let updatedEmployee = null;
    if (isCurrentAssignment) {
      const { rows: employeeRows } = await client.query(
        `
          UPDATE employees
          SET evaluator_id = $2, updated_at = NOW()
          WHERE employee_id = $1
          RETURNING *
        `,
        [history.employee_id, newEvaluatorId ?? null]
      );
      updatedEmployee = employeeRows[0] ?? null;
    }

    // 3.1) 점수/피드백 ownership 이전: 정정의 의미 그대로 ownership 도 새 평가자로.
    //      (cancelled 원본 행의 evaluator 가 그 evaluation 에 매긴 entries 를 superseding new_evaluator
    //       로 이전. 점수 값 자체는 보존됨.)
    //      이건 정정 흐름(과거/현재 무관)에서 항상 호출되어야 정정 후에도 그 평가자가 과거 평가자
    //      그룹에 잘못 노출되지 않는다. 단 evaluation 범위로 제한된 안전한 이전.
    const correctionResult = await transferEvaluatorEntriesForCorrectionScoped(client, {
      evaluationId: history.evaluation_id ?? null,
      previousEvaluatorId: history.new_evaluator_id ?? null,
      newEvaluatorId: newEvaluatorId ?? null,
      actorId,
      reason,
    });

    // 3.5) 같은 직원의 모든 applied 행 previous_evaluator_id 를 시간순 직전 행의 new_evaluator_id 로 보정.
    //      정정으로 직전 평가자가 바뀌면 그 다음 추가된 평가자 변경 행들의 prev 도 자동 따라가도록.
    await reconcilePreviousEvaluatorIds(client, history.employee_id);

    // 4) 감사 로그
    await insertAdminAuditLog(client, {
      actionType: 'evaluator_correct',
      actorId,
      targetEmployeeId: history.employee_id,
      previousValue: { history_id: history.id, evaluator_id: history.new_evaluator_id ?? null },
      newValue: { history_id: correctionRow.id, evaluator_id: newEvaluatorId ?? null },
      reason,
    });

    // 5) 알림 — 현재 반영된 배정일 때만 (과거 행 정정은 실제 담당에 영향 없음)
    if (isCurrentAssignment) {
      const actorName = await resolveEmployeeName(client, actorId, 'HR');
      const { rows: employeeNameRows } = await client.query(
        'SELECT name FROM employees WHERE employee_id = $1 LIMIT 1',
        [history.employee_id]
      );
      const employeeName = employeeNameRows[0]?.name ?? history.employee_id;
      const prevEvaluatorId = history.new_evaluator_id ?? null;
      if (newEvaluatorId && newEvaluatorId !== prevEvaluatorId) {
        await insertNotificationRow(client, {
          notificationType: 'evaluator_changed',
          title: '담당 피평가자가 배정되었습니다',
          message: `${employeeName}님의 평가자가 회원님으로 변경되었습니다.`,
          priority: 'medium',
          senderId: actorId,
          senderName: actorName,
          recipientId: newEvaluatorId,
        });
        await insertNotificationRow(client, {
          notificationType: 'evaluator_changed',
          title: '평가자가 변경되었습니다',
          message: '담당 평가자가 새로 배정되었습니다.',
          priority: 'medium',
          senderId: actorId,
          senderName: actorName,
          recipientId: history.employee_id,
        });
      }
      if (prevEvaluatorId && prevEvaluatorId !== (newEvaluatorId ?? null)) {
        await insertNotificationRow(client, {
          notificationType: 'evaluator_unassigned',
          title: '담당 피평가자가 해제되었습니다',
          message: `${employeeName}님이 담당에서 해제되었습니다.`,
          priority: 'low',
          senderId: actorId,
          senderName: actorName,
          recipientId: prevEvaluatorId,
        });
      }
    }

    await client.query('COMMIT');
    res.json({
      correction: correctionRow,
      employee: updatedEmployee,
      is_current_assignment: isCurrentAssignment,
      transferred_entries: correctionResult.transferredEntries.length,
      merged_entries: correctionResult.mergedEntries.length,
      transferred_feedbacks: correctionResult.transferredFeedbackCount,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error correcting evaluator assignment:', err);
    res.status(err.statusCode ?? 500).json({ error: err.statusCode ? err.message : 'Database error' });
  } finally {
    client.release();
  }
});

// ============================================================
// Admin: bulk reset endpoints (대상자 / 매칭정보 일괄삭제)
// ============================================================
// 안전장치: 호출자가 actor_id 로 hr 권한 직원이거나 admin 이어야 한다.
const assertHrActor = async (client, actorId) => {
  if (!actorId) return false;
  if (actorId === 'admin') return true;
  const { rows } = await client.query(
    `SELECT 1 FROM employees WHERE employee_id = $1 AND 'hr' = ANY(available_roles) LIMIT 1`,
    [actorId]
  );
  return rows.length > 0;
};

// 대상자 일괄삭제: admin 외 모든 employees + 그들에 딸린 모든 평가·과업·이력·임포트 데이터 제거.
// 평가기간(evaluation_periods)·시스템 설정(settings, prompt_templates)은 유지.
app.post('/api/admin/reset/employees', async (req, res) => {
  if (!isDbAvailable) return sendDbUnavailable(res);
  const actorId = getAssignmentActor(req.body);
  const client = await pool.connect();
  try {
    if (!(await assertHrActor(client, actorId))) {
      client.release();
      return res.status(403).json({ error: 'HR 권한이 필요합니다.' });
    }
    await client.query('BEGIN');
    // employees 가 import_batches 를 FK 참조하므로, batches 를 TRUNCATE CASCADE 하면
    // employees(admin 포함)까지 cascade 삭제된다. 이를 막기 위해 먼저 참조를 끊는다.
    await client.query(
      `UPDATE employees SET last_matching_batch_id = NULL, last_profile_batch_id = NULL`
    );
    // batches 를 제외한 종속 테이블만 TRUNCATE CASCADE (employees 로 전파되지 않음).
    await client.query(`
      TRUNCATE TABLE
        feedback_history,
        task_evaluation_entries,
        tasks,
        evaluator_assignment_history,
        notifications,
        final_assessment,
        admin_audit_logs,
        employee_profile_import_rows,
        matching_import_rows,
        evaluations
      RESTART IDENTITY CASCADE
    `);
    // batches 는 참조를 끊었으므로 DELETE 로 안전하게 비운다.
    await client.query('DELETE FROM employee_profile_import_batches');
    await client.query('DELETE FROM matching_import_batches');
    // employees 에서 admin 외 모두 제거. self-FK 는 ON DELETE SET NULL 이라 안전.
    const { rowCount } = await client.query(
      `DELETE FROM employees WHERE employee_id <> 'admin'`
    );
    // admin 행 정합화 (다른 직원이 자기 평가자로 admin 을 가리키고 있던 흔적 정리)
    await client.query(
      `UPDATE employees SET evaluator_id = NULL, last_matching_batch_id = NULL,
              last_profile_batch_id = NULL, updated_at = NOW()
        WHERE employee_id = 'admin'`
    );
    await client.query('COMMIT');
    res.json({
      ok: true,
      deleted_employees: rowCount,
      message: 'admin 외 모든 대상자와 관련 데이터를 삭제했습니다.',
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error in reset/employees:', err);
    res.status(500).json({ error: err.message ?? 'Database error' });
  } finally {
    client.release();
  }
});

// 매칭정보 일괄삭제: employees 는 유지하되, 매칭 임포트로 들어온 정보(평가자 배정·
// 평가건·과업·평가 entries·피드백·이력·매칭 임포트 배치·관련 알림)를 모두 비운다.
// 평가대상자 프로필 정보(name, position, department, growth_level, available_roles 등)는 보존.
app.post('/api/admin/reset/matching', async (req, res) => {
  if (!isDbAvailable) return sendDbUnavailable(res);
  const actorId = getAssignmentActor(req.body);
  const client = await pool.connect();
  try {
    if (!(await assertHrActor(client, actorId))) {
      client.release();
      return res.status(403).json({ error: 'HR 권한이 필요합니다.' });
    }
    await client.query('BEGIN');
    // employees 가 matching_import_batches 를 FK 참조하므로, 먼저 참조를 끊어
    // batches TRUNCATE CASCADE 가 employees 로 전파되지 않도록 한다.
    await client.query(`UPDATE employees SET last_matching_batch_id = NULL`);
    // 평가/과업/엔트리/피드백/이력/임포트(batches 제외) — 매칭으로부터 파생된 것들 모두 비움
    await client.query(`
      TRUNCATE TABLE
        feedback_history,
        task_evaluation_entries,
        tasks,
        evaluator_assignment_history,
        notifications,
        final_assessment,
        matching_import_rows,
        evaluations
      RESTART IDENTITY CASCADE
    `);
    // batches 는 참조를 끊었으므로 DELETE 로 안전하게 비운다.
    await client.query('DELETE FROM matching_import_batches');
    // employees 의 매칭 임포트로 갱신되는 컬럼만 NULL 로 리셋. 프로필 정보는 보존.
    const { rowCount } = await client.query(
      `UPDATE employees
          SET evaluator_id = NULL,
              org_sequence = NULL,
              work_start_date = NULL,
              work_end_date = NULL,
              evaluation_type = NULL,
              matching_result = NULL,
              confirmer_id = NULL,
              confirmer_name = NULL,
              last_matching_batch_id = NULL,
              updated_at = NOW()
        WHERE employee_id <> 'admin'`
    );
    await client.query('COMMIT');
    res.json({
      ok: true,
      cleared_employees: rowCount,
      message: '매칭 정보(평가자 배정·평가건·이력)를 삭제했습니다. 대상자 프로필은 보존됩니다.',
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error in reset/matching:', err);
    res.status(500).json({ error: err.message ?? 'Database error' });
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
    const requestedEvaluatorId =
      typeof req.query.evaluatorId === 'string' && req.query.evaluatorId.trim()
        ? req.query.evaluatorId.trim()
        : null;
    const evaluatorIndex = 2 + filter.values.length;
    const evaluatorClause = requestedEvaluatorId
      ? `AND latest_ah.new_evaluator_id = $${evaluatorIndex}`
      : '';
    const params = requestedEvaluatorId
      ? [req.params.employeeId, ...filter.values, requestedEvaluatorId]
      : [req.params.employeeId, ...filter.values];
    const orderClause = requestedEvaluatorId
      ? 'ORDER BY ev.created_at DESC'
      : `ORDER BY
          CASE
            WHEN latest_ah.new_evaluator_id IS NOT DISTINCT FROM emp.evaluator_id THEN 0
            ELSE 1
          END,
          ev.created_at DESC`;
    const { rows } = await pool.query(
      `
        SELECT
          ev.*,
          latest_ah.new_evaluator_id AS evaluator_id,
          latest_ah.changed_at AS evaluator_assigned_at,
          ev_emp.name AS evaluator_name,
          ev_emp.position AS evaluator_position,
          ev_emp.department AS evaluator_department
        FROM evaluations ev
        LEFT JOIN employees emp ON emp.employee_id = ev.evaluatee_id
        LEFT JOIN LATERAL (
          SELECT h.*
          FROM evaluator_assignment_history h
          WHERE h.evaluation_id = ev.id
            AND h.employee_id = ev.evaluatee_id
            AND h.status = 'applied'
            AND h.change_type <> 'cancel'
          ORDER BY h.changed_at DESC, h.id DESC
          LIMIT 1
        ) latest_ah ON TRUE
        LEFT JOIN employees ev_emp ON ev_emp.employee_id = latest_ah.new_evaluator_id
        WHERE ev.evaluatee_id = $1
          AND ${filter.clause.replaceAll('evaluation_period_id', 'ev.evaluation_period_id').replaceAll('evaluation_year', 'ev.evaluation_year')}
          AND (
            COALESCE(ev.record_status, 'active') = 'active'
            OR EXISTS (
              SELECT 1
              FROM evaluator_assignment_history live
              WHERE live.evaluation_id = ev.id
                AND live.status = 'applied'
                AND live.change_type <> 'cancel'
            )
          )          ${evaluatorClause}
        ${orderClause}
        LIMIT 1
      `,
      params
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

/* ==================== Evaluator Change Request Routes ==================== */
// 평가자/피평가자가 기존 평가 구간(배정 이력)을 선택해 평가자 변경을 요청하고 HR 이 승인/반려한다.
// 승인 시 아래 applyAssignmentCorrection 으로 그 구간을 정정(correct)한다.
// (검증된 /correct 엔드포인트 로직을 미러링한 함수 — 트랜잭션/응답은 호출자 책임, 검증 실패는 throw.)
const applyAssignmentCorrection = async (
  client,
  { historyId, newEvaluatorId, actorId, reason, changedAt = null, periodId = null }
) => {
  const { rows } = await client.query(
    `
      SELECT h.*, e.evaluator_id AS current_evaluator_id
      FROM evaluator_assignment_history h
      INNER JOIN employees e ON e.employee_id = h.employee_id
      WHERE h.id = $1
      FOR UPDATE OF h, e
    `,
    [historyId]
  );
  const history = rows[0];
  if (!history) throw Object.assign(new Error('Assignment history not found'), { statusCode: 404 });
  if (history.status !== 'applied') throw Object.assign(new Error('적용 중인 배정만 정정할 수 있습니다.'), { statusCode: 409 });
  if (history.change_type !== 'change') throw Object.assign(new Error('취소 이벤트는 정정할 수 없습니다.'), { statusCode: 400 });
  if (newEvaluatorId === history.employee_id) throw Object.assign(new Error('Employee cannot evaluate themselves'), { statusCode: 400 });

  const historyDateStr = history.changed_at ? new Date(history.changed_at).toISOString().slice(0, 10) : null;
  const sameEvaluator = (newEvaluatorId ?? null) === (history.new_evaluator_id ?? null);
  const sameDate = !changedAt || changedAt.slice(0, 10) === historyDateStr;
  const samePeriod = !periodId || periodId === (history.evaluation_period_id ?? null);
  if (sameEvaluator && sameDate && samePeriod) {
    throw Object.assign(new Error('변경 내용이 없습니다.'), { statusCode: 400 });
  }
  if (newEvaluatorId) {
    const { rows: evaluatorRows } = await client.query(
      'SELECT employee_id FROM employees WHERE employee_id = $1 LIMIT 1',
      [newEvaluatorId]
    );
    if (!evaluatorRows[0]) throw Object.assign(new Error('Evaluator not found'), { statusCode: 400 });
  }
  const selectedPeriod = periodId ? await getAssignmentEvaluationPeriod(client, periodId) : null;

  const { rows: latestRows } = await client.query(
    `
      SELECT id FROM evaluator_assignment_history
      WHERE employee_id = $1 AND status = 'applied' AND change_type <> 'cancel'
      ORDER BY changed_at DESC, id DESC LIMIT 1
    `,
    [history.employee_id]
  );
  const isCurrentAssignment =
    (history.current_evaluator_id ?? null) === (history.new_evaluator_id ?? null) &&
    latestRows[0]?.id === history.id;

  const correctionRow = await insertEvaluatorAssignmentHistory(client, {
    employeeId: history.employee_id,
    previousEvaluatorId: history.new_evaluator_id ?? null,
    newEvaluatorId: newEvaluatorId ?? null,
    changedBy: actorId,
    reason,
    changeType: 'change',
    status: 'applied',
    supersedesHistoryId: history.id,
    evaluationId: history.evaluation_id ?? null,
    evaluationPeriodId: selectedPeriod?.id ?? history.evaluation_period_id ?? null,
    // 정정은 같은 근무 구간의 평가자만 바꾸는 것이므로, 날짜를 새로 지정하지 않으면
    // 원본 구간 시작일(changed_at)을 보존한다. (NOW() 로 떨어지면 근무기간이 승인일~현재로 어긋남)
    changedAt: changedAt ?? history.changed_at,
  });

  if (history.evaluation_id && selectedPeriod) {
    await client.query(
      `UPDATE evaluations SET evaluation_period_id = $2, evaluation_year = $3, updated_at = NOW() WHERE id = $1`,
      [history.evaluation_id, selectedPeriod.id, selectedPeriod.evaluation_year]
    );
  }

  await client.query(
    `
      UPDATE evaluator_assignment_history
      SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $2, cancel_reason = 'Superseded by correction'
      WHERE id = $1
    `,
    [history.id, actorId]
  );

  if (history.evaluation_id) {
    const { rows: appliedRows } = await client.query(
      `SELECT 1 FROM evaluator_assignment_history WHERE evaluation_id = $1 AND status = 'applied' AND change_type <> 'cancel' LIMIT 1`,
      [history.evaluation_id]
    );
    const nextStatus = appliedRows.length > 0 ? 'active' : 'cancelled';
    await client.query(
      `UPDATE evaluations SET record_status = $2, updated_at = NOW() WHERE id = $1 AND COALESCE(record_status, 'active') <> $2`,
      [history.evaluation_id, nextStatus]
    );
  }

  let updatedEmployee = null;
  if (isCurrentAssignment) {
    const { rows: employeeRows } = await client.query(
      `UPDATE employees SET evaluator_id = $2, updated_at = NOW() WHERE employee_id = $1 RETURNING *`,
      [history.employee_id, newEvaluatorId ?? null]
    );
    updatedEmployee = employeeRows[0] ?? null;
  }

  const correctionResult = await transferEvaluatorEntriesForCorrectionScoped(client, {
    evaluationId: history.evaluation_id ?? null,
    previousEvaluatorId: history.new_evaluator_id ?? null,
    newEvaluatorId: newEvaluatorId ?? null,
    actorId,
    reason,
  });

  await reconcilePreviousEvaluatorIds(client, history.employee_id);

  await insertAdminAuditLog(client, {
    actionType: 'evaluator_correct',
    actorId,
    targetEmployeeId: history.employee_id,
    previousValue: { history_id: history.id, evaluator_id: history.new_evaluator_id ?? null },
    newValue: { history_id: correctionRow.id, evaluator_id: newEvaluatorId ?? null },
    reason,
  });

  if (isCurrentAssignment) {
    const actorName = await resolveEmployeeName(client, actorId, 'HR');
    const { rows: employeeNameRows } = await client.query(
      'SELECT name FROM employees WHERE employee_id = $1 LIMIT 1',
      [history.employee_id]
    );
    const employeeName = employeeNameRows[0]?.name ?? history.employee_id;
    const prevEvaluatorId = history.new_evaluator_id ?? null;
    if (newEvaluatorId && newEvaluatorId !== prevEvaluatorId) {
      await insertNotificationRow(client, {
        notificationType: 'evaluator_changed',
        title: '담당 피평가자가 배정되었습니다',
        message: `${employeeName}님의 평가자가 회원님으로 변경되었습니다.`,
        priority: 'medium',
        senderId: actorId,
        senderName: actorName,
        recipientId: newEvaluatorId,
      });
      await insertNotificationRow(client, {
        notificationType: 'evaluator_changed',
        title: '평가자가 변경되었습니다',
        message: '담당 평가자가 새로 배정되었습니다.',
        priority: 'medium',
        senderId: actorId,
        senderName: actorName,
        recipientId: history.employee_id,
      });
    }
    if (prevEvaluatorId && prevEvaluatorId !== (newEvaluatorId ?? null)) {
      await insertNotificationRow(client, {
        notificationType: 'evaluator_unassigned',
        title: '담당 피평가자가 해제되었습니다',
        message: `${employeeName}님이 담당에서 해제되었습니다.`,
        priority: 'low',
        senderId: actorId,
        senderName: actorName,
        recipientId: prevEvaluatorId,
      });
    }
  }

  return {
    correction: correctionRow,
    employee: updatedEmployee,
    is_current_assignment: isCurrentAssignment,
    transferred_entries: correctionResult.transferredEntries.length,
    merged_entries: correctionResult.mergedEntries.length,
    transferred_feedbacks: correctionResult.transferredFeedbackCount,
  };
};

// 평가자/피평가자가 기존 평가 구간(배정 이력)을 선택해 평가자 변경을 요청하고 HR 이 승인/반려한다.

app.get('/api/change-requests', async (req, res) => {
  if (!isDbAvailable) {
    return res.json([]);
  }
  try {
    const conditions = [];
    const values = [];
    if (req.query.status) {
      values.push(String(req.query.status));
      conditions.push(`r.status = $${values.length}`);
    }
    if (req.query.requestedBy) {
      values.push(String(req.query.requestedBy));
      conditions.push(`r.requested_by = $${values.length}`);
    }
    if (req.query.periodId) {
      values.push(String(req.query.periodId));
      conditions.push(`r.evaluation_period_id = $${values.length}::uuid`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `
        SELECT
          r.*,
          to_char(r.segment_start_date, 'YYYY-MM-DD') AS segment_start_date,
          to_char(r.segment_end_date, 'YYYY-MM-DD') AS segment_end_date,
          rb.name AS requested_by_name,
          ee.department AS evaluatee_department,
          p.name AS evaluation_period_name,
          p.evaluation_year
        FROM evaluator_change_requests r
        LEFT JOIN employees rb ON rb.employee_id = r.requested_by
        LEFT JOIN employees ee ON ee.employee_id = r.evaluatee_id
        LEFT JOIN evaluation_periods p ON p.id = r.evaluation_period_id
        ${where}
        ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END, r.created_at DESC
      `,
      values
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching change requests:', err);
    res.json([]);
  }
});

app.post('/api/change-requests', async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }
  const body = req.body ?? {};
  const evaluateeId = normalizeOptionalText(body.evaluatee_id ?? body.evaluateeId);
  const requestedEvaluatorId = normalizeOptionalText(body.requested_evaluator_id ?? body.requestedEvaluatorId);
  const targetHistoryId = normalizeOptionalText(body.target_history_id ?? body.targetHistoryId);
  const segmentStartDate = normalizeOptionalText(body.segment_start_date ?? body.segmentStartDate);
  const segmentEndDate = normalizeOptionalText(body.segment_end_date ?? body.segmentEndDate);
  const requestedBy = normalizeOptionalText(body.requested_by ?? body.requestedBy);
  const requesterRole = normalizeOptionalText(body.requester_role ?? body.requesterRole);
  const reason = normalizeOptionalText(body.reason);

  if (!evaluateeId || !requestedBy || !requesterRole) {
    return res.status(400).json({ error: 'evaluatee_id, requested_by, requester_role are required' });
  }
  if (!targetHistoryId) {
    return res.status(400).json({ error: 'target_history_id is required' });
  }
  if (requestedEvaluatorId && requestedEvaluatorId === evaluateeId) {
    return res.status(400).json({ error: 'Employee cannot evaluate themselves' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: eeRows } = await client.query(
      'SELECT * FROM employees WHERE employee_id = $1',
      [evaluateeId]
    );
    const evaluatee = eeRows[0];
    if (!evaluatee) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Evaluatee not found' });
    }

    // 대상 구간(배정 이력) 확인 — 평가기간/현재 평가자는 이 행에서 가져온다.
    const { rows: histRows } = await client.query(
      'SELECT * FROM evaluator_assignment_history WHERE id = $1',
      [targetHistoryId]
    );
    const history = histRows[0];
    if (!history) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '선택한 평가 구간을 찾을 수 없습니다.' });
    }
    if (history.employee_id !== evaluateeId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: '대상 피평가자와 평가 구간이 일치하지 않습니다.' });
    }
    if (history.status !== 'applied' || history.change_type !== 'change') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: '정정 가능한 구간(적용 중 변경)만 선택할 수 있습니다.' });
    }

    const nameOf = async (id) => {
      if (!id) return null;
      const { rows } = await client.query('SELECT name FROM employees WHERE employee_id = $1', [id]);
      return rows[0]?.name ?? null;
    };
    const periodId = history.evaluation_period_id ?? null;
    const currentEvaluatorId = history.new_evaluator_id ?? null;
    const currentEvaluatorName = await nameOf(currentEvaluatorId);
    const requestedEvaluatorName = await nameOf(requestedEvaluatorId);

    if (requestedEvaluatorId && requestedEvaluatorId === currentEvaluatorId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: '현재 평가자와 동일합니다.' });
    }

    const { rows: dupRows } = await client.query(
      `SELECT id FROM evaluator_change_requests
        WHERE target_history_id = $1::uuid AND status = 'pending'
        LIMIT 1`,
      [targetHistoryId]
    );
    if (dupRows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: '해당 구간에 이미 대기 중인 변경요청이 있습니다.' });
    }

    const { rows: insertedRows } = await client.query(
      `
        INSERT INTO evaluator_change_requests (
          evaluatee_id, evaluatee_name, current_evaluator_id, current_evaluator_name,
          requested_evaluator_id, requested_evaluator_name, evaluation_period_id,
          target_history_id, segment_start_date, segment_end_date,
          requested_by, requester_role, reason, status
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::uuid,$9::date,$10::date,$11,$12,$13,'pending')
        RETURNING *
      `,
      [
        evaluateeId, evaluatee.name, currentEvaluatorId, currentEvaluatorName,
        requestedEvaluatorId, requestedEvaluatorName, periodId,
        targetHistoryId, segmentStartDate, segmentEndDate,
        requestedBy, requesterRole, reason,
      ]
    );
    const created = insertedRows[0];

    const requesterName = await resolveEmployeeName(client, requestedBy, '요청자');
    const { rows: hrRows } = await client.query(
      `SELECT employee_id FROM employees WHERE available_roles::text ILIKE '%hr%'`
    );
    for (const hr of hrRows) {
      await insertNotificationRow(client, {
        notificationType: 'change_request',
        title: '평가자 변경요청이 접수되었습니다',
        message: `${evaluatee.name}님의 평가자 변경요청(${currentEvaluatorName ?? '평가자 없음'} → ${requestedEvaluatorName ?? '미지정'})이 ${requesterName}님으로부터 접수되었습니다.`,
        priority: 'medium',
        senderId: requestedBy,
        senderName: requesterName,
        recipientId: hr.employee_id,
      });
    }

    await client.query('COMMIT');
    res.json(created);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error creating change request:', err);
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

app.post('/api/change-requests/:id/approve', async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }
  const reviewerId = normalizeOptionalText(req.body?.reviewed_by ?? req.body?.reviewedBy) || 'HR';
  const reviewComment = normalizeOptionalText(req.body?.review_comment ?? req.body?.reviewComment);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: reqRows } = await client.query(
      'SELECT * FROM evaluator_change_requests WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );
    const request = reqRows[0];
    if (!request) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Request not found' });
    }
    if (request.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: '이미 처리된 요청입니다.' });
    }

    if (!request.target_history_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: '대상 평가 구간 정보가 없는 요청입니다.' });
    }

    const { rows: eeRows } = await client.query(
      'SELECT name FROM employees WHERE employee_id = $1',
      [request.evaluatee_id]
    );
    const evaluateeName = eeRows[0]?.name ?? request.evaluatee_name ?? request.evaluatee_id;

    // 선택한 구간을 정정(correct) — 시작/종료일·평가기간은 구간 그대로 유지(요청자가 바꾸지 않음).
    const correction = await applyAssignmentCorrection(client, {
      historyId: request.target_history_id,
      newEvaluatorId: request.requested_evaluator_id ?? null,
      actorId: reviewerId,
      reason: `변경요청 승인 (요청자 ${request.requested_by})`,
      changedAt: null,
      periodId: null,
    });

    const { rows: doneRows } = await client.query(
      `
        UPDATE evaluator_change_requests
        SET status = 'approved', reviewed_by = $2, reviewed_at = NOW(),
            review_comment = $3, applied_history_id = $4, updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [req.params.id, reviewerId, reviewComment, correction.correction?.id ?? null]
    );

    const reviewerName = await resolveEmployeeName(client, reviewerId, 'HR');
    await insertNotificationRow(client, {
      notificationType: 'change_request_result',
      title: '평가자 변경요청이 승인되었습니다',
      message: `${evaluateeName}님의 평가자 변경요청이 승인되어 평가자가 변경되었습니다.`,
      priority: 'medium',
      senderId: reviewerId,
      senderName: reviewerName,
      recipientId: request.requested_by,
    });

    await client.query('COMMIT');
    res.json(doneRows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error approving change request:', err);
    res.status(err.statusCode ?? 500).json({ error: err.statusCode ? err.message : 'Database error' });
  } finally {
    client.release();
  }
});

app.post('/api/change-requests/:id/reject', async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }
  const reviewerId = normalizeOptionalText(req.body?.reviewed_by ?? req.body?.reviewedBy) || 'HR';
  const reviewComment = normalizeOptionalText(req.body?.review_comment ?? req.body?.reviewComment);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: reqRows } = await client.query(
      'SELECT * FROM evaluator_change_requests WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );
    const request = reqRows[0];
    if (!request) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Request not found' });
    }
    if (request.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: '이미 처리된 요청입니다.' });
    }

    const { rows: doneRows } = await client.query(
      `
        UPDATE evaluator_change_requests
        SET status = 'rejected', reviewed_by = $2, reviewed_at = NOW(),
            review_comment = $3, updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [req.params.id, reviewerId, reviewComment]
    );

    const reviewerName = await resolveEmployeeName(client, reviewerId, 'HR');
    await insertNotificationRow(client, {
      notificationType: 'change_request_result',
      title: '평가자 변경요청이 반려되었습니다',
      message: `${request.evaluatee_name ?? request.evaluatee_id}님의 평가자 변경요청이 반려되었습니다.${reviewComment ? ` 사유: ${reviewComment}` : ''}`,
      priority: 'medium',
      senderId: reviewerId,
      senderName: reviewerName,
      recipientId: request.requested_by,
    });

    await client.query('COMMIT');
    res.json(doneRows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error rejecting change request:', err);
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

app.post('/api/change-requests/:id/cancel', async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }
  const actorId = normalizeOptionalText(req.body?.actor_id ?? req.body?.actorId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: reqRows } = await client.query(
      'SELECT * FROM evaluator_change_requests WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );
    const request = reqRows[0];
    if (!request) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Request not found' });
    }
    if (request.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: '대기 중인 요청만 취소할 수 있습니다.' });
    }
    // 요청자 본인만 취소 가능 (actorId 가 전달되면 검증)
    if (actorId && actorId !== request.requested_by) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: '본인이 생성한 요청만 취소할 수 있습니다.' });
    }
    const { rows: doneRows } = await client.query(
      `
        UPDATE evaluator_change_requests
        SET status = 'cancelled', updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [req.params.id]
    );
    await client.query('COMMIT');
    res.json(doneRows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error cancelling change request:', err);
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

// 승인된 변경요청을 되돌린다(HR). 승인 시 적용된 평가자 변경을 원래 평가자로 재정정하고
// 요청 상태를 'cancelled' 로 바꾼다.
app.post('/api/change-requests/:id/revert', async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }
  const reviewerId = normalizeOptionalText(req.body?.reviewed_by ?? req.body?.reviewedBy) || 'HR';
  const reviewComment = normalizeOptionalText(req.body?.review_comment ?? req.body?.reviewComment);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: reqRows } = await client.query(
      'SELECT * FROM evaluator_change_requests WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );
    const request = reqRows[0];
    if (!request) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Request not found' });
    }
    if (request.status !== 'approved') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: '승인된 요청만 되돌릴 수 있습니다.' });
    }
    if (!request.applied_history_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: '되돌릴 적용 이력이 없습니다.' });
    }

    // 승인 시 생성된 정정 이력을 취소 → 정정행이 사라지고 superseded 됐던 원본(이전 평가자)이
    // 다시 살아난다. 모달의 "취소"와 동일한 동작이라 이력이 새로 쌓이지 않는다.
    await cancelEvaluatorAssignmentHistoryRow(client, {
      historyId: request.applied_history_id,
      actorId: reviewerId,
      reason: `변경요청 승인 되돌림 (요청 ${request.id})`,
    });

    const { rows: doneRows } = await client.query(
      `
        UPDATE evaluator_change_requests
        SET status = 'cancelled', reviewed_by = $2, reviewed_at = NOW(),
            review_comment = $3, applied_history_id = NULL, updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [req.params.id, reviewerId, reviewComment ?? '승인 되돌림']
    );

    const reviewerName = await resolveEmployeeName(client, reviewerId, 'HR');
    await insertNotificationRow(client, {
      notificationType: 'change_request_result',
      title: '평가자 변경요청 승인이 취소되었습니다',
      message: `${request.evaluatee_name ?? request.evaluatee_id}님의 평가자 변경이 되돌려져 이전 평가자(${request.current_evaluator_name ?? '없음'})로 복구되었습니다.`,
      priority: 'medium',
      senderId: reviewerId,
      senderName: reviewerName,
      recipientId: request.requested_by,
    });

    await client.query('COMMIT');
    res.json(doneRows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error reverting change request:', err);
    res.status(err.statusCode ?? 500).json({ error: err.statusCode ? err.message : 'Database error' });
  } finally {
    client.release();
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

app.delete('/api/evaluation-periods/:id', async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM evaluation_periods WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );
    const period = rows[0];
    if (!period) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Evaluation period not found' });
    }
    if (period.status === 'locked') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: '잠금된 평가기간은 삭제할 수 없습니다. 먼저 잠금을 해제하세요.' });
    }
    if (period.is_default) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: '기본 평가기간은 삭제할 수 없습니다.' });
    }

    // 실제 과업/점수 데이터가 입력된 evaluation 이 하나라도 있으면 삭제 차단.
    // (직원 등록 트리거가 자동 생성한 '빈 draft evaluation' 은 데이터로 보지 않는다.)
    const { rows: dataRows } = await client.query(
      `
        SELECT 1
        FROM evaluations ev
        WHERE ev.evaluation_period_id = $1
          AND (
            EXISTS (SELECT 1 FROM tasks t WHERE t.evaluation_id = ev.id AND t.deleted_at IS NULL)
            OR EXISTS (SELECT 1 FROM task_evaluation_entries tee WHERE tee.evaluation_id = ev.id)
          )
        LIMIT 1
      `,
      [req.params.id]
    );
    if (dataRows[0]) {
      await client.query('ROLLBACK');
      return res
        .status(409)
        .json({ error: '과업·점수가 입력된 평가가 있어 삭제할 수 없습니다.' });
    }

    // 빈 evaluation 들과 그에 묶인 부수 데이터를 정리한 뒤 평가기간 삭제.
    await client.query(
      `DELETE FROM feedback_history WHERE evaluation_id IN (SELECT id FROM evaluations WHERE evaluation_period_id = $1)`,
      [req.params.id]
    );
    await client.query(
      `DELETE FROM task_evaluation_entries WHERE evaluation_id IN (SELECT id FROM evaluations WHERE evaluation_period_id = $1)`,
      [req.params.id]
    );
    await client.query(
      `DELETE FROM tasks WHERE evaluation_id IN (SELECT id FROM evaluations WHERE evaluation_period_id = $1)`,
      [req.params.id]
    );
    // evaluation 의 assignment_history_id 참조 해제 후 평가기간/평가건 단위 이력 정리.
    await client.query(
      `UPDATE evaluations SET assignment_history_id = NULL WHERE evaluation_period_id = $1`,
      [req.params.id]
    );
    await client.query(
      `DELETE FROM evaluator_assignment_history
        WHERE evaluation_period_id = $1
           OR evaluation_id IN (SELECT id FROM evaluations WHERE evaluation_period_id = $1)`,
      [req.params.id]
    );
    await client.query('DELETE FROM evaluations WHERE evaluation_period_id = $1', [req.params.id]);
    await client.query('DELETE FROM evaluation_periods WHERE id = $1', [req.params.id]);
    await client.query('COMMIT');
    res.json({ ok: true, deleted_id: req.params.id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error deleting evaluation period:', err);
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
        WHERE ${filter.clause.replaceAll('evaluation_period_id', 'ev.evaluation_period_id').replaceAll('evaluation_year', 'ev.evaluation_year')}
          AND COALESCE(ev.record_status, 'active') = 'active'
          AND EXISTS (
            SELECT 1
            FROM evaluator_assignment_history h
            WHERE h.evaluation_id = ev.id
              AND h.status = 'applied'
              AND h.change_type <> 'cancel'
          )
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
        SELECT
          ev.*,
          latest_ah.new_evaluator_id AS evaluator_id,
          latest_ah.changed_at AS evaluator_assigned_at,
          ev_emp.name AS evaluator_name,
          ev_emp.position AS evaluator_position,
          ev_emp.department AS evaluator_department
        FROM evaluations ev
        LEFT JOIN LATERAL (
          SELECT h.*
          FROM evaluator_assignment_history h
          WHERE h.evaluation_id = ev.id
            AND h.employee_id = ev.evaluatee_id
            AND h.status = 'applied'
            AND h.change_type <> 'cancel'
          ORDER BY h.changed_at DESC, h.id DESC
          LIMIT 1
        ) latest_ah ON TRUE
        LEFT JOIN employees ev_emp ON ev_emp.employee_id = latest_ah.new_evaluator_id
        WHERE ev.evaluatee_id = $1
          AND ${filter.clause.replaceAll('evaluation_period_id', 'ev.evaluation_period_id').replaceAll('evaluation_year', 'ev.evaluation_year')}
          AND COALESCE(ev.record_status, 'active') = 'active'        ORDER BY
          CASE WHEN ev.evaluation_status = 'draft' THEN 0 ELSE 1 END,
          latest_ah.changed_at DESC NULLS LAST,
          ev.created_at DESC
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
        SELECT
          ev.*,
          latest_ah.new_evaluator_id AS evaluator_id,
          latest_ah.changed_at AS evaluator_assigned_at,
          ev_emp.name AS evaluator_name,
          ev_emp.position AS evaluator_position,
          ev_emp.department AS evaluator_department
        FROM evaluations ev
        LEFT JOIN LATERAL (
          SELECT h.*
          FROM evaluator_assignment_history h
          WHERE h.evaluation_id = ev.id
            AND h.employee_id = ev.evaluatee_id
            AND h.status = 'applied'
            AND h.change_type <> 'cancel'
          ORDER BY h.changed_at DESC, h.id DESC
          LIMIT 1
        ) latest_ah ON TRUE
        LEFT JOIN employees ev_emp ON ev_emp.employee_id = latest_ah.new_evaluator_id
        WHERE ev.id = $1
          AND COALESCE(ev.record_status, 'active') = 'active'        LIMIT 1
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
            AND NOT EXISTS (
              SELECT 1
              FROM evaluator_assignment_history live
              WHERE live.evaluation_id = h.evaluation_id
                AND live.status = 'applied'
                AND live.change_type <> 'cancel'
            )
          WHERE ${existingFilter.clause.replaceAll('evaluation_period_id', 'ev.evaluation_period_id').replaceAll('evaluation_year', 'ev.evaluation_year').replaceAll('evaluatee_id', 'ev.evaluatee_id')}
            AND (
              COALESCE(ev.record_status, 'active') = 'active'
              OR EXISTS (
                SELECT 1
                FROM evaluator_assignment_history live
                WHERE live.evaluation_id = ev.id
                  AND live.status = 'applied'
                  AND live.change_type <> 'cancel'
              )
            )
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

  const client = await pool.connect();
  try {
    await assertEvaluationWritableById(req.params.id);
    await client.query('BEGIN');

    const { rows: priorRows } = await client.query(
      `
        SELECT ev.id, ev.evaluatee_id, ev.evaluatee_name, ev.evaluation_status,
               ah.new_evaluator_id AS evaluator_id,
               ev_emp.name AS evaluator_name
        FROM evaluations ev
        LEFT JOIN evaluator_assignment_history ah ON ah.id = ev.assignment_history_id
        LEFT JOIN employees ev_emp ON ev_emp.employee_id = ah.new_evaluator_id
        WHERE ev.id = $1
        LIMIT 1
      `,
      [req.params.id]
    );
    const prior = priorRows[0];

    const updates = req.body;
    const set = Object.keys(updates)
      .map((k, i) => `${k} = $${i + 1}`)
      .join(', ');
    const values = [...Object.values(updates), req.params.id];
    const { rows } = await client.query(
      `UPDATE evaluations SET ${set}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
      values
    );
    const after = rows[0];

    // 상태 전이 알림 — 평가의 owner 평가자/피평가자를 사용해 과거 평가자도 정상 수신
    if (prior && after && prior.evaluation_status !== after.evaluation_status) {
      const beforeStatus = prior.evaluation_status;
      const afterStatus = after.evaluation_status;
      const evaluatorId = prior.evaluator_id;
      const evaluatorName = prior.evaluator_name || '평가자';
      const evaluateeId = prior.evaluatee_id;
      const evaluateeName = prior.evaluatee_name || '피평가자';

      if (afterStatus === 'submitted' && evaluatorId) {
        await insertNotificationRow(client, {
          notificationType: 'evaluation_submitted',
          title: '피평가자가 평가를 최종제출했습니다',
          message: `${evaluateeName}님이 평가를 최종제출했습니다. 검토를 시작해 주세요.`,
          priority: 'high',
          senderId: evaluateeId,
          senderName: evaluateeName,
          recipientId: evaluatorId,
          relatedEvaluationId: req.params.id,
        });
      }

      if (afterStatus === 'completed' && beforeStatus !== 'completed' && evaluatorId) {
        await insertNotificationRow(client, {
          notificationType: 'evaluation_completed',
          title: '평가자가 평가를 완료했습니다',
          message: `${evaluatorName}님이 평가를 완료했습니다.`,
          priority: 'medium',
          senderId: evaluatorId,
          senderName: evaluatorName,
          recipientId: evaluateeId,
          relatedEvaluationId: req.params.id,
        });
      }
    }

    await client.query('COMMIT');
    res.json(after);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error updating evaluation:', err);
    res.status(err.statusCode ?? 500).json({ error: err.message ?? 'Database error' });
  } finally {
    client.release();
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
// 피평가자가 평가자에게 평가 반려를 요청 (알림만, status 변경 없음)
app.post('/api/evaluation/:id/return-request', async (req, res) => {
  if (!isDbAvailable) return sendDbUnavailable(res);
  const evaluationId = req.params.id;
  const requestedBy = normalizeOptionalText(req.body?.requestedBy ?? req.body?.requested_by);
  const reason = normalizeOptionalText(req.body?.reason);
  // origin: 발신 출처. 미지정(피평가자) 시 기존 문구 유지, 'hr' 시 HR 재검토 요청 문구로만 분기.
  // 수신자 해석·status 무변경·notification_type·priority는 출처와 무관하게 동일.
  const origin = normalizeOptionalText(req.body?.origin);
  const isHrOrigin = origin === 'hr';
  if (!requestedBy) {
    return res.status(400).json({ error: 'requestedBy is required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `
        SELECT e.id, e.evaluatee_id, e.evaluatee_name, e.evaluation_status,
               ah.new_evaluator_id, ev_emp.name AS evaluator_name
        FROM evaluations e
        LEFT JOIN evaluator_assignment_history ah ON ah.id = e.assignment_history_id
        LEFT JOIN employees ev_emp ON ev_emp.employee_id = ah.new_evaluator_id
        WHERE e.id = $1 AND COALESCE(e.record_status, 'active') = 'active'
        LIMIT 1
      `,
      [evaluationId]
    );
    const evaluation = rows[0];
    if (!evaluation) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Evaluation not found' });
    }
    if (!evaluation.new_evaluator_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Evaluation has no assigned evaluator' });
    }
    const requesterName = await resolveEmployeeName(
      client,
      requestedBy,
      isHrOrigin ? 'HR' : '피평가자',
    );
    const title = isHrOrigin ? 'HR 재검토 요청' : '피평가자가 수정을 요청했습니다';
    const baseMessage = isHrOrigin
      ? `${requesterName}님이 평가의견 재검토를 요청했습니다.`
      : `${requesterName}님이 과업 수정을 요청했습니다.`;
    await insertNotificationRow(client, {
      notificationType: 'evaluation_return_requested',
      title,
      message: reason ? `${baseMessage} 사유: ${reason}` : baseMessage,
      priority: 'high',
      senderId: requestedBy,
      senderName: requesterName,
      recipientId: evaluation.new_evaluator_id,
      relatedEvaluationId: evaluationId,
    });
    await client.query('COMMIT');
    res.json({ ok: true, recipient_id: evaluation.new_evaluator_id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error sending return request:', err);
    res.status(500).json({ error: err.message ?? 'Database error' });
  } finally {
    client.release();
  }
});

// 평가자가 완료 평가를 피평가자에게 돌려보냄 → in-progress 로 전환해 피평가자 측 잠금 해제
// 피평가자 재제출 시 자동으로 submitted → evaluating 흐름으로 복귀
app.post('/api/evaluation/:id/reopen', async (req, res) => {
  if (!isDbAvailable) return sendDbUnavailable(res);
  const evaluationId = req.params.id;
  const actorId = normalizeOptionalText(req.body?.actorId ?? req.body?.actor_id);
  const reason = normalizeOptionalText(req.body?.reason);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `
        SELECT e.id, e.evaluatee_id, e.evaluatee_name, e.evaluation_status,
               ah.new_evaluator_id
        FROM evaluations e
        LEFT JOIN evaluator_assignment_history ah ON ah.id = e.assignment_history_id
        WHERE e.id = $1 AND COALESCE(e.record_status, 'active') = 'active'
        LIMIT 1
      `,
      [evaluationId]
    );
    const evaluation = rows[0];
    if (!evaluation) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Evaluation not found' });
    }
    // submitted/evaluating/completed 모두 돌려보내기 허용 (평가자가 시작 전이어도 가능)
    if (!['completed', 'submitted', 'evaluating'].includes(evaluation.evaluation_status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Evaluation is not in a reviewable state' });
    }
    await client.query(
      `
        UPDATE evaluations
        SET evaluation_status = 'in-progress',
            last_modified = NOW(),
            updated_at = NOW()
        WHERE id = $1
      `,
      [evaluationId]
    );
    const actorName = await resolveEmployeeName(client, actorId, '평가자');
    await insertNotificationRow(client, {
      notificationType: 'evaluation_reopened',
      title: '평가자가 수정을 허용했습니다',
      message: reason
        ? `${actorName}님이 평가를 돌려보냈습니다. 과업을 수정한 뒤 다시 최종제출해 주세요. 사유: ${reason}`
        : `${actorName}님이 평가를 돌려보냈습니다. 과업을 수정한 뒤 다시 최종제출해 주세요.`,
      priority: 'medium',
      senderId: actorId,
      senderName: actorName,
      recipientId: evaluation.evaluatee_id,
      relatedEvaluationId: evaluationId,
    });
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error reopening evaluation:', err);
    res.status(500).json({ error: err.message ?? 'Database error' });
  } finally {
    client.release();
  }
});

// 평가자가 자기 완료 평가를 다시 열어 점수/피드백을 수정할 수 있는 단계(evaluating)로 되돌림
// 피평가자에게 알림 발송 없음 (평가자 자신만의 액션)
app.post('/api/evaluation/:id/reopen-for-evaluator', async (req, res) => {
  if (!isDbAvailable) return sendDbUnavailable(res);
  const evaluationId = req.params.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `
        SELECT id, evaluation_status
        FROM evaluations
        WHERE id = $1 AND COALESCE(record_status, 'active') = 'active'
        LIMIT 1
      `,
      [evaluationId]
    );
    const evaluation = rows[0];
    if (!evaluation) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Evaluation not found' });
    }
    if (evaluation.evaluation_status !== 'completed') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Evaluation is not in completed state' });
    }
    await client.query(
      `
        UPDATE evaluations
        SET evaluation_status = 'evaluating',
            last_modified = NOW(),
            updated_at = NOW()
        WHERE id = $1
      `,
      [evaluationId]
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error reopening evaluation for evaluator:', err);
    res.status(500).json({ error: err.message ?? 'Database error' });
  } finally {
    client.release();
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
          AND NOT EXISTS (
            SELECT 1
            FROM evaluator_assignment_history live
            WHERE live.evaluation_id = h.evaluation_id
              AND live.status = 'applied'
              AND live.change_type <> 'cancel'
          )
        WHERE ev.evaluation_status = $1
          AND ${filter.clause.replaceAll('evaluation_period_id', 'ev.evaluation_period_id').replaceAll('evaluation_year', 'ev.evaluation_year')}
          AND (
            COALESCE(ev.record_status, 'active') = 'active'
            OR EXISTS (
              SELECT 1
              FROM evaluator_assignment_history live
              WHERE live.evaluation_id = ev.id
                AND live.status = 'applied'
                AND live.change_type <> 'cancel'
            )
          )
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
          AND NOT EXISTS (
            SELECT 1
            FROM evaluator_assignment_history live
            WHERE live.evaluation_id = h.evaluation_id
              AND live.status = 'applied'
              AND live.change_type <> 'cancel'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM evaluator_assignment_history live
            WHERE live.evaluation_id = h.evaluation_id
              AND live.status = 'applied'
              AND live.change_type <> 'cancel'
          )
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
          AND (
            COALESCE(ev.record_status, 'active') = 'active'
            OR EXISTS (
              SELECT 1
              FROM evaluator_assignment_history live
              WHERE live.evaluation_id = ev.id
                AND live.status = 'applied'
                AND live.change_type <> 'cancel'
            )
          )
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
          AND NOT EXISTS (
            SELECT 1
            FROM evaluator_assignment_history live
            WHERE live.evaluation_id = h.evaluation_id
              AND live.status = 'applied'
              AND live.change_type <> 'cancel'
          )
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
          AND (
            COALESCE(ev.record_status, 'active') = 'active'
            OR EXISTS (
              SELECT 1
              FROM evaluator_assignment_history live
              WHERE live.evaluation_id = ev.id
                AND live.status = 'applied'
                AND live.change_type <> 'cancel'
            )
          )
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
          AND NOT EXISTS (
            SELECT 1
            FROM evaluator_assignment_history live
            WHERE live.evaluation_id = h.evaluation_id
              AND live.status = 'applied'
              AND live.change_type <> 'cancel'
          )
        WHERE tee.evaluation_id = $1
          AND COALESCE(tee.status, 'active') = 'active'
          AND (
            COALESCE(ev.record_status, 'active') = 'active'
            OR EXISTS (
              SELECT 1
              FROM evaluator_assignment_history live
              WHERE live.evaluation_id = ev.id
                AND live.status = 'applied'
                AND live.change_type <> 'cancel'
            )
          )
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
    const bypassCompletedLock = req.query?.past === '1' || req.query?.past === 'true';
    const task = await attachTaskEvaluationPeriod(req.body);
    if (task.evaluation_id) {
      await assertEvaluationWritableById(task.evaluation_id);
      await assertEvaluationTaskStructureEditableById(task.evaluation_id, {
        bypassCompletedLock,
      });
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
    const bypassCompletedLock = req.query?.past === '1' || req.query?.past === 'true';
    await assertTaskWritableById(req.params.id);
    const updates = req.body;
    if (hasTaskStructureChanges(updates)) {
      await assertTaskStructureEditableById(req.params.id, { bypassCompletedLock });
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
    const bypassCompletedLock = req.query?.past === '1' || req.query?.past === 'true';
    await assertTaskWritableById(req.params.id);
    await assertTaskStructureEditableById(req.params.id, { bypassCompletedLock });
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
    const bypassCompletedLock = req.query?.past === '1' || req.query?.past === 'true';
    await assertTaskWritableById(req.params.id);
    await assertTaskStructureEditableById(req.params.id, { bypassCompletedLock });
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
          AND NOT EXISTS (
            SELECT 1
            FROM evaluator_assignment_history live
            WHERE live.evaluation_id = h.evaluation_id
              AND live.status = 'applied'
              AND live.change_type <> 'cancel'
          )
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
          AND NOT EXISTS (
            SELECT 1
            FROM evaluator_assignment_history live
            WHERE live.evaluation_id = h.evaluation_id
              AND live.status = 'applied'
              AND live.change_type <> 'cancel'
          )
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
          AND NOT EXISTS (
            SELECT 1
            FROM evaluator_assignment_history live
            WHERE live.evaluation_id = h.evaluation_id
              AND live.status = 'applied'
              AND live.change_type <> 'cancel'
          )
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
    const recipientId = normalizeOptionalText(req.query?.recipientId ?? req.query?.recipient_id);
    const limitParam = Number.parseInt(req.query?.limit, 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50;

    if (recipientId) {
      const { rows } = await pool.query(
        'SELECT * FROM notifications WHERE recipient_id = $1 ORDER BY created_at DESC LIMIT $2',
        [recipientId, limit]
      );
      return res.json(rows);
    }

    const { rows } = await pool.query(
      'SELECT * FROM notifications ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching notifications:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.put('/api/notifications/read-all', async (req, res) => {
  const recipientId = normalizeOptionalText(req.query?.recipientId ?? req.body?.recipientId);
  if (!recipientId) {
    return res.status(400).json({ error: 'recipientId is required' });
  }
  try {
    const { rowCount } = await pool.query(
      'UPDATE notifications SET is_read = true WHERE recipient_id = $1 AND is_read = false',
      [recipientId]
    );
    res.json({ updated: rowCount });
  } catch (err) {
    console.error('Error marking all notifications read:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.delete('/api/notifications', async (req, res) => {
  const recipientId = normalizeOptionalText(req.query?.recipientId ?? req.body?.recipientId);
  if (!recipientId) {
    return res.status(400).json({ error: 'recipientId is required' });
  }
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM notifications WHERE recipient_id = $1',
      [recipientId]
    );
    res.json({ deleted: rowCount });
  } catch (err) {
    console.error('Error bulk deleting notifications:', err);
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

app.delete('/api/prompt/:key', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM prompt_templates WHERE key = $1',
      [req.params.key]
    );
    if (!rowCount) {
      return res.status(404).json({ error: 'Prompt not found' });
    }
    res.json({ ok: true, deleted_key: req.params.key });
  } catch (err) {
    console.error('Error deleting prompt:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

/* ==================== Evaluator AI Q&A Logs ==================== */
// 평가자 AI 도움말 문의 이력. 평가자 화면에서 1턴(질문+답변)씩 적재되고,
// HR 이 사용자별로 조회한다.

// 문의 1턴 저장 (평가자 화면에서 호출)
app.post('/api/evaluator-qna-logs', async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }
  const body = req.body ?? {};
  const userId = normalizeOptionalText(body.user_id ?? body.userId);
  const userName = normalizeOptionalText(body.user_name ?? body.userName);
  const userDepartment = normalizeOptionalText(body.user_department ?? body.userDepartment);
  const userRole = normalizeOptionalText(body.user_role ?? body.userRole);
  const question = normalizeOptionalText(body.question);
  const answer = normalizeOptionalText(body.answer);
  const isError = body.is_error === true || body.isError === true;

  if (!userId || !question) {
    return res.status(400).json({ error: 'user_id and question are required' });
  }

  try {
    const { rows } = await pool.query(
      `
        INSERT INTO evaluator_qna_logs
          (user_id, user_name, user_department, user_role, question, answer, is_error)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING *
      `,
      [userId, userName, userDepartment, userRole, question, answer, isError]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error saving evaluator qna log:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// 문의 이력 전체 조회 (HR 엑셀 다운로드용). 최신순.
app.get('/api/evaluator-qna-logs', async (req, res) => {
  if (!isDbAvailable) {
    return res.json([]);
  }
  try {
    const { rows } = await pool.query(
      `
        SELECT
          l.*,
          COALESCE(e.name, l.user_name) AS user_name,
          COALESCE(e.department, l.user_department) AS user_department
        FROM evaluator_qna_logs l
        LEFT JOIN employees e ON e.employee_id = l.user_id
        ORDER BY l.created_at DESC
        LIMIT 50000
      `
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching evaluator qna logs:', err);
    res.json([]);
  }
});

// Health?멵heck endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});
/* ==================== Server Start ==================== */

const PORT = Number(process.env.PORT) || 5000;
app.listen(PORT, () => {
  console.log(`?윟 API server listening on http://localhost:${PORT}`);
});

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { randomUUID } from 'crypto';
import pg, { Pool } from 'pg';
import bcrypt from 'bcryptjs';

// PostgreSQL `date`(OID 1082) 컬럼은 시간·타임존이 없는 '날짜 그 자체'다.
// node-postgres 기본 파서는 이를 '로컬 자정 Date'로 바꾸는데, 그 Date 를 JSON 직렬화하면
// UTC 기준 ISO(예: KST 2026-06-01 → '2026-05-31T15:00:00Z')가 되어 화면/편집폼에서 하루 밀려 보인다.
// 그래서 date 는 변환 없이 'YYYY-MM-DD' 문자열 그대로 반환한다(타임존 밀림 원천 차단).
// timestamp/timestamptz(생성일시 등)는 영향받지 않는다.
pg.types.setTypeParser(1082, (value) => value);
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

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
    const name = key.trim();
    // dotenv 표준: 이미 설정된 환경변수(셸·docker-compose 주입)가 .env 보다 우선한다.
    if (process.env[name] !== undefined) return;
    let value = rest.join('=').trim();
    // .env 값의 둘러싼 따옴표 허용(dotenv 호환) — 수제 파서라 직접 벗긴다.
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    process.env[name] = value;
  });
}

const mockEmployees = fs.existsSync(mockEmployeesPath)
  ? JSON.parse(fs.readFileSync(mockEmployeesPath, 'utf8'))
  : [];

let isDbAvailable = false;

// DB를 못 쓰는 상황의 단일 정책: 운영은 fail-fast(빈 데이터로 장애를 은폐하지 않음),
// 개발에서 mock으로 띄우려면 ALLOW_MOCK_FALLBACK=true.
const exitOrMock = (reason) => {
  if (process.env.ALLOW_MOCK_FALLBACK === 'true') {
    console.warn(`${reason} — ALLOW_MOCK_FALLBACK=true, mock DB로 기동(개발 전용).`);
    pool = { query: async () => ({ rows: [], rowCount: 0 }) };
    return;
  }
  console.error(`${reason} — 프로세스를 종료합니다. (개발 mock: ALLOW_MOCK_FALLBACK=true)`);
  process.exit(1);
};

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
// 기본 프롬프트 시드 — 빈 DB(내부망 반입 등)에 프론트/서버 공용 기본 프롬프트를 채운다.
// 단일 원천: src/lib/defaultPrompts.json (프론트 gptOss.ts 도 동일 파일을 import).
// ON CONFLICT DO NOTHING 이라 HR이 편집한 행은 보존하고, 없는 키만 새로 넣는다.
const defaultPromptsPath = path.resolve(__dirname, 'src/lib/defaultPrompts.json');
const DEFAULT_PROMPTS_SEED = fs.existsSync(defaultPromptsPath)
  ? JSON.parse(fs.readFileSync(defaultPromptsPath, 'utf8'))
  : [];
async function seedDefaultPrompts() {
  if (!isDbAvailable || !pool?.query) return;
  try {
    let inserted = 0;
    for (const p of DEFAULT_PROMPTS_SEED) {
      const r = await pool.query(
        `INSERT INTO prompt_templates (key, description, content)
         VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING`,
        [p.key, p.description, p.content],
      );
      inserted += r.rowCount || 0;
    }
    console.log(`[seed] prompt_templates: ${inserted} new (of ${DEFAULT_PROMPTS_SEED.length} defaults)`);
  } catch (e) {
    console.error('[seed] prompt seed failed:', e.message);
  }
}

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
      console.log('PostgreSQL 연결 성공 (API 서버)');
      ensureRuntimeSchema();
      seedDefaultPrompts();
    })
    .catch(err => {
      console.error('PostgreSQL 연결 실패 (API 서버):', err.message);
      exitOrMock('DB unavailable');
    });
} else {
  exitOrMock('DATABASE_URL not set');
}

// 배포 DB 자가복구: render.yaml 에 마이그레이션 단계가 없어, render-schema.sql 스냅샷 이후 추가된
// 컬럼이 배포 DB 에 빠지면 해당 기능이 500 으로 깨진다(예: /reopen 의 returned_at). 부팅 시 멱등
// ADD COLUMN IF NOT EXISTS 로 보강 — Render/내부망/로컬 어디서든 재시작만으로 스키마가 맞춰진다.
// (이미 컬럼이 있으면 no-op. 신규 마이그레이션 컬럼은 여기에 한 줄씩 누적한다.)
async function ensureRuntimeSchema() {
  if (!pool?.query) return;
  try {
    await pool.query(`
      ALTER TABLE evaluations
        ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
        ADD COLUMN IF NOT EXISTS returned_at  timestamptz,
        ADD COLUMN IF NOT EXISTS reverted_at  timestamptz,
        ADD COLUMN IF NOT EXISTS completed_at timestamptz
    `);
    console.log('[schema] 런타임 컬럼 보강 확인 완료');
  } catch (err) {
    console.error('[schema] ensureRuntimeSchema 실패:', err.message);
  }
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
  'matching_result', // 복직 처리 시 '휴직' 해제 등
  'ai_rule_exempt', // AI 과업 50% 규칙 면제(HR 지정)
]);
// 보안(P0): 평가 생성/수정 시 허용 컬럼 화이트리스트(동적 키 보간·mass-assignment 차단).
const EVALUATION_INSERT_FIELDS = new Set([
  'evaluatee_id', 'evaluatee_name', 'evaluatee_position', 'evaluatee_department',
  'growth_level', 'evaluation_status', 'evaluation_year', 'evaluation_period_id',
  'last_modified', 'assignment_history_id',
  'evaluatee_dept_code', 'evaluatee_org_corporation', 'evaluatee_org_division',
  'evaluatee_org_department', 'evaluatee_org_team',
]);
const EVALUATION_UPDATE_FIELDS = new Set(['evaluation_status', 'last_modified']);
// 감사로그 diff에서 제외할 부기성 필드(클라이언트가 매 저장 갱신 → 실질 변경 아님).
const EVALUATION_AUDIT_IGNORED_FIELDS = new Set(['last_modified', 'updated_at']);
const ASSIGNMENT_HISTORY_CHANGE_TYPES = new Set(['change', 'cancel']);
const ASSIGNMENT_HISTORY_STATUSES = new Set(['applied', 'cancelled']);
const TASK_STRUCTURE_FIELDS = new Set([
  'title',
  'description',
  'weight',
  'is_ai_task',
  'isAiTask',
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
  // 같은 직원의 발령 이력 여러 행 중 '가장 마지막 근무시작일' 행을 현재 상태로 본다.
  // (부서코드·평가자 등 현재값의 출처. 날짜가 같으면 소속순번 큰 쪽, 그다음 평가자 있는 쪽.)
  const score = (row) => ({
    startTime: row.work_start_date ? Date.parse(row.work_start_date) || 0 : 0,
    sequence: Number(row.org_sequence) || 0,
    hasEvaluator: row.evaluator_id ? 1 : 0,
  });
  const left = score(a);
  const right = score(b);
  if (left.startTime !== right.startTime) return left.startTime - right.startTime;
  if (left.sequence !== right.sequence) return left.sequence - right.sequence;
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
        -- 버그수정: 활성 entry만 카운트. 전부 cancelled 면 total_count=0 → 기존 점수 보존
        -- (취소분까지 세면 latest(활성)=NULL 과 맞물려 tasks.score 를 NULL 로 지워버림).
        WHERE COALESCE(tee.status, 'active') = 'active'
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
      employee.position ?? '',
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
          evaluation_period_id,
          -- 버그수정: 평가기간 단위로 파티션. 연도 경계를 넘어 prev 를 체인하면
          -- 평가자가 그대로여도 새 연도 첫 배정이 'X→X' 로 잘못 표기됨.
          ROW_NUMBER() OVER (
            PARTITION BY evaluation_period_id ORDER BY changed_at, id
          ) AS rn
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
        LEFT JOIN numbered prev
          ON prev.rn = curr.rn - 1
          AND prev.evaluation_period_id IS NOT DISTINCT FROM curr.evaluation_period_id
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
        t.deleted_at,
        e.evaluatee_id,
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

  // 소프트 삭제된 과업에 대한 채점(entry) 기록 차단 — 피평가자가 과업을 삭제·재제출한 뒤
  // 평가자의 stale 탭이 저장하면 삭제 과업에 유령 점수가 남는 경로를 서버에서 원천 봉쇄.
  if (task.deleted_at) {
    throw Object.assign(
      new Error('삭제된 과업에는 평가를 저장할 수 없습니다. 화면을 새로고침해 최신 과업 목록으로 다시 평가해 주세요.'),
      { statusCode: 409 },
    );
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
// res.json/res.send 자동 etag 끔 → /api 동적 응답에 304(조건부 캐시)가 안 생긴다.
// (express.static·res.sendFile 은 자체 etag 를 써 정적 자산 캐싱엔 영향 없음.)
app.set('etag', false);

// 보안 헤더 — API 서버 기준. SPA는 별도 서빙이라 CSP는 끔(켜면 정적 인라인 자산이 깨질 수 있음).
app.use(helmet({ contentSecurityPolicy: false }));

// CORS 화이트리스트 — 기본은 로컬 dev 오리진(vite 5173/preview 4173). 운영은 CORS_ORIGINS(콤마 구분).
// Origin 헤더 없는 same-origin/프록시 요청은 항상 허용(운영 기본형: vite proxy·동일 호스트 서빙).
const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:4173')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: (origin, callback) => callback(null, !origin || corsOrigins.includes(origin)),
    credentials: true,
  }),
);

// 표준 JSON 파서 + 크기 제한 — 수제 파서(본문 개행을 공백 치환·크기 무제한)는 폐기.
// 한도는 매칭/프로필 임포트(수천 행 JSON)를 감안해 5mb.
app.use(express.json({ limit: '5mb' }));

// 전역 레이트리밋(IP당 분당 3000) — DoS 방어 수준의 느슨한 한도.
// HR 화면이 아직 직원당 N+1 요청이라(D-1 전) 타이트하면 정상 사용이 429가 된다 — D-1 후 하향 조정.
// 로그인(분당 10)·AI(분당 20)는 자체 리밋이 별도로 더 엄격하다.
app.use(
  '/api',
  rateLimit({
    windowMs: 60_000,
    limit: 3000,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.' },
  }),
);

// CSRF 방어(P1): 상태변경 요청은 커스텀 헤더 X-Requested-With 를 요구한다. 단순 폼/이미지 요청은
// 이 헤더를 설정할 수 없고, fetch 로 설정하면 CORS preflight 가 발생해 화이트리스트 밖 오리진은 차단된다.
// (쿠키 SameSite=Lax 위의 방어심층.) 프런트의 모든 쓰기 호출은 이 헤더를 보낸다.
const CSRF_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
app.use('/api', (req, res, next) => {
  if (CSRF_SAFE_METHODS.has(req.method)) return next();
  if (req.get('X-Requested-With') !== 'XMLHttpRequest') {
    return res.status(403).json({ error: '허용되지 않은 요청입니다. (CSRF 보호)' });
  }
  next();
});

// 캐시 금지(중요): /api 는 로그인 사용자별 동적 데이터다. Express 의 자동 etag 로 브라우저가
// 응답을 캐싱하면, 평가기간을 바꿔 같은 URL 을 다시 호출해도 304 로 '옛 응답'을 그대로 써서
// 지난 값(예: 다른 평가기간의 성장레벨)이 표시되는 문제가 생긴다. 항상 새로 받도록 no-store.
// (클라이언트 캐싱은 React Query 가 담당하므로 HTTP 캐시는 불필요.)
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
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
const AI_RATE_LIMIT_PER_MINUTE = 40;
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
  // 인가 게이트보다 위에 정의되어 자체적으로 세션을 검사한다(로그인 사용자만, 사용자별 레이트리밋).
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  if (!aiConfigured) {
    return res.status(503).json({
      configured: false,
      error: 'AI not configured',
      message: 'AI_API_KEY(임시 GitHub Models) 또는 AI_BASE_URL(내부 GPT-OSS)을 .env에 설정해 주세요.',
    });
  }

  if (aiRateLimited(session.employeeId)) {
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
      signal: AbortSignal.timeout(55_000),
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      // 업스트림 에러 본문은 서버 로그에만 남긴다(키·내부 정보 노출 방지).
      console.error('AI upstream error:', upstream.status, text.slice(0, 500));
      // 레이트리밋(429)은 상태코드를 그대로 전달 → 클라이언트가 재시도/안내할 수 있게 한다.
      const passthrough = upstream.status === 429 ? 429 : 502;
      return res.status(passthrough).json({ error: 'AI upstream error', status: upstream.status });
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
    const name = part.slice(0, idx).trim();
    const rawValue = part.slice(idx + 1).trim();
    // 잘못된 % 인코딩이 들어와도 decodeURIComponent 예외로 매 요청이 500 되지 않도록 폴백.
    try {
      out[name] = decodeURIComponent(rawValue);
    } catch {
      out[name] = rawValue;
    }
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
  // setSessionCookie 와 속성 일관성 유지(Secure 포함) — 일부 브라우저는 속성이 맞아야 삭제 적용.
  const attrs = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (process.env.COOKIE_SECURE === 'true') attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
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

// 비밀번호 초기화 '요청' (공개 — 비밀번호를 잊은 사용자가 로그인 전 단계에서 사번으로 요청).
// 승인은 HR. 존재하지 않는 사번도 동일 성공 응답으로 처리해 사번 존재 여부를 노출하지 않는다.
// pending 중복은 partial unique index 로 1건만 유지하고, 새로 생성된 경우에만 HR 에 알림(스팸 방지).
app.post('/api/auth/password-reset-request', async (req, res) => {
  if (!isDbAvailable) return sendDbUnavailable(res);
  const employeeId = typeof req.body?.employee_id === 'string' ? req.body.employee_id.trim() : '';
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!employeeId) {
    return res.status(400).json({ error: '사번을 입력해 주세요.' });
  }
  const successMessage =
    '비밀번호 초기화 요청이 접수되었습니다. 관리자 승인 후 사번(초기 비밀번호)으로 로그인할 수 있습니다.';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT employee_id, name FROM employees WHERE employee_id::text = $1 LIMIT 1',
      [employeeId],
    );
    const employee = rows[0];
    if (employee) {
      const inserted = await client.query(
        `INSERT INTO password_reset_requests (employee_id, employee_name, reason, status)
         VALUES ($1, $2, NULLIF($3, ''), 'pending')
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [employee.employee_id, employee.name ?? null, reason],
      );
      // 새 요청이 실제로 생성된 경우에만 HR 전원에게 알림(중복 요청 스팸 방지).
      if (inserted.rows[0]) {
        const { rows: hrRows } = await client.query(
          `SELECT employee_id FROM employees
            WHERE employee_id = 'admin' OR 'hr' = ANY(available_roles)`,
        );
        for (const hr of hrRows) {
          await insertNotificationRow(client, {
            notificationType: 'hr_message',
            title: '비밀번호 초기화 요청',
            message: `${employee.name ?? employee.employee_id}(${employee.employee_id})님이 비밀번호 초기화를 요청했습니다.`,
            priority: 'high',
            senderId: employee.employee_id,
            senderName: employee.name ?? employee.employee_id,
            recipientId: hr.employee_id,
          });
        }
      }
    }
    await client.query('COMMIT');
    res.json({ ok: true, message: successMessage });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('비밀번호 초기화 요청 실패:', err.message);
    res.status(500).json({ error: '요청 처리 중 오류가 발생했습니다.' });
  } finally {
    client.release();
  }
});

/* ==================== Authorization Gate ==================== */
// 이 지점 이후 등록되는 모든 /api 라우트는 로그인 세션 필수(req.session 주입).
// 예외(위쪽 등록): /api/auth/*(로그인 자체), /api/ai/status(무해한 설정 조회), /health.
// /api/ai/chat 은 게이트보다 위에 있어 핸들러 안에서 자체 세션 검사를 한다.
app.use('/api', (req, res, next) => {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  req.session = session;
  next();
});

// 요청자 HR 여부 — 역할은 DB available_roles 만 신뢰(세션 신원 기반). admin 계정은 항상 HR.
// 요청당 1회만 조회(req 캐시).
const requesterIsHr = async (req) => {
  if (req._isHr !== undefined) return req._isHr;
  const { rows } = await pool.query(
    `SELECT 1 FROM employees
      WHERE employee_id::text = $1
        AND (employee_id = 'admin' OR 'hr' = ANY(available_roles))
      LIMIT 1`,
    [req.session.employeeId],
  );
  req._isHr = rows.length > 0;
  return req._isHr;
};

const requireHr = async (req, res, next) => {
  if (!isDbAvailable) return sendDbUnavailable(res);
  try {
    if (!(await requesterIsHr(req))) {
      return res.status(403).json({ error: 'HR 권한이 필요합니다.' });
    }
    next();
  } catch (err) {
    console.error('HR 권한 확인 실패:', err.message);
    res.status(500).json({ error: '권한 확인 중 오류가 발생했습니다.' });
  }
};

// 요청자 평가자 여부 — available_roles 에 'evaluator'. 소속 org(팀 스코프 제한용)도 함께 캐시.
const requesterIsEvaluator = async (req) => {
  if (req._isEvaluator !== undefined) return req._isEvaluator;
  const { rows } = await pool.query(
    `SELECT org_corporation, org_division, org_department, org_team
       FROM employees
      WHERE employee_id::text = $1 AND 'evaluator' = ANY(available_roles)
      LIMIT 1`,
    [req.session.employeeId],
  );
  req._evaluatorOrg = rows[0] ?? null;
  req._isEvaluator = rows.length > 0;
  return req._isEvaluator;
};

// KPI 등록/배분: HR 이거나 평가자. (세부 스코프 — 팀장은 자기 팀만 — 은 각 핸들러에서 검사)
const requireHrOrEvaluator = async (req, res, next) => {
  if (!isDbAvailable) return sendDbUnavailable(res);
  try {
    if ((await requesterIsHr(req)) || (await requesterIsEvaluator(req))) return next();
    return res.status(403).json({ error: 'HR 또는 평가자 권한이 필요합니다.' });
  } catch (err) {
    console.error('KPI 권한 확인 실패:', err.message);
    res.status(500).json({ error: '권한 확인 중 오류가 발생했습니다.' });
  }
};

/* ── 행 단위 접근제어 (S-3): 평가 데이터는 "본인 / 그 평가의 평가자 / HR"만 ── */

// 직원 응답에서 인증 컬럼 제거 — SELECT * 라우트가 password_hash 를 흘리지 않도록 응답 직전에 벗긴다.
const stripAuthFields = (data) => {
  if (Array.isArray(data)) return data.map(stripAuthFields);
  if (data && typeof data === 'object' && ('password_hash' in data || 'must_change_password' in data)) {
    const { password_hash: _ph, must_change_password: _mc, ...safe } = data;
    return safe;
  }
  return data;
};

// 평가 라인 열람(#1): 대상(피평가자)이 요청자의 '평가 라인 하위'인지 — 즉 대상에서
// evaluator_id 를 위로 따라 올라갔을 때 요청자(me)가 조상(상위 평가자)으로 나오면 true.
// 평가자→피평가자 엣지를 그대로 쓰므로 인사이동(평가자 재배정) 시 자동 반영되고, org 데이터·
// 부서장 플래그가 필요 없다. 상향 경로는 분기가 없어(각자 평가자 1명) 선형이라 가볍다.
// 이 허용은 '읽기 전용' 가드에서만 opt-in 으로 켠다(쓰기 권한은 절대 부여하지 않음).
const requesterIsEvalLineAncestorOf = async (req, evaluateeId) => {
  const me = req.session?.employeeId ? String(req.session.employeeId) : '';
  const target = String(evaluateeId ?? '');
  if (!me || !target || me === target) return false;
  const { rows } = await pool.query(
    `WITH RECURSIVE up AS (
       SELECT employee_id, evaluator_id, 1 AS depth
         FROM employees WHERE employee_id::text = $1
       UNION ALL
       SELECT e.employee_id, e.evaluator_id, up.depth + 1
         FROM employees e
         JOIN up ON e.employee_id::text = up.evaluator_id::text
        WHERE up.depth < 50 AND up.evaluator_id IS NOT NULL
          -- 목록 쿼리와 동일 규칙: '평가자'로 체크된 조상을 통해서만 상향 도달.
          AND 'evaluator' = ANY(e.available_roles)
     )
     SELECT 1 FROM up WHERE up.evaluator_id::text = $2 LIMIT 1`,
    [target, me],
  );
  return rows.length > 0;
};

// evaluations 에는 평가자 컬럼이 없다 — 평가자는 assignment_history_id(그 평가의 배정) 또는
// employees.evaluator_id(현 담당 마스터)로 파생된다. 가드 쿼리가 두 값을 함께 조회해 넘긴다.
// allowLineDescendant: 읽기 전용 라우트에서만 true — 평가 라인 하위(재귀) 열람을 추가 허용.
const canAccessEvaluation = async (req, evaluationRow, { allowLineDescendant = false } = {}) => {
  if (!evaluationRow) return false;
  const me = req.session.employeeId;
  if (String(evaluationRow.evaluatee_id ?? '') === me) return true;
  if (String(evaluationRow.assigned_evaluator_id ?? '') === me) return true;
  if (String(evaluationRow.current_evaluator_id ?? '') === me) return true;
  if (await requesterIsHr(req)) return true;
  if (allowLineDescendant && (await requesterIsEvalLineAncestorOf(req, evaluationRow.evaluatee_id))) return true;
  return false;
};

// 사번 단위 평가 열람: 본인 / HR / 현 담당 평가자 / 과거 그 직원을 평가했던 평가자(발령 이력 열람).
// allowLineDescendant: 읽기 전용 라우트에서만 true — 평가 라인 하위(재귀) 열람을 추가 허용.
const canAccessEmployeeEvaluations = async (req, employeeId, { allowLineDescendant = false } = {}) => {
  const target = String(employeeId ?? '');
  if (!target) return false;
  const me = req.session.employeeId;
  if (target === me) return true;
  if (await requesterIsHr(req)) return true;
  const { rows } = await pool.query(
    `SELECT 1 FROM employees WHERE employee_id::text = $1 AND evaluator_id::text = $2
     UNION ALL
     SELECT 1
       FROM evaluations ev
       JOIN evaluator_assignment_history h ON h.id = ev.assignment_history_id
      WHERE ev.evaluatee_id::text = $1 AND h.new_evaluator_id::text = $2
     LIMIT 1`,
    [target, me],
  );
  if (rows.length > 0) return true;
  if (allowLineDescendant && (await requesterIsEvalLineAncestorOf(req, target))) return true;
  return false;
};

// 가드 미들웨어들 — 대상 행을 미리 조회해 권한만 검사하고, 404 등 본 처리(및 mock 모드)는 핸들러에 맡긴다.
const guardEvaluationParam = (paramName, opts = {}) => async (req, res, next) => {
  if (!isDbAvailable) return next();
  try {
    const { rows } = await pool.query(
      `SELECT ev.evaluatee_id,
              h.new_evaluator_id AS assigned_evaluator_id,
              e.evaluator_id AS current_evaluator_id
         FROM evaluations ev
         LEFT JOIN evaluator_assignment_history h ON h.id = ev.assignment_history_id
         LEFT JOIN employees e ON e.employee_id = ev.evaluatee_id
        WHERE ev.id::text = $1`,
      [String(req.params?.[paramName] ?? '')],
    );
    if (rows.length === 0) return next();
    if (await canAccessEvaluation(req, rows[0], opts)) return next();
    return res.status(403).json({ error: '해당 평가에 접근할 권한이 없습니다.' });
  } catch (err) {
    console.error('평가 접근 검사 실패:', err.message);
    return res.status(500).json({ error: '권한 확인 중 오류가 발생했습니다.' });
  }
};

const guardEmployeeEvaluationsParam = (paramName, opts = {}) => async (req, res, next) => {
  if (!isDbAvailable) return next();
  try {
    if (await canAccessEmployeeEvaluations(req, req.params?.[paramName], opts)) return next();
    return res.status(403).json({ error: '해당 직원의 평가에 접근할 권한이 없습니다.' });
  } catch (err) {
    console.error('직원 평가 접근 검사 실패:', err.message);
    return res.status(500).json({ error: '권한 확인 중 오류가 발생했습니다.' });
  }
};

const guardTaskParam = (paramName, source = 'params') => async (req, res, next) => {
  if (!isDbAvailable) return next();
  try {
    const taskId = String(
      (source === 'body' ? req.body?.[paramName] ?? req.body?.taskId : req.params?.[paramName]) ?? '',
    );
    if (!taskId) return next();
    const { rows } = await pool.query(
      `SELECT ev.evaluatee_id,
              h.new_evaluator_id AS assigned_evaluator_id,
              e.evaluator_id AS current_evaluator_id
         FROM tasks t
         JOIN evaluations ev ON ev.id = t.evaluation_id
         LEFT JOIN evaluator_assignment_history h ON h.id = ev.assignment_history_id
         LEFT JOIN employees e ON e.employee_id = ev.evaluatee_id
        WHERE t.id::text = $1`,
      [taskId],
    );
    if (rows.length === 0) return next();
    if (await canAccessEvaluation(req, rows[0])) return next();
    return res.status(403).json({ error: '해당 과업에 접근할 권한이 없습니다.' });
  } catch (err) {
    console.error('과업 접근 검사 실패:', err.message);
    return res.status(500).json({ error: '권한 확인 중 오류가 발생했습니다.' });
  }
};

const guardFeedbackParam = (paramName) => async (req, res, next) => {
  if (!isDbAvailable) return next();
  try {
    const { rows } = await pool.query(
      `SELECT ev.evaluatee_id,
              h.new_evaluator_id AS assigned_evaluator_id,
              e.evaluator_id AS current_evaluator_id
         FROM feedback_history fh
         JOIN evaluations ev ON ev.id = fh.evaluation_id
         LEFT JOIN evaluator_assignment_history h ON h.id = ev.assignment_history_id
         LEFT JOIN employees e ON e.employee_id = ev.evaluatee_id
        WHERE fh.id::text = $1`,
      [String(req.params?.[paramName] ?? '')],
    );
    if (rows.length === 0) return next();
    if (await canAccessEvaluation(req, rows[0])) return next();
    return res.status(403).json({ error: '해당 피드백에 접근할 권한이 없습니다.' });
  } catch (err) {
    console.error('피드백 접근 검사 실패:', err.message);
    return res.status(500).json({ error: '권한 확인 중 오류가 발생했습니다.' });
  }
};

const guardNotificationParam = (paramName) => async (req, res, next) => {
  if (!isDbAvailable) return next();
  try {
    const { rows } = await pool.query('SELECT recipient_id FROM notifications WHERE id::text = $1', [
      String(req.params?.[paramName] ?? ''),
    ]);
    if (rows.length === 0) return next();
    if (String(rows[0].recipient_id ?? '') === req.session.employeeId) return next();
    if (await requesterIsHr(req)) return next();
    return res.status(403).json({ error: '해당 알림에 접근할 권한이 없습니다.' });
  } catch (err) {
    console.error('알림 접근 검사 실패:', err.message);
    return res.status(500).json({ error: '권한 확인 중 오류가 발생했습니다.' });
  }
};

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
    res.json(stripAuthFields(rows[0]));
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
    res.json(stripAuthFields(rows));
  } catch (err) {
    console.error('Error fetching employees:', err);
    res.json([...mockEmployees].sort((a, b) => a.name.localeCompare(b.name)));
  }
});

// 단건 사용자 추가
app.post('/api/employees', requireHr, async (req, res) => {
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
app.delete('/api/employee/:id', requireHr, async (req, res) => {
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
    res.json(stripAuthFields(rows));
  } catch (err) {
    console.error('Error fetching employees by evaluator:', err);
    res.json(getMockEmployeesByEvaluator(req.params.evaluatorId));
  }
});

// 그 평가기간의 평가별 (평가자 → 피평가자) 엣지. 평가자 = 그 평가의 최신 배정(assignment_history)의
// new_evaluator_id, 없으면 employees.evaluator_id 폴백 — /evaluations/by-employee 의 evaluator_id 와 동일 기준.
// assigned_at = 그 배정의 changed_at(= 그 기간 배정일). 활성(record_status=active) 평가만.
const PERIOD_EDGES_CTE = `
  edges AS (
    SELECT ev.evaluatee_id::text AS evaluatee_id,
           COALESCE(latest_ah.new_evaluator_id, emp.evaluator_id)::text AS evaluator_id,
           latest_ah.changed_at AS assigned_at
      FROM evaluations ev
      LEFT JOIN employees emp ON emp.employee_id = ev.evaluatee_id
      LEFT JOIN LATERAL (
        SELECT h.new_evaluator_id, h.changed_at
          FROM evaluator_assignment_history h
         WHERE h.evaluation_id = ev.id AND h.employee_id = ev.evaluatee_id
           AND h.status = 'applied' AND h.change_type <> 'cancel'
         ORDER BY h.changed_at DESC, h.id DESC LIMIT 1
      ) latest_ah ON TRUE
     WHERE ev.evaluation_period_id = $2 AND COALESCE(ev.record_status, 'active') = 'active'
       AND COALESCE(latest_ah.new_evaluator_id, emp.evaluator_id) IS NOT NULL
  )`;

// 평가 라인 하위 열람(#1): 요청자의 '그 평가기간' 평가 라인 재귀 하위 인원을 반환한다.
// 그 기간의 (평가자→피평가자) 엣지만 따라 내려가므로, 다른 기간에만 배정된 사람은 섞이지 않는다.
// '평가자'로 체크된 노드를 통해서만 전개. 직접 담당(1단계)은 담당에 이미 있어 제외. 본인(또는 HR)만.
// periodId 없으면 빈 배열(기간 컨텍스트 필수).
app.get('/api/employees/eval-line/:evaluatorId', async (req, res) => {
  if (!isDbAvailable) return res.json([]);
  try {
    const target = String(req.params.evaluatorId ?? '');
    const me = req.session?.employeeId ? String(req.session.employeeId) : '';
    if (!me) return res.status(401).json({ error: '로그인이 필요합니다.' });
    if (target !== me && !(await requesterIsHr(req))) {
      return res.status(403).json({ error: '권한이 없습니다.' });
    }
    const periodId =
      typeof req.query.periodId === 'string' && req.query.periodId.trim()
        ? req.query.periodId.trim()
        : null;
    if (!periodId) return res.json([]);
    const { rows } = await pool.query(
      `WITH RECURSIVE ${PERIOD_EDGES_CTE},
       down AS (
         SELECT e.evaluatee_id, 1 AS depth FROM edges e WHERE e.evaluator_id = $1
         UNION ALL
         SELECT e.evaluatee_id, d.depth + 1
           FROM edges e
           JOIN down d ON e.evaluator_id = d.evaluatee_id
           JOIN employees emp2 ON emp2.employee_id::text = e.evaluator_id
          WHERE d.depth < 50 AND 'evaluator' = ANY(emp2.available_roles)
       )
       SELECT DISTINCT m.* FROM employees m
         JOIN down ON down.evaluatee_id = m.employee_id::text
        WHERE m.employee_id::text <> $1
          AND m.employee_id::text NOT IN (SELECT evaluatee_id FROM edges WHERE evaluator_id = $1)
        ORDER BY m.name`,
      [target, periodId],
    );
    res.json(stripAuthFields(rows));
  } catch (err) {
    console.error('평가 라인 하위 열람 조회 실패:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// 로스터 '내 체인 산입일'(근무기간 시작) — 담당 팀원 통합표용. '그 평가기간' 체인 기준.
// chain_since = 그가 속한 '내 직속 가지'의 최상단(=내 직접 피평가자=가지 루트)이 그 기간에 나에게
//   배정된 날짜(그 평가의 배정 changed_at). 직접 담당이면 본인 배정일. 그리고 MAX(연도 1/1, 배정일)로 클램프.
// 응답: [{ employee_id, chain_since }]. 본인(또는 HR)만. periodId 없으면 빈 배열.
app.get('/api/employees/roster-since/:evaluatorId', async (req, res) => {
  if (!isDbAvailable) return res.json([]);
  try {
    const target = String(req.params.evaluatorId ?? '');
    const me = req.session?.employeeId ? String(req.session.employeeId) : '';
    if (!me) return res.status(401).json({ error: '로그인이 필요합니다.' });
    if (target !== me && !(await requesterIsHr(req))) {
      return res.status(403).json({ error: '권한이 없습니다.' });
    }
    const periodId =
      typeof req.query.periodId === 'string' && req.query.periodId.trim()
        ? req.query.periodId.trim()
        : null;
    if (!periodId) return res.json([]);
    const yearRaw = typeof req.query.year === 'string' ? parseInt(req.query.year, 10) : NaN;
    const year = Number.isInteger(yearRaw) ? yearRaw : null;
    const { rows } = await pool.query(
      `WITH RECURSIVE ${PERIOD_EDGES_CTE},
       down AS (
         SELECT e.evaluatee_id, 1 AS depth
           FROM edges e WHERE e.evaluator_id = $1
         UNION ALL
         SELECT e.evaluatee_id, d.depth + 1
           FROM edges e
           JOIN down d ON e.evaluator_id = d.evaluatee_id
           JOIN employees emp2 ON emp2.employee_id::text = e.evaluator_id
          WHERE d.depth < 50 AND 'evaluator' = ANY(emp2.available_roles)
       ),
       -- 내 체인 안의 '평가자'가 될 수 있는 사람 = 나 + 체인 하위 전원.
       chain_members AS (
         SELECT $1::text AS id
         UNION
         SELECT DISTINCT evaluatee_id FROM down
       ),
       roster AS (SELECT DISTINCT evaluatee_id FROM down)
       -- chain_since = 그 사람의 배정 중 '새 평가자가 내 체인 안'인 것들의 가장 이른 날짜.
       -- → 내 체인 안에서 이동(재배치)해도 최초 합류일이 유지된다(체인 밖 시절 배정은 제외).
       -- 연도 1/1 로 클램프(이전 연도부터 이어졌으면 1/1). 매칭 없으면 NULL→클램프 시 1/1.
       SELECT r.evaluatee_id AS employee_id,
              CASE
                WHEN $3::int IS NULL THEN MIN(h.changed_at)
                ELSE GREATEST(make_date($3::int, 1, 1)::timestamptz, MIN(h.changed_at))
              END AS chain_since
         FROM roster r
         LEFT JOIN evaluator_assignment_history h
           ON h.employee_id::text = r.evaluatee_id
          AND h.status = 'applied' AND h.change_type <> 'cancel'
          AND h.new_evaluator_id::text IN (SELECT id FROM chain_members)
          AND ($3::int IS NULL OR h.changed_at < make_date($3::int + 1, 1, 1)::timestamptz)
        GROUP BY r.evaluatee_id`,
      [target, periodId, year],
    );
    res.json(rows);
  } catch (err) {
    console.error('로스터 산입일 조회 실패:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get employees who used to be assigned to an evaluator, or have entries owned by that evaluator.
app.get('/api/employees/former-evaluator/:evaluatorId', async (req, res) => {
  // 과거 평가자 화면에 노출되는 조건:
  //   1) 현재 마스터 평가자(employees.evaluator_id)가 이 사용자가 아니어야 함.
  //   2) evaluator_assignment_history 에서 이 사용자가 new_evaluator 였던 applied non-cancel 행이 있고,
  //   3) 그 행 이후 다른 평가자로 변경된 applied non-cancel 행이 존재해야 함.
  //   (cancelled 행만 가진 평가자는 자동으로 제외되어, 정정으로 사라진 평가자
  //    이력은 노출되지 않는다.)
  if (!isDbAvailable) {
    return res.json([]);
  }

  try {
    // periodId 지정 시 해당 평가기간 내 이동(이전 담당)만 — 직전연도 이력이 2026 화면에 섞이지 않게.
    const periodId =
      typeof req.query.periodId === 'string' && req.query.periodId.trim()
        ? req.query.periodId.trim()
        : null;
    // 기간 판정은 changed_at 연도로 한다(evaluation_period_id 태그가 발령 업로드에서
    // 직전연도 발령을 당해 기간으로 잘못 적재한 케이스가 있어 신뢰 불가). $2 없으면 전 기간.
    const { rows } = await pool.query(
      `
        SELECT DISTINCT e.*
        FROM employees e
        LEFT JOIN evaluation_periods p ON p.id::text = $2::text
        WHERE e.evaluator_id IS DISTINCT FROM $1
          AND (
            EXISTS (
              SELECT 1
              FROM evaluator_assignment_history h
              WHERE h.employee_id = e.employee_id
                AND h.new_evaluator_id = $1
                AND h.status = 'applied'
                AND h.change_type <> 'cancel'
                AND ($2::text IS NULL OR EXTRACT(YEAR FROM h.changed_at) = p.evaluation_year)
                AND EXISTS (
                  SELECT 1
                  FROM evaluator_assignment_history later
                  WHERE later.employee_id = e.employee_id
                    AND later.status = 'applied'
                    AND later.change_type <> 'cancel'
                    AND ($2::text IS NULL OR EXTRACT(YEAR FROM later.changed_at) = p.evaluation_year)
                    AND (later.changed_at, later.id::text) > (h.changed_at, h.id::text)
                    AND later.new_evaluator_id IS DISTINCT FROM $1
                )
            )
            -- 근본 차단: 이동으로 마스터 포인터(employees.evaluator_id)가 옮겨가도, '그 기간 평가'에
            -- 이 평가자의 active 엔트리가 남아 있으면 과거 담당으로 노출한다. (엔드포인트 주석의
            -- "or have entries owned by that evaluator" 를 실제로 구현 — 이동 이력 누락/단일배정 케이스에서
            -- 과거 평가자가 자기 평가를 못 보던 문제 해결.)
            OR EXISTS (
              SELECT 1
              FROM task_evaluation_entries tee
              JOIN evaluations ev ON ev.id = tee.evaluation_id
              WHERE ev.evaluatee_id = e.employee_id
                AND tee.evaluator_id = $1
                AND COALESCE(tee.status, 'active') = 'active'
                AND COALESCE(ev.record_status, 'active') = 'active'
                AND ($2::text IS NULL OR ev.evaluation_period_id::text = $2::text)
            )
          )
        ORDER BY e.department, e.name
      `,
      [req.params.evaluatorId, periodId]
    );
    res.json(stripAuthFields(rows));
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
    res.json(stripAuthFields(rows));
  } catch (err) {
    console.error('Error fetching employees by department:', err);
    res.json(getMockEmployeesByDepartment(req.params.dept));
  }
});

app.get('/api/matching-imports', requireHr, async (req, res) => {
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

app.get('/api/matching-imports/latest-rows', requireHr, async (req, res) => {
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

app.get('/api/employee-profile-imports', requireHr, async (req, res) => {
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

app.get('/api/employee-profile-imports/latest-rows', requireHr, async (req, res) => {
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

app.post('/api/employee-profile-imports', requireHr, async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }

  const sourceFileName = normalizeOptionalText(req.body?.source_file_name ?? req.body?.sourceFileName);
  const evaluationPeriodId = normalizeOptionalText(
    req.body?.evaluation_period_id ?? req.body?.evaluationPeriodId,
  );
  const requestedImportedBy = req.session.employeeId;
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
              WHEN employees.position IS NULL OR employees.position IN ('평가자', '미등록', '') THEN COALESCE(EXCLUDED.position, employees.position)
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
            position = COALESCE(NULLIF(EXCLUDED.position, ''), employees.position),
            department = COALESCE(NULLIF(EXCLUDED.department, '미지정'), employees.department),
            department_id = COALESCE(EXCLUDED.department_id, employees.department_id),
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
            org_corporation = COALESCE(EXCLUDED.org_corporation, employees.org_corporation),
            org_division = COALESCE(EXCLUDED.org_division, employees.org_division),
            org_department = COALESCE(EXCLUDED.org_department, employees.org_department),
            org_team = COALESCE(EXCLUDED.org_team, employees.org_team),
            updated_at = NOW()
        `,
        [
          row.employee_id,
          row.employee_name,
          row.position ?? '',
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
          } else {
            // 기존 평가가 있으면 그 평가기간의 성장레벨 스냅샷을 현재 업로드 값으로 갱신한다.
            // (성장레벨은 평가기간마다 다를 수 있으므로, 대상자 재업로드 시 그 기간 평가에 반영.)
            await client.query(
              `UPDATE evaluations SET growth_level = $2, updated_at = NOW()
                WHERE id = $1 AND growth_level IS DISTINCT FROM $2`,
              [evaluationId, emp.growth_level ?? 0]
            );
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

  // 발령을 연도별로 정확히 귀속한다(연도 혼재 파일이 직전연도 발령을 당해 기간 이력으로
  // 잘못 적재해 '이전 담당'에 노출되던 문제 방지):
  //  - allStages : 원본(이전평가자 carry-forward 링크 계산용)
  //  - carryStages: 이 기간까지(<= periodYear) — '현재 평가자'(기간 시작 시점 담당) 계산용
  //  - stages     : 이 기간 연도(=== periodYear)에 발효된 발령만 — 이 기간의 평가/이력 생성용
  const stageYearOf = (s) => (s?.startDate ? Number(String(s.startDate).slice(0, 4)) : NaN);
  const allStages = stages;
  const carryStages = Number.isFinite(periodYear)
    ? allStages.filter((s) => {
        const y = stageYearOf(s);
        return !Number.isFinite(y) || y <= periodYear;
      })
    : allStages;
  if (Number.isFinite(periodYear)) {
    stages = allStages.filter((s) => {
      const y = stageYearOf(s);
      return !Number.isFinite(y) || y === periodYear;
    });
  }
  // 당해 연도 발령이 없는 사람도 이 기간 평가가 있어야 한다(직전연도 담당 이월).
  // 당해 발령이 없으면 이월 담당으로 기간 시작 시점 단계 1건을 시드한다 — carry-only
  // 인원이 2026 평가에서 누락되지 않게(빈 draft 삭제 후 신규 미생성 회귀 방지).
  if (Number.isFinite(periodYear) && stages.length === 0) {
    const carry = carryStages.filter((s) => s.evaluatorId).slice(-1)[0];
    if (carry?.evaluatorId) {
      stages = [{ startDate: `${periodYear}-01-01`, evaluatorId: carry.evaluatorId }];
    }
  }

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
        AND COALESCE(evaluation_period_id::text,'') = COALESCE($2::text,'')
      ORDER BY changed_at ASC, id ASC`,
    [employeeId, periodId ?? null]
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
    // 이전 평가자 링크는 carry-forward 포함(직전연도 마지막 평가자까지) — 당해 연도 첫
    // 발령의 '이전 평가자'가 직전연도 담당으로 올바르게 이어지게 한다.
    const prevStage =
      allStages.filter((s) => s.evaluatorId && s.startDate < fs.startDate).slice(-1)[0] ?? null;
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

  // 현재 평가자 = 이 평가기간까지(로드된) 발령 중 마지막 단계의 평가자.
  // 파일에 미래 연도 발령이 있어도 그 기간이 로드되기 전엔 현재 평가자로 삼지 않는다
  // (그래야 이 기간 실제 담당 평가자 보드에 피평가자가 보인다). prev 링크 일관화.
  // 현재 평가자는 이 기간까지(carry-forward) 발령 중 마지막 — 당해 연도 발령이 없으면
  // 직전연도 담당이 그대로 이어진다(현재평가자가 null 로 끊기지 않게).
  const orderedStages = carryStages.filter((s) => s.evaluatorId);
  const lastStage = orderedStages.length ? orderedStages[orderedStages.length - 1] : null;
  await client.query(`UPDATE employees SET evaluator_id=$2, updated_at=NOW() WHERE employee_id=$1`, [
    employeeId,
    lastStage?.evaluatorId ?? null,
  ]);
  await reconcilePreviousEvaluatorIds(client, employeeId);

  return result;
};

app.post('/api/matching-imports', requireHr, async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }

  const sourceFileName = normalizeOptionalText(req.body?.source_file_name ?? req.body?.sourceFileName);
  const sourceSheetName = normalizeOptionalText(req.body?.source_sheet_name ?? req.body?.sourceSheetName);
  const evaluationPeriodId = normalizeOptionalText(
    req.body?.evaluation_period_id ?? req.body?.evaluationPeriodId,
  );
  const requestedImportedBy = req.session.employeeId;
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
            department_id = COALESCE(EXCLUDED.department_id, employees.department_id),
            department = COALESCE(NULLIF(EXCLUDED.department, '미지정'), employees.department),
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
            org_corporation = COALESCE(EXCLUDED.org_corporation, employees.org_corporation),
            org_division = COALESCE(EXCLUDED.org_division, employees.org_division),
            org_department = COALESCE(EXCLUDED.org_department, employees.org_department),
            org_team = COALESCE(EXCLUDED.org_team, employees.org_team),
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
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

// 매칭 업로드 변경 미리보기(dry-run): reconcile 규칙으로 분류만 하고 DB 는 건드리지 않는다.
app.post('/api/matching-imports/preview', requireHr, async (req, res) => {
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
app.put('/api/employee/:id', requireHr, async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }

  const updates = req.body ?? {};
  const updateEntries = Object.entries(updates).filter(([key]) => EMPLOYEE_UPDATE_FIELDS.has(key));

  if (updateEntries.length === 0) {
    return res.status(400).json({ error: 'No supported employee fields were provided' });
  }

  // 로직(P1): 본인을 본인의 평가자로 지정 불가(다른 라우트와 동일 규칙 — 자기평가 차단).
  if (
    Object.prototype.hasOwnProperty.call(updates, 'evaluator_id') &&
    updates.evaluator_id != null &&
    String(updates.evaluator_id) === String(req.params.id)
  ) {
    return res.status(400).json({ error: '본인을 평가자로 지정할 수 없습니다.' });
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

    // 감사로그: 바뀐 화이트리스트 필드만 old→new. 평가자 변경이면 별도 action_type.
    const employeeAuditKeys = updateEntries
      .map(([k]) => k)
      .filter((k) => JSON.stringify(existingEmployee?.[k] ?? null) !== JSON.stringify(updatedEmployee?.[k] ?? null));
    if (employeeAuditKeys.length > 0) {
      const previousValue = {};
      const newValue = {};
      for (const k of employeeAuditKeys) {
        previousValue[k] = existingEmployee?.[k] ?? null;
        newValue[k] = updatedEmployee?.[k] ?? null;
      }
      await insertAdminAuditLog(client, {
        actionType: evaluatorChanged ? 'evaluator_change' : 'employee_update',
        actorId: req.session.employeeId,
        targetEmployeeId: req.params.id,
        previousValue,
        newValue,
        reason: `직원정보 변경(${employeeAuditKeys.join(', ')})`,
      });
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

    // 발령 취소 후 employees.evaluator_id 를 '최신 applied 비취소 이력'의 평가자로 항상 재동기화한다.
    // (가드 없이 불변식 강제: 마스터 평가자 = 최신 applied 발령. 같은 날짜 반복 변경 등으로 이력이
    //  엉켜도 self-heal. 이 시점엔 취소 행이 이미 status='cancelled' 라 제외되고 id <> $2 로 한 번 더 방어.
    //  previous_evaluator_id 만 믿으면 그 평가자도 이미 cancelled 됐을 때 mismatch — 실제 최신 행에서 도출.)
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
          AND evaluator_id IS DISTINCT FROM $2
        RETURNING *
      `,
      [history.employee_id, nextEvaluatorId]
    );
    const updatedEmployee = employeeRows[0] ?? null;

    let cancelledEntryCount = 0;
    let reverseTransferResult = null;
    if (history.supersedes_history_id) {
      // 보정 취소: 정정 시점에 X→Y 로 옮겨진 entries 를 다시 X 쪽으로 되돌린다.
      if (history.new_evaluator_id && history.previous_evaluator_id) {
        // 버그수정: 그 평가(evaluation_id)로 한정. evaluatee 전체 이전은 타 기간 entry까지
        // 무차별 이동시킴(정방향 정정은 이미 Scoped 사용 — 역방향도 일치시켜 일관성 확보).
        reverseTransferResult = await transferEvaluatorEntriesForCorrectionScoped(client, {
          evaluationId: history.evaluation_id ?? null,
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
            -- 버그수정: 이 변경(이력행/그 평가)에 속한 entry만 취소. 과거 'assignment_history_id IS NULL'
            -- 광역 매칭은 같은 직원의 '다른 평가기간' entry까지 잡아 2025 점수를 취소시켰음.
            AND (
              tee.assignment_history_id = $1
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
            -- 버그수정: 되돌리는 그 평가로 한정(다른 기간 피드백 광역 취소 방지).
            AND ev.id = $7::uuid
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
          history.evaluation_id ?? null,
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

app.post('/api/evaluator-assignment-history/:id/cancel', requireHr, async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 감사로그용: 취소 전 현재 평가자 + 취소 대상 이력의 prev/new 캡처.
    const { rows: cancelBeforeRows } = await client.query(
      `SELECT e.evaluator_id, h.employee_id, h.previous_evaluator_id, h.new_evaluator_id
         FROM evaluator_assignment_history h
         JOIN employees e ON e.employee_id = h.employee_id
        WHERE h.id = $1`,
      [req.params.id]
    );
    const cancelBefore = cancelBeforeRows[0] ?? null;
    const result = await cancelEvaluatorAssignmentHistoryRow(client, {
      historyId: req.params.id,
      actorId: req.session.employeeId,
      reason: getAssignmentCancellationReason(req.body),
    });
    // 감사로그: 발령 변경 취소(되돌리기) — 평가자 복원 결과 old→new 기록.
    if (cancelBefore) {
      await insertAdminAuditLog(client, {
        actionType: 'evaluator_assignment_cancel',
        actorId: req.session.employeeId,
        targetEmployeeId: cancelBefore.employee_id,
        previousValue: { evaluator_id: cancelBefore.evaluator_id ?? null },
        newValue: { evaluator_id: result.employee?.evaluator_id ?? cancelBefore.evaluator_id ?? null },
        reason: `평가자 배정 변경 취소(되돌리기) · 취소이력 ${req.params.id} (${cancelBefore.previous_evaluator_id ?? '없음'}→${cancelBefore.new_evaluator_id ?? '없음'}) · 취소된 채점 ${result.cancelled_entries ?? 0}건`,
      });
    }
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
app.post('/api/evaluator-assignment-history/:id/correct', requireHr, async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }

  const newEvaluatorId = normalizeOptionalText(
    req.body?.new_evaluator_id ?? req.body?.newEvaluatorId
  );
  const actorId = req.session.employeeId;
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
// (구 assertHrActor 제거 — 권한은 requireHr 미들웨어가 세션 신원으로만 검사한다.
//  body의 actor_id 자기신고와 'admin' 문자열 무조건 통과 우회는 폐기됨.)

// 대상자 일괄삭제: admin 외 모든 employees + 그들에 딸린 모든 평가·과업·이력·임포트 데이터 제거.
// 평가기간(evaluation_periods)·시스템 설정(settings, prompt_templates)은 유지.
app.post('/api/admin/reset/employees', requireHr, async (req, res) => {
  if (!isDbAvailable) return sendDbUnavailable(res);
  const actorId = req.session.employeeId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 감사 추적: 삭제 전에 같은 트랜잭션으로 기록. actor FK는 직원 삭제 시 SET NULL 되므로
    // reason 텍스트에 actor 를 함께 남긴다. (admin_audit_logs 는 더 이상 TRUNCATE 대상이 아님)
    await client.query(
      `INSERT INTO admin_audit_logs (action_type, actor_id, reason) VALUES ('reset_employees', $1, $2)`,
      [actorId, `대상자 일괄삭제 실행 (actor: ${actorId})`]
    );
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
        employee_profile_import_rows,
        matching_import_rows,
        ai_generated_content,
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
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

// 매칭정보 일괄삭제: employees 는 유지하되, 매칭 임포트로 들어온 정보(평가자 배정·
// 평가건·과업·평가 entries·피드백·이력·매칭 임포트 배치·관련 알림)를 모두 비운다.
// 평가대상자 프로필 정보(name, position, department, growth_level, available_roles 등)는 보존.
app.post('/api/admin/reset/matching', requireHr, async (req, res) => {
  if (!isDbAvailable) return sendDbUnavailable(res);
  const actorId = req.session.employeeId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 감사 추적: 실행 전에 같은 트랜잭션으로 기록.
    await client.query(
      `INSERT INTO admin_audit_logs (action_type, actor_id, reason) VALUES ('reset_matching', $1, $2)`,
      [actorId, `매칭정보 일괄삭제 실행 (actor: ${actorId})`]
    );
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
        ai_generated_content,
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
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

// 평가기간별 초기화: 선택한 평가기간(evaluation_period_id)에 묶인 데이터만 비운다.
// 삭제 대상: 그 기간의 평가·과업·평가엔트리·피드백·최종평가·알림·평가자배정이력·
//            평가자변경요청·매칭/대상자 임포트(배치+행)·조직정보(org_structure).
// 보존: 직원 명부(employees)·다른 평가기간·평가기간 설정·시스템 설정·감사로그.
// (직원은 기간 공유 자원이라 유지한다. 직원까지 지우려면 '대상자 일괄삭제'를 쓴다.)
app.post('/api/admin/reset/period', requireHr, async (req, res) => {
  if (!isDbAvailable) return sendDbUnavailable(res);
  const actorId = req.session.employeeId;
  const periodId = String(req.body?.evaluation_period_id ?? '').trim();
  if (!periodId) return res.status(400).json({ error: 'evaluation_period_id 가 필요합니다.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: periodRows } = await client.query(
      'SELECT code FROM evaluation_periods WHERE id = $1',
      [periodId]
    );
    if (periodRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '평가기간을 찾을 수 없습니다.' });
    }
    const periodCode = periodRows[0].code;
    // 감사 추적: 실행 전에 같은 트랜잭션으로 기록.
    await client.query(
      `INSERT INTO admin_audit_logs (action_type, actor_id, reason) VALUES ('reset_period', $1, $2)`,
      [actorId, `평가기간 초기화: ${periodCode} (actor: ${actorId})`]
    );
    const inPeriodEvals = '(SELECT id FROM evaluations WHERE evaluation_period_id = $1)';
    // 0) AI 생성물(성장제안·요약·키워드) — scope_id 가 FK 가 아니라 cascade 로 안 지워진다. 이 기간 것만 정리.
    //    과업 성장제안(scope=과업 uuid)은 과업 삭제 '전에' 매칭해 지운다.
    await client.query(
      `DELETE FROM ai_generated_content
        WHERE kind = 'task_growth_suggestion'
          AND scope_id IN (SELECT t.id::text FROM tasks t WHERE t.evaluation_period_id = $1)`,
      [periodId]
    );
    //    나머지(피평가자/평가자 요약·성장·키워드)는 scope 가 '…:<periodId>' 로 끝난다.
    await client.query(`DELETE FROM ai_generated_content WHERE scope_id LIKE '%:' || $1`, [periodId]);
    // 1) 평가/과업의 자식부터 (FK 역순)
    await client.query(`DELETE FROM feedback_history WHERE evaluation_id IN ${inPeriodEvals}`, [periodId]);
    await client.query(`DELETE FROM task_evaluation_entries WHERE evaluation_id IN ${inPeriodEvals}`, [periodId]);
    await client.query(`DELETE FROM final_assessment WHERE evaluation_id IN ${inPeriodEvals}`, [periodId]);
    await client.query(`DELETE FROM notifications WHERE related_evaluation_id IN ${inPeriodEvals}`, [periodId]);
    await client.query('DELETE FROM tasks WHERE evaluation_period_id = $1', [periodId]);
    // 2) 배정이력 — 평가의 참조를 먼저 끊고 삭제
    await client.query('UPDATE evaluations SET assignment_history_id = NULL WHERE evaluation_period_id = $1', [periodId]);
    await client.query('DELETE FROM evaluator_assignment_history WHERE evaluation_period_id = $1', [periodId]);
    // 3) 평가 본체 + 변경요청
    const evalDel = await client.query('DELETE FROM evaluations WHERE evaluation_period_id = $1', [periodId]);
    await client.query('DELETE FROM evaluator_change_requests WHERE evaluation_period_id = $1', [periodId]);
    // 4) 임포트 — employees의 배치 참조를 끊고 행→배치 순으로 삭제
    await client.query(
      'UPDATE employees SET last_matching_batch_id = NULL WHERE last_matching_batch_id IN (SELECT id FROM matching_import_batches WHERE evaluation_period_id = $1)',
      [periodId]
    );
    await client.query(
      'UPDATE employees SET last_profile_batch_id = NULL WHERE last_profile_batch_id IN (SELECT id FROM employee_profile_import_batches WHERE evaluation_period_id = $1)',
      [periodId]
    );
    await client.query('DELETE FROM matching_import_rows WHERE batch_id IN (SELECT id FROM matching_import_batches WHERE evaluation_period_id = $1)', [periodId]);
    await client.query('DELETE FROM employee_profile_import_rows WHERE batch_id IN (SELECT id FROM employee_profile_import_batches WHERE evaluation_period_id = $1)', [periodId]);
    await client.query('DELETE FROM matching_import_batches WHERE evaluation_period_id = $1', [periodId]);
    await client.query('DELETE FROM employee_profile_import_batches WHERE evaluation_period_id = $1', [periodId]);
    // 5) 그 기간의 조직정보
    await client.query('DELETE FROM org_structure WHERE evaluation_period_id = $1', [periodId]);
    await client.query('COMMIT');
    res.json({
      ok: true,
      period_code: periodCode,
      deleted_evaluations: evalDel.rowCount,
      message: `'${periodCode}' 평가기간의 평가·과업·매칭·조직정보를 삭제했습니다. 직원 명부는 유지됩니다.`,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error in reset/period:', err);
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

// Get evaluation by employee ID (latest)
app.get('/api/evaluations/by-employee/:employeeId', guardEmployeeEvaluationsParam('employeeId', { allowLineDescendant: true }), async (req, res) => {
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
          latest_ah.changed_at DESC NULLS LAST,
          ev.created_at DESC`;
    const { rows } = await pool.query(
      `
        SELECT
          ev.*,
          COALESCE(latest_ah.new_evaluator_id, emp.evaluator_id) AS evaluator_id,
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
        LEFT JOIN employees ev_emp ON ev_emp.employee_id = COALESCE(latest_ah.new_evaluator_id, emp.evaluator_id)
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

// ── 비밀번호 초기화: HR 조회/승인/반려 + HR 직접 초기화 ──
// 승인·직접초기화는 동일 효과: employees.password_hash = NULL, must_change_password = TRUE
// → 해당 직원은 사번(초기 비밀번호)으로 로그인 후 변경을 강제받는다.

// 초기화 요청 목록 (기본 pending, ?status=all 이면 전체 최근순).
app.get('/api/admin/password-reset-requests', requireHr, async (req, res) => {
  if (!isDbAvailable) return sendDbUnavailable(res);
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
    const where = status === 'all' ? '' : 'WHERE status = $1';
    const params = status === 'all' ? [] : [status];
    const { rows } = await pool.query(
      `SELECT id, employee_id, employee_name, status, reason,
              resolved_by, resolved_at, review_comment, created_at
         FROM password_reset_requests
         ${where}
         ORDER BY created_at DESC
         LIMIT 200`,
      params,
    );
    res.json(rows);
  } catch (err) {
    console.error('비밀번호 초기화 요청 목록 조회 실패:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// 사이드바 배지 카운트 — 역할별 '지금 액션이 필요한 건수'를 요청 1회로 반환.
//   피평가자: 선택 기간 내 본인 평가 중 성과보고 미제출(제출 전 상태) 건수
//   평가자:   본인 담당(현 배정 기준) 평가 중 검토 필요(submitted·evaluating) 건수
//   HR:       변경요청·비밀번호 초기화 대기 건수 (HR 역할일 때만 계산)
// 발령 취소 등 record_status 특수 케이스는 보드의 정밀 분류와 미세하게 다를 수 있는 근사치(배지 용도).
app.get('/api/badge-counts', async (req, res) => {
  if (!isDbAvailable) return res.json({});
  if (!req.session?.employeeId) return res.status(401).json({ error: '로그인이 필요합니다.' });
  const me = String(req.session.employeeId);
  const periodId = typeof req.query.periodId === 'string' && req.query.periodId ? req.query.periodId : null;
  try {
    const out = { myPendingSubmit: 0, reviewNeeded: 0, pendingChangeRequests: 0, pendingPasswordResets: 0 };
    if (periodId) {
      const mine = await pool.query(
        `SELECT COUNT(*)::int AS c
           FROM evaluations ev
          WHERE ev.evaluatee_id::text = $1 AND ev.evaluation_period_id = $2
            AND COALESCE(ev.record_status, 'active') = 'active'
            AND COALESCE(ev.evaluation_status, 'in-progress') NOT IN ('submitted','evaluating','completed','locked')`,
        [me, periodId],
      );
      out.myPendingSubmit = mine.rows[0]?.c ?? 0;
      const review = await pool.query(
        `SELECT COUNT(*)::int AS c
           FROM evaluations ev
           LEFT JOIN evaluator_assignment_history h ON h.id = ev.assignment_history_id
           LEFT JOIN employees e ON e.employee_id = ev.evaluatee_id
          WHERE ev.evaluation_period_id = $2
            AND COALESCE(ev.record_status, 'active') = 'active'
            AND COALESCE(h.new_evaluator_id::text, e.evaluator_id::text) = $1
            AND ev.evaluation_status IN ('submitted','evaluating')`,
        [me, periodId],
      );
      out.reviewNeeded = review.rows[0]?.c ?? 0;
    }
    if (await requesterIsHr(req)) {
      const cr = await pool.query(
        `SELECT COUNT(*)::int AS c FROM evaluator_change_requests WHERE status = 'pending'`,
      );
      out.pendingChangeRequests = cr.rows[0]?.c ?? 0;
      const pr = await pool.query(
        `SELECT COUNT(*)::int AS c FROM password_reset_requests WHERE status = 'pending'`,
      );
      out.pendingPasswordResets = pr.rows[0]?.c ?? 0;
    }
    res.json(out);
  } catch (err) {
    console.error('배지 카운트 조회 실패:', err.message);
    res.json({});
  }
});

// 요청 승인 → 해당 직원 비밀번호를 사번으로 초기화.
app.post('/api/admin/password-reset-requests/:id/approve', requireHr, async (req, res) => {
  if (!isDbAvailable) return sendDbUnavailable(res);
  const actorId = req.session.employeeId;
  const requestId = req.params.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM password_reset_requests WHERE id = $1 FOR UPDATE`,
      [requestId],
    );
    const request = rows[0];
    if (!request) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '요청을 찾을 수 없습니다.' });
    }
    if (request.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: '이미 처리된 요청입니다.' });
    }
    const { rowCount } = await client.query(
      `UPDATE employees SET password_hash = NULL, must_change_password = TRUE
        WHERE employee_id::text = $1`,
      [request.employee_id],
    );
    if (rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '대상 직원을 찾을 수 없습니다.' });
    }
    await client.query(
      `UPDATE password_reset_requests
          SET status = 'approved', resolved_by = $2, resolved_at = now(), updated_at = now()
        WHERE id = $1`,
      [requestId, actorId],
    );
    await insertAdminAuditLog(client, {
      actionType: 'password_reset_approved',
      actorId,
      targetEmployeeId: request.employee_id,
      reason: `비밀번호 초기화 요청 승인 (요청 ${requestId})`,
    });
    await client.query('COMMIT');
    res.json({ ok: true, employee_id: request.employee_id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('비밀번호 초기화 승인 실패:', err.message);
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

// 요청 반려.
app.post('/api/admin/password-reset-requests/:id/reject', requireHr, async (req, res) => {
  if (!isDbAvailable) return sendDbUnavailable(res);
  const actorId = req.session.employeeId;
  const requestId = req.params.id;
  const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : '';
  try {
    const { rowCount } = await pool.query(
      `UPDATE password_reset_requests
          SET status = 'rejected', resolved_by = $2, resolved_at = now(),
              review_comment = NULLIF($3, ''), updated_at = now()
        WHERE id = $1 AND status = 'pending'`,
      [requestId, actorId, comment],
    );
    if (rowCount === 0) {
      return res.status(409).json({ error: '대기 중인 요청이 아닙니다.' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('비밀번호 초기화 반려 실패:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// HR 직접 초기화 (요청행 없이 즉시) — 사용자관리 등에서 대상 직원 지정.
app.post('/api/admin/password-reset/:employeeId', requireHr, async (req, res) => {
  if (!isDbAvailable) return sendDbUnavailable(res);
  const actorId = req.session.employeeId;
  const targetId = req.params.employeeId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      `UPDATE employees SET password_hash = NULL, must_change_password = TRUE
        WHERE employee_id::text = $1`,
      [targetId],
    );
    if (rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '대상 직원을 찾을 수 없습니다.' });
    }
    // 대기 중인 같은 직원의 요청이 있으면 함께 승인 처리(정합).
    await client.query(
      `UPDATE password_reset_requests
          SET status = 'approved', resolved_by = $2, resolved_at = now(), updated_at = now()
        WHERE employee_id = $1 AND status = 'pending'`,
      [targetId, actorId],
    );
    await insertAdminAuditLog(client, {
      actionType: 'password_reset_direct',
      actorId,
      targetEmployeeId: targetId,
      reason: `HR 직접 비밀번호 초기화 (actor: ${actorId})`,
    });
    await client.query('COMMIT');
    res.json({ ok: true, employee_id: targetId });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('HR 직접 비밀번호 초기화 실패:', err.message);
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

// ── 조직정보 업로드: 부서코드 → 4단계 조직(법인/본부/부/팀) 파생 + employees.org_* 자동 매칭 ──
// 클라이언트가 조직구조 엑셀(T-Level 트리)을 파싱해 rows[{code,name,level,kind}] 로 보낸다.
// 서버는 트리(레벨 스택)로 상위조직을 복원하고 org_structure 보존 + employees.org_*(department_id 매칭) 갱신.
const ORG_CORP_ABBR = {
  '(주)오케이벤처스': 'OKV', '(주)엑스인하우징': 'EX', '오케이홀딩스대부(주)': 'OKH', '(주)오케이저축은행': 'OK',
  '오케이캐피탈': 'OC', '아프로신용정보(주)': 'ACI', '아프로에프앤아이대부(주)': 'AFI', '예스자산대부(주)': 'YA',
  '오케이에이엑스(주)': 'OKAX', '(주)오케이인베스트먼트파트너스': 'OKIP',
  // 스냅샷별 이름 변형(동일 법인) + 신규 법인
  '오케이에프앤아이대부(주)': 'AFI', '오케이신용정보': 'ACI', '오케이데이터시스템(주)': 'OKAX',
  '오케이넥스트(주)': 'ON', '오케이네트웍스(주)': 'OT',
};
const orgCorpKey = (name) => String(name || '').replace(/\s+/g, '').trim();
function deriveOrgFromRows(rows) {
  const map = new Map();
  const stack = [];
  const unmatchedCorps = new Set();
  for (const r of rows) {
    const code = String(r.code ?? '').trim();
    const name = String(r.name ?? '').trim();
    const level = Number(r.level);
    const kind = String(r.kind ?? '').trim();
    if (!code || !Number.isFinite(level)) continue;
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const chain = [...stack, { name, level, kind }];
    const corpNode = chain.find((c) => c.level === 2);
    const last = (k) => { for (let i = chain.length - 1; i >= 0; i -= 1) if (chain[i].kind === k) return chain[i].name; return ''; };
    let corp = '';
    if (corpNode) {
      const key = orgCorpKey(corpNode.name);
      corp = ORG_CORP_ABBR[key] || corpNode.name;
      if (!ORG_CORP_ABBR[key]) unmatchedCorps.add(corpNode.name);
    }
    const team = kind === '팀' || kind === '지점' ? name : last('팀') || last('지점');
    map.set(code, { code, name, corp, div: last('본부'), dept: last('부'), team, level, kind });
    stack.push({ name, level, kind, code });
  }
  return { map, unmatchedCorps: [...unmatchedCorps] };
}

app.post('/api/admin/org-structure', requireHr, async (req, res) => {
  if (!isDbAvailable) return sendDbUnavailable(res);
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  const sourceLabel = typeof req.body?.sourceLabel === 'string' ? req.body.sourceLabel.slice(0, 200) : null;
  const periodId = typeof req.body?.periodId === 'string' && req.body.periodId.trim() ? req.body.periodId.trim() : null;
  if (!rows || rows.length === 0) return res.status(400).json({ error: 'rows 가 필요합니다.' });
  if (!periodId) return res.status(400).json({ error: '평가기간(periodId)이 필요합니다.' });
  const client = await pool.connect();
  try {
    const period = (await client.query(`SELECT id, name, is_default FROM evaluation_periods WHERE id = $1`, [periodId])).rows[0];
    if (!period) { client.release(); return res.status(400).json({ error: '존재하지 않는 평가기간입니다.' }); }
    const { map, unmatchedCorps } = deriveOrgFromRows(rows);
    if (map.size === 0) { client.release(); return res.status(400).json({ error: '유효한 조직 노드를 찾지 못했습니다(부서코드·T-Level 확인).' }); }
    await client.query('BEGIN');
    // 이 기간의 기존 스냅샷 교체(파일 = 그 기간 조직구조의 원천)
    await client.query(`DELETE FROM org_structure WHERE evaluation_period_id = $1`, [periodId]);
    for (const o of map.values()) {
      await client.query(
        `INSERT INTO org_structure (dept_code, evaluation_period_id, dept_name, org_corporation, org_division, org_department, org_team, t_level, kind, source_label, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())`,
        [o.code, periodId, o.name || null, o.corp || null, o.div || null, o.dept || null, o.team || null, o.level, o.kind || null, sourceLabel],
      );
    }
    // 활성(기본) 평가기간을 올릴 때만 현재 employees.org_* 갱신(과거 기간 스냅샷은 보존만).
    let employeesUpdated = 0;
    if (period.is_default) {
      const upd = await client.query(
        `UPDATE employees e SET org_corporation=s.org_corporation, org_division=s.org_division,
                org_department=s.org_department, org_team=s.org_team
           FROM org_structure s
          WHERE s.evaluation_period_id = $1 AND e.department_id = s.dept_code AND e.employee_id <> 'admin'`,
        [periodId],
      );
      employeesUpdated = upd.rowCount;
    }
    await client.query('COMMIT');
    res.json({
      period_id: periodId,
      period_name: period.name,
      is_default_period: period.is_default,
      node_count: map.size,
      employees_updated: employeesUpdated,
      unmatched_corps: unmatchedCorps,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('조직정보 업로드 실패:', err.message);
    res.status(500).json({ error: 'Database error', detail: err.message });
  } finally {
    client.release();
  }
});

// 특정 평가기간의 조직정보 스냅샷 행 — 이력 화면에서 다운로드용.
app.get('/api/admin/org-structure/rows', requireHr, async (req, res) => {
  if (!isDbAvailable) return res.json([]);
  const periodId = typeof req.query.periodId === 'string' && req.query.periodId.trim() ? req.query.periodId.trim() : null;
  try {
    const { rows } = await pool.query(
      `
        SELECT dept_code, dept_name, org_corporation, org_division, org_department, org_team, t_level, kind
        FROM org_structure
        WHERE ($1::uuid IS NULL AND evaluation_period_id IS NULL) OR evaluation_period_id = $1
        ORDER BY t_level NULLS LAST, dept_code
      `,
      [periodId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching org-structure rows:', err);
    res.json([]);
  }
});

// 조직정보 업로드 이력 — 평가기간별 스냅샷(업로드 일자·부서수·법인수). org_structure 집계.
app.get('/api/admin/org-structure/imports', requireHr, async (req, res) => {
  if (!isDbAvailable) return res.json([]);
  try {
    const { rows } = await pool.query(
      `
        SELECT s.evaluation_period_id,
               p.name AS period_name,
               p.evaluation_year,
               s.source_label,
               count(*)::int AS node_count,
               count(DISTINCT s.org_corporation) FILTER (WHERE s.org_corporation IS NOT NULL)::int AS corp_count,
               max(s.updated_at) AS uploaded_at
        FROM org_structure s
        LEFT JOIN evaluation_periods p ON p.id = s.evaluation_period_id
        GROUP BY s.evaluation_period_id, p.name, p.evaluation_year, s.source_label
        ORDER BY max(s.updated_at) DESC
      `
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching org-structure imports:', err);
    res.json([]);
  }
});

// ── 기여도 평가 업로드: 그 기간 평가에 과업·점수 적재 + 부서코드→기간 org 매핑 (미리보기/적용) ──
// 클라가 기여도 엑셀(PL 제외)을 파싱해 rows[{sabun,so,evaluatorId,deptCode,title,weight,score,method,scope,description,remark}] 전송.
// (sabun,so) 그룹 → (sabun,period,evaluator)로 기존 평가 매칭 → 과업 교체 + 점수 + 기간 org.
// 평가가 없으면 건너뜀(대상자/매칭 업로드 선행 필요). 대상자·평가자 매칭은 이 엔드포인트가 만들지 않는다.
const CONTRIB_METHODS = new Set(['총괄', '리딩', '실무', '지원']);
const CONTRIB_SCOPES = new Set(['의존적', '독립적', '상호적', '전략적']);
const contribScope = (v) => { const s = String(v ?? '').replace(/\s+/g, '').replace(/기여$/, '').trim(); return CONTRIB_SCOPES.has(s) ? s : null; };
const contribMethod = (v) => { const m = String(v ?? '').trim(); return CONTRIB_METHODS.has(m) ? m : null; };
const contribScoreNorm = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 1 ? Math.round(n) : null; };
// 가중치는 정수 컬럼(tasks.weight). 소수(33.3 등)·범위초과 값을 그대로 넣으면 파라미터 INSERT가
// 'invalid input syntax for type integer'/'out of range'로 500. 반올림+클램프로 방어한다.
const contribWeight = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(0, Math.min(100000, n)) : 0; };
// 과업 수행기간(시작일/종료일): 'YYYYMMDD'/'YYYY-MM-DD'/ISO → 'YYYY-MM-DD'.
// 실제 유효한 날짜만 통과(엑셀에 25251231·20250229(비윤년)·99990909 같은 오타가 있어
// 느슨하게 두면 date 컬럼 INSERT가 실패→업로드 전체 500). 연도 2000~2100 + 월별 실제 일수 검증.
const contribDate = (v) => {
  const m = String(v ?? '').trim().match(/^(\d{4})[-/.]?(\d{2})[-/.]?(\d{2})/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1) return null;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (d > dim[mo - 1]) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
};
const contribSabun = (v) => String(v ?? '').replace(/^[A-Za-z]+/, '').trim();

function groupContribRows(rows) {
  const groups = new Map();
  for (const r of rows) {
    const sabun = contribSabun(r.sabun);
    if (!sabun) continue;
    const so = String(r.so ?? '1').trim() || '1';
    const key = sabun + '|' + so;
    if (!groups.has(key)) {
      groups.set(key, { sabun, so, evaluatorId: null, deptCode: null, tasks: [] });
    }
    const grp = groups.get(key);
    // 평가자ID·부서코드는 그룹 내 비어있지 않은 행 어디서든 채운다(소속2 첫 행이 비어도 누락 방지).
    if (!grp.evaluatorId && contribSabun(r.evaluatorId)) grp.evaluatorId = contribSabun(r.evaluatorId);
    if (!grp.deptCode && String(r.deptCode ?? '').trim()) grp.deptCode = String(r.deptCode).trim();
    grp.tasks.push({
      title: String(r.title ?? '').trim() || '(과업)',
      weight: contribWeight(r.weight),
      score: contribScoreNorm(r.score),
      method: contribMethod(r.method),
      scope: contribScope(r.scope),
      description: String(r.description ?? '').trim() || null,
      remark: String(r.remark ?? '').trim() || null,
      startDate: contribDate(r.startDate),
      endDate: contribDate(r.endDate),
    });
  }
  return groups;
}

// 그룹 → 기존 평가 매칭. (sabun,period,evaluator) 우선, evaluator 없으면 그 기간 단일 평가.
async function matchContribGroups(db, periodId, groups) {
  const evRows = (await db.query(
    `SELECT e.id, e.evaluatee_id, e.evaluatee_name, e.evaluation_year, e.evaluation_period_id, e.assignment_history_id,
            e.evaluatee_dept_code AS dept_code, h.new_evaluator_id AS evaluator_id, ev.name AS evaluator_name
       FROM evaluations e
       LEFT JOIN evaluator_assignment_history h ON h.id = e.assignment_history_id
       LEFT JOIN employees ev ON ev.employee_id = h.new_evaluator_id
      WHERE e.evaluation_period_id = $1`,
    [periodId],
  )).rows;
  const byEmp = new Map();
  for (const ev of evRows) { if (!byEmp.has(ev.evaluatee_id)) byEmp.set(ev.evaluatee_id, []); byEmp.get(ev.evaluatee_id).push(ev); }
  // 1:1 그리디 매칭 — 한 평가는 한 그룹에만(이동자 두 소속이 같은 평가로 몰리는 중복 방지).
  // pass1 평가자(가장 특정) → pass2 부서코드 → pass3 그 사람의 잔여 평가.
  const used = new Set();
  const result = new Map();
  const tryMatch = (g, pred) => {
    const evs = byEmp.get(g.sabun) || [];
    const ev = evs.find((x) => !used.has(x.id) && pred(x));
    if (ev) { used.add(ev.id); result.set(g, ev); return true; }
    return false;
  };
  const all = [...groups.values()];
  const p1 = all.filter((g) => !(g.evaluatorId && tryMatch(g, (x) => String(x.evaluator_id ?? '') === g.evaluatorId)));
  const p2 = p1.filter((g) => !(g.deptCode && tryMatch(g, (x) => String(x.dept_code ?? '') === g.deptCode)));
  const unmatched = p2.filter((g) => !tryMatch(g, () => true));
  const matches = [...result.entries()].map(([group, ev]) => ({ group, ev }));
  return { matches, unmatched };
}

async function resolveContribRequest(req) {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows || rows.length === 0) return { error: 'rows 가 필요합니다.' };
  let periodId = typeof req.body?.periodId === 'string' && req.body.periodId.trim() ? req.body.periodId.trim() : null;
  if (!periodId) {
    const def = await pool.query(`SELECT id FROM evaluation_periods WHERE is_default = true ORDER BY updated_at DESC LIMIT 1`);
    periodId = def.rows[0]?.id ?? null;
  }
  if (!periodId) return { error: '평가기간을 확인할 수 없습니다(periodId).' };
  const p = await pool.query(`SELECT id, name FROM evaluation_periods WHERE id = $1`, [periodId]);
  if (!p.rows[0]) return { error: '존재하지 않는 평가기간입니다.' };
  return { rows, periodId, periodName: p.rows[0].name };
}

app.post('/api/contribution-imports/preview', requireHr, async (req, res) => {
  if (!isDbAvailable) return sendDbUnavailable(res);
  try {
    const ctx = await resolveContribRequest(req);
    if (ctx.error) return res.status(400).json({ error: ctx.error });
    const groups = groupContribRows(ctx.rows);
    const { matches, unmatched } = await matchContribGroups(pool, ctx.periodId, groups);
    let tasksTotal = 0, scoredTotal = 0, orgMapped = 0;
    const deptCodes = new Set();
    for (const m of matches) {
      tasksTotal += m.group.tasks.length;
      scoredTotal += m.group.tasks.filter((t) => t.score != null).length;
      if (m.group.deptCode) deptCodes.add(m.group.deptCode);
    }
    if (deptCodes.size) {
      const known = (await pool.query(`SELECT dept_code FROM org_structure WHERE dept_code = ANY($1) AND evaluation_period_id = $2`, [[...deptCodes], ctx.periodId])).rows.map((r) => r.dept_code);
      const knownSet = new Set(known);
      for (const m of matches) if (m.group.deptCode && knownSet.has(m.group.deptCode)) orgMapped += 1;
    }
    res.json({
      period_id: ctx.periodId,
      period_name: ctx.periodName,
      total_groups: groups.size,
      matched_evaluations: matches.length,
      unmatched_count: unmatched.length,
      unmatched_sample: unmatched.slice(0, 10).map((g) => ({ sabun: g.sabun, so: g.so })),
      tasks_total: tasksTotal,
      scored_total: scoredTotal,
      org_mapped: orgMapped,
      org_unmapped: matches.length - orgMapped,
    });
  } catch (err) {
    console.error('기여도 미리보기 실패:', err.message);
    res.status(500).json({ error: 'Database error', detail: err.message });
  }
});

app.post('/api/contribution-imports', requireHr, async (req, res) => {
  if (!isDbAvailable) return sendDbUnavailable(res);
  const client = await pool.connect();
  try {
    const ctx = await resolveContribRequest(req);
    if (ctx.error) { client.release(); return res.status(400).json({ error: ctx.error }); }
    const groups = groupContribRows(ctx.rows);
    const { matches } = await matchContribGroups(client, ctx.periodId, groups);
    await client.query('BEGIN');
    let appliedEvals = 0, tasksInserted = 0, scored = 0, orgUpdated = 0;
    for (const { group, ev } of matches) {
      const evrName = ev.evaluator_name || ev.evaluator_id || '평가자'; // entries.evaluator_name NOT NULL 가드
      // 과업·엔트리·피드백 교체(그 평가 한정)
      await client.query(`DELETE FROM feedback_history WHERE evaluation_id = $1`, [ev.id]);
      await client.query(`DELETE FROM task_evaluation_entries WHERE evaluation_id = $1`, [ev.id]);
      await client.query(`DELETE FROM tasks WHERE evaluation_id = $1`, [ev.id]);
      // 기간 org (부서코드 → org_structure)
      if (group.deptCode) {
        const o = (await client.query(`SELECT org_corporation, org_division, org_department, org_team FROM org_structure WHERE dept_code = $1 AND evaluation_period_id = $2`, [group.deptCode, ctx.periodId])).rows[0];
        if (o) {
          const deptName = o.org_team || o.org_department || o.org_division || null;
          await client.query(
            `UPDATE evaluations SET evaluatee_dept_code=$2, evaluatee_org_corporation=$3, evaluatee_org_division=$4, evaluatee_org_department=$5, evaluatee_org_team=$6, evaluatee_department=COALESCE($7, evaluatee_department) WHERE id=$1`,
            [ev.id, group.deptCode, o.org_corporation, o.org_division, o.org_department, o.org_team, deptName],
          );
          orgUpdated += 1;
        }
      }
      for (const t of group.tasks) {
        const taskUuid = randomUUID();
        const taskId = randomUUID();
        // 'AI활용' 제목 과업은 AI 과업으로 자동 체크(업로드 엑셀엔 AI과업 플래그가 없어 제목으로 판별).
        const isAiTask = typeof t.title === 'string' && t.title.includes('AI활용');
        await client.query(
          `INSERT INTO tasks (id, task_id, evaluation_id, title, weight, description, contribution_method, contribution_scope, score, feedback, evaluator_name, evaluation_year, evaluation_period_id, start_date, end_date, is_ai_task, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, NOW())`,
          [taskUuid, taskId, ev.id, t.title, t.weight, t.description, t.method, t.scope, t.score, t.remark, evrName, ev.evaluation_year, ev.evaluation_period_id, t.startDate ?? null, t.endDate ?? null, isAiTask],
        );
        tasksInserted += 1;
        if (t.score != null) scored += 1;
        if (ev.evaluator_id) {
          const entryRes = await client.query(
            `INSERT INTO task_evaluation_entries (task_uuid, task_id, evaluation_id, evaluator_id, evaluator_name, contribution_method, contribution_scope, score, feedback, feedback_date, assignment_history_id, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10,'active')
             RETURNING id`,
            [taskUuid, taskId, ev.id, ev.evaluator_id, evrName, t.method, t.scope, t.score, t.remark, ev.assignment_history_id],
          );
          // 피드백 이력(feedback_history)에도 적재 — 피드백 이력/코멘트 화면이 이 테이블을 읽는다.
          // (엔트리에만 넣으면 평가자 화면엔 보여도 '피드백 이력'은 0건으로 비어 보인다.)
          const fbText = typeof t.remark === 'string' ? t.remark.trim() : '';
          if (fbText) {
            await client.query(
              `INSERT INTO feedback_history (id, task_id, content, evaluator_name, created_at, task_uuid, evaluation_id, evaluator_id, task_evaluation_entry_id, status)
               VALUES (gen_random_uuid(), $1, $2, $3, NOW(), $4, $5, $6, $7, 'active')`,
              [taskId, t.remark, evrName, taskUuid, ev.id, ev.evaluator_id, entryRes.rows[0].id],
            );
          }
        }
      }
      // 적재된 점수 충족도에 따라 평가 상태를 올린다.
      // 업로드는 HR이 최종 평가데이터를 일괄 주입하는 것이므로, 점수가 다 채워졌으면 '완료'로 마감한다.
      // (이게 없으면 draft 로 남아 평가자 보드·통계·AI검수에서 안 보이고 AI 생성도 안 됨.)
      const scoredCount = group.tasks.filter((t) => t.score != null).length;
      const nextStatus =
        group.tasks.length > 0 && scoredCount === group.tasks.length
          ? 'completed'
          : scoredCount > 0
            ? 'evaluating'
            : null;
      if (nextStatus) {
        await client.query(`UPDATE evaluations SET evaluation_status = $2 WHERE id = $1`, [ev.id, nextStatus]);
      }
      appliedEvals += 1;
    }
    await client.query('COMMIT');
    res.json({
      period_id: ctx.periodId,
      applied_evaluations: appliedEvals,
      tasks_inserted: tasksInserted,
      scored,
      org_updated: orgUpdated,
      skipped_groups: groups.size - matches.length,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('기여도 업로드 실패:', err.message);
    res.status(500).json({ error: 'Database error', detail: err.message });
  } finally {
    client.release();
  }
});

// 대시보드 N+1 완화: 한 기간의 '직원별 현재 평가' 1건씩을 한 번에 반환.
// 위 /by-employee/:id 의 선택 로직(LATERAL 최신배정 + 현재평가자 우선·그 외 최신, LIMIT 1)을
// DISTINCT ON (evaluatee_id) 로 일반화 — 직원당 정확히 같은 1건을 고른다(개별 호출과 동치).
// 개별 호출과 동일한 컬럼(evaluator_id/_name 등)을 포함해 매핑 시 평가자 정보 유실이 없게 한다.
app.get('/api/evaluations/current-by-employee', requireHr, async (req, res) => {
  if (!isDbAvailable) {
    return res.json([]);
  }
  try {
    const filter = await resolveEvaluationPeriodFilter(req.query, 1);
    const requestedEvaluatorId =
      typeof req.query.evaluatorId === 'string' && req.query.evaluatorId.trim()
        ? req.query.evaluatorId.trim()
        : null;
    const evaluatorIndex = 1 + filter.values.length;
    const evaluatorClause = requestedEvaluatorId
      ? `AND latest_ah.new_evaluator_id = $${evaluatorIndex}`
      : '';
    const params = requestedEvaluatorId
      ? [...filter.values, requestedEvaluatorId]
      : [...filter.values];
    // DISTINCT ON 선두 정렬키=evaluatee_id, 그 뒤는 개별 라우트의 LIMIT 1 선택순서와 동일.
    const tiebreak = requestedEvaluatorId
      ? 'ev.created_at DESC'
      : `CASE
            WHEN latest_ah.new_evaluator_id IS NOT DISTINCT FROM emp.evaluator_id THEN 0
            ELSE 1
          END,
          latest_ah.changed_at DESC NULLS LAST,
          ev.created_at DESC`;
    const { rows } = await pool.query(
      `
        SELECT DISTINCT ON (ev.evaluatee_id)
          ev.*,
          COALESCE(latest_ah.new_evaluator_id, emp.evaluator_id) AS evaluator_id,
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
        LEFT JOIN employees ev_emp ON ev_emp.employee_id = COALESCE(latest_ah.new_evaluator_id, emp.evaluator_id)
        WHERE ${filter.clause.replaceAll('evaluation_period_id', 'ev.evaluation_period_id').replaceAll('evaluation_year', 'ev.evaluation_year')}
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
          ${evaluatorClause}
        ORDER BY ev.evaluatee_id, ${tiebreak}
      `,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching current evaluations by employee:', err);
    res.json([]);
  }
});

app.get('/api/evaluator-mappings', requireHr, async (req, res) => {
  try {
    // 보안(P0): HR 전용 — 전사 평가자-피평가자 그래프(이름·부서)를 일반 사용자에게 노출하지 않는다.
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
// HR 전용 — 평가자-피평가자 매핑을 일괄 재작성하므로 일반 사용자 접근을 차단한다.
app.post('/api/evaluator-mappings', requireHr, async (req, res) => {
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
      await insertAdminAuditLog(client, {
        actionType: 'evaluator_mappings_bulk',
        actorId: req.session.employeeId,
        previousValue: null,
        newValue: { count: Array.isArray(mappings) ? mappings.length : 0 },
        reason: '평가자-피평가자 매핑 일괄 갱신',
      });
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
    // 보안(P0): 비-HR은 '본인 관련' 변경요청만 조회(요청자/피평가자/현·요청 평가자). 전사 노출 차단.
    if (!(await requesterIsHr(req).catch(() => false))) {
      values.push(req.session.employeeId);
      const meIdx = values.length;
      conditions.push(
        `(r.requested_by = $${meIdx} OR r.evaluatee_id = $${meIdx} OR r.current_evaluator_id = $${meIdx} OR r.requested_evaluator_id = $${meIdx})`,
      );
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
  // 보안(P0): 비-HR은 본인 명의로만 요청 가능(requested_by 본문 신뢰 금지 — 타인 명의 요청·감사 위조 차단).
  const changeReqIsHr = await requesterIsHr(req).catch(() => false);
  const requestedBy = changeReqIsHr
    ? normalizeOptionalText(body.requested_by ?? body.requestedBy)
    : req.session.employeeId;
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

app.post('/api/change-requests/:id/approve', requireHr, async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }
  // 검토자 신원은 세션에서 도출 — 클라이언트 body 의 reviewed_by 를 신뢰하지 않는다(권한상승·감사위조 방지).
  const reviewerId = req.session.employeeId;
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

    await insertAdminAuditLog(client, {
      actionType: 'change_request_approve',
      actorId: reviewerId,
      targetEmployeeId: request.evaluatee_id,
      previousValue: { target_history_id: request.target_history_id },
      newValue: {
        requested_evaluator_id: request.requested_evaluator_id ?? null,
        applied_history_id: correction.correction?.id ?? null,
      },
      reason: `평가자 변경요청 승인 (요청자 ${request.requested_by})${reviewComment ? ` / 메모: ${reviewComment}` : ''}`,
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

app.post('/api/change-requests/:id/reject', requireHr, async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }
  // 검토자 신원은 세션에서 도출 — 클라이언트 body 의 reviewed_by 를 신뢰하지 않는다(권한상승·감사위조 방지).
  const reviewerId = req.session.employeeId;
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

    await insertAdminAuditLog(client, {
      actionType: 'change_request_reject',
      actorId: reviewerId,
      targetEmployeeId: request.evaluatee_id,
      previousValue: null,
      newValue: { requested_evaluator_id: request.requested_evaluator_id ?? null },
      reason: `평가자 변경요청 반려 (요청자 ${request.requested_by})${reviewComment ? ` / 사유: ${reviewComment}` : ''}`,
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
  // 보안(P1): 취소 행위자는 세션에서 강제한다(actor_id 본문 신뢰 금지 — 생략 시 임의 취소 차단).
  const actorId = req.session.employeeId;
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
    // 보안(P1): HR 또는 요청자 본인만 취소 가능(actorId 는 세션에서 도출).
    const cancelIsHr = await requesterIsHr(req).catch(() => false);
    if (!cancelIsHr && actorId !== request.requested_by) {
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
app.post('/api/change-requests/:id/revert', requireHr, async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }
  // 검토자 신원은 세션에서 도출 — 클라이언트 body 의 reviewed_by 를 신뢰하지 않는다(권한상승·감사위조 방지).
  const reviewerId = req.session.employeeId;
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

    await insertAdminAuditLog(client, {
      actionType: 'change_request_revert',
      actorId: reviewerId,
      targetEmployeeId: request.evaluatee_id,
      previousValue: { applied_history_id: request.applied_history_id },
      newValue: null,
      reason: `평가자 변경요청 승인 되돌림 (요청 ${request.id})${reviewComment ? ` / ${reviewComment}` : ''}`,
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

app.post('/api/evaluation-periods', requireHr, async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }

  const client = await pool.connect();
  try {
    const payload = normalizePeriodPayload(req.body);
    await client.query('BEGIN');
    const period = await savePeriodWithActivationRules(client, payload);
    await insertAdminAuditLog(client, {
      actionType: 'evaluation_period_create',
      actorId: req.session.employeeId,
      previousValue: null,
      newValue: period,
      reason: '평가기간 생성',
    });
    await client.query('COMMIT');
    res.status(201).json(period);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error creating evaluation period:', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Evaluation period code already exists' });
    }
    res.status(err.statusCode ?? 500).json({ error: err.statusCode ? err.message : 'Database error' });
  } finally {
    client.release();
  }
});

app.put('/api/evaluation-periods/:id', requireHr, async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }

  const client = await pool.connect();
  try {
    const payload = normalizePeriodPayload(req.body, { partial: true });
    await client.query('BEGIN');
    const period = await savePeriodWithActivationRules(client, payload, req.params.id);
    await insertAdminAuditLog(client, {
      actionType: 'evaluation_period_update',
      actorId: req.session.employeeId,
      previousValue: null,
      newValue: period,
      reason: '평가기간 수정',
    });
    await client.query('COMMIT');
    res.json(period);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error updating evaluation period:', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Evaluation period code already exists' });
    }
    res.status(err.statusCode ?? 500).json({ error: err.statusCode ? err.message : 'Database error' });
  } finally {
    client.release();
  }
});

app.delete('/api/evaluation-periods/:id', requireHr, async (req, res) => {
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
    await insertAdminAuditLog(client, {
      actionType: 'evaluation_period_delete',
      actorId: req.session.employeeId,
      previousValue: period,
      newValue: null,
      reason: '평가기간 삭제',
    });
    await client.query('COMMIT');
    res.json({ ok: true, deleted_id: req.params.id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error deleting evaluation period:', err);
    res.status(err.statusCode ?? 500).json({ error: err.statusCode ? err.message : 'Database error' });
  } finally {
    client.release();
  }
});

/* ── 조직 KPI 정렬 ───────────────────────────────────────────────
 * 정량(억/%/건) 목표를 조직 단위로 등록하고 과업에 배분·실적 추적. parent_kpi_id 트리 자동 롤업.
 * 기존 정성 점수(매트릭스)는 무변경 — KPI는 평가 화면 "참고 지표"로만 강조(부분 반영). */

const KPI_LEVEL_DEPTH = { corporation: 0, division: 1, department: 2, team: 3 };
const KPI_LEVELS = ['corporation', 'division', 'department', 'team'];
const KPI_LEVEL_ORG_COL = {
  corporation: 'evaluatee_org_corporation',
  division: 'evaluatee_org_division',
  department: 'evaluatee_org_department',
  team: 'evaluatee_org_team',
};
// 조직 경로(상위 조상) 저장 — 동명 조직(법인 간 같은 팀명) 구분. org_key=해당 레벨 값, 그보다 상위만 경로 컬럼에.
const KPI_PATH_COLS = { corporation: 'org_path_corporation', division: 'org_path_division', department: 'org_path_department' };
const kpiAncestorLevels = (orgLevel) =>
  ['corporation', 'division', 'department'].filter((l) => KPI_LEVEL_DEPTH[l] < KPI_LEVEL_DEPTH[orgLevel]);
// body 의 경로 입력을 레벨에 맞게 정규화 — 조상 레벨만 채우고 나머지는 NULL.
const normalizeKpiPath = (orgLevel, body) => {
  const out = { org_path_corporation: null, org_path_division: null, org_path_department: null };
  for (const l of kpiAncestorLevels(orgLevel)) {
    const v = String(body?.[KPI_PATH_COLS[l]] ?? '').trim();
    out[KPI_PATH_COLS[l]] = v || null;
  }
  return out;
};
const kpiNum = (v) => (v == null ? null : Number(v));

// 평면 조회 + 노드 자체 합(own_*). 롤업은 buildKpiTree 가 트리에서 계산.
const loadKpiRowsForPeriod = async (periodId) => {
  const { rows } = await pool.query(
    `SELECT k.*,
            COALESCE(a.own_achieved, 0)  AS own_achieved,
            COALESCE(a.own_allocated, 0) AS own_allocated
       FROM org_kpis k
       LEFT JOIN (
         SELECT kpi_id,
                SUM(COALESCE(achieved_value, 0))   AS own_achieved,
                SUM(COALESCE(allocated_target, 0)) AS own_allocated,
                COUNT(achieved_value)              AS own_achieved_count
           FROM task_kpi_allocations GROUP BY kpi_id
       ) a ON a.kpi_id = k.id
      WHERE k.evaluation_period_id = $1
      ORDER BY k.org_level, k.name`,
    [periodId],
  );
  for (const r of rows) {
    r.target_value = Number(r.target_value);
    r.own_achieved = Number(r.own_achieved);
    r.own_allocated = Number(r.own_allocated);
    r.own_achieved_count = Number(r.own_achieved_count ?? 0);
  }
  return rows;
};

// 진척률 — direction 반영. higher=실적/목표. lower(낮을수록 좋음)=목표/실적:
//   실적 미입력이면 0(판정 불가), 실적 0 이하면 1(목표 이하 유지 = 달성), 그 외 목표/실적(실적≤목표 ⇒ ≥1).
const computeKpiProgress = (node) => {
  if (!(node.target_value > 0)) return 0;
  if (node.direction === 'lower') {
    if (!(node.rolled_achieved_count > 0)) return 0;
    if (node.rolled_achieved <= 0) return 1;
    return node.target_value / node.rolled_achieved;
  }
  return node.rolled_achieved / node.target_value;
};

// 트리 구성 + 후위순회 롤업. 각 과업 실적은 한 노드에 1회 귀속 → 조상 합산(이중계산 없음).
const buildKpiTree = (rows) => {
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const r of rows) {
    r.children = [];
    r.rolled_achieved = r.own_achieved;
    r.rolled_allocated = r.own_allocated;
    r.rolled_achieved_count = r.own_achieved_count ?? 0;
  }
  const roots = [];
  for (const r of rows) {
    const parent = r.parent_kpi_id ? byId.get(r.parent_kpi_id) : null;
    if (parent) parent.children.push(r);
    else roots.push(r);
  }
  // 상위 KPI 이름 — 비-HR 트리에서 부모가 가시성 밖이라 재루팅되어도 '어디에 연결됐는지'는 보여준다.
  for (const r of rows) {
    r.parent_name = r.parent_kpi_id ? byId.get(r.parent_kpi_id)?.name ?? null : null;
  }
  const seen = new Set();
  const visit = (node) => {
    if (seen.has(node.id)) return; // 손상 데이터 순환 방어
    seen.add(node.id);
    for (const child of node.children) {
      visit(child);
      node.rolled_achieved += child.rolled_achieved;
      node.rolled_allocated += child.rolled_allocated;
      node.rolled_achieved_count += child.rolled_achieved_count;
    }
    node.progress = computeKpiProgress(node);
  };
  roots.forEach(visit);
  return roots;
};

const serializeKpiBase = (r) => ({
  id: r.id,
  evaluation_period_id: r.evaluation_period_id,
  parent_kpi_id: r.parent_kpi_id,
  org_level: r.org_level,
  org_key: r.org_key,
  org_path_corporation: r.org_path_corporation ?? null,
  org_path_division: r.org_path_division ?? null,
  org_path_department: r.org_path_department ?? null,
  parent_name: r.parent_name ?? null,
  name: r.name,
  unit: r.unit,
  target_value: kpiNum(r.target_value),
  direction: r.direction,
  description: r.description,
  owner_id: r.owner_id,
  status: r.status,
  created_by: r.created_by,
  created_at: r.created_at,
  updated_at: r.updated_at,
  own_achieved: kpiNum(r.own_achieved) ?? 0,
  own_allocated: kpiNum(r.own_allocated) ?? 0,
  rolled_achieved: kpiNum(r.rolled_achieved),
  rolled_allocated: kpiNum(r.rolled_allocated),
  progress: r.progress ?? null,
  // 실적이 1건이라도 입력됐는가 — lower 방향에서 '미입력'과 '실적 0'을 구분하기 위한 신호.
  has_actuals: Number(r.rolled_achieved_count ?? r.own_achieved_count ?? 0) > 0,
});
const serializeKpiTree = (r) => ({ ...serializeKpiBase(r), children: (r.children || []).map(serializeKpiTree) });
const serializeAllocation = (r) => ({
  ...r,
  allocated_target: kpiNum(r.allocated_target) ?? 0,
  achieved_value: kpiNum(r.achieved_value),
});

// parent_kpi_id 검증: 같은 기간·상위 레벨·같은 단위·조직 경로 정합·순환 금지.
// childPath: 이 KPI 의 조상 조직 { corporation, division, department } (모르면 null — 레거시 관용).
const validateKpiParent = async (client, { id, parentKpiId, periodId, orgLevel, unit, childPath }) => {
  if (!parentKpiId) return;
  const { rows } = await client.query('SELECT * FROM org_kpis WHERE id = $1', [parentKpiId]);
  const parent = rows[0];
  const fail = (msg) => {
    const e = new Error(msg);
    e.statusCode = 400;
    throw e;
  };
  if (!parent) fail('상위 KPI를 찾을 수 없습니다.');
  if (parent.evaluation_period_id !== periodId) fail('상위 KPI는 같은 평가기간이어야 합니다.');
  if (KPI_LEVEL_DEPTH[orgLevel] <= KPI_LEVEL_DEPTH[parent.org_level])
    fail('상위 KPI는 더 상위 조직 레벨이어야 합니다.');
  if (parent.unit !== unit) fail('상위 KPI와 단위가 같아야 롤업됩니다.');
  // 조직 경로 정합 — 상위 KPI 는 이 KPI 조직의 '실제 상위 조직'이어야 한다(엉뚱한 본부·부 연결 금지).
  // 경로를 모르는(NULL) 쪽은 관용해 레거시 KPI 를 깨지 않는다.
  if (childPath) {
    const ancestorAtParentLevel = childPath[parent.org_level] ?? null;
    if (ancestorAtParentLevel && parent.org_key !== ancestorAtParentLevel) {
      fail(`상위 KPI 조직(${parent.org_key})이 이 KPI의 상위 조직(${ancestorAtParentLevel})과 다릅니다.`);
    }
    for (const l of kpiAncestorLevels(parent.org_level)) {
      const pv = parent[KPI_PATH_COLS[l]];
      const cv = childPath[l];
      if (pv && cv && pv !== cv) fail('상위 KPI의 조직 경로가 이 KPI의 조직 경로와 다릅니다.');
    }
  }
  // 순환 방지: parent 에서 위로 올라가며 자기 자신(id)에 도달하면 거부.
  if (id) {
    let cur = parent;
    const guard = new Set();
    while (cur && cur.parent_kpi_id && !guard.has(cur.id)) {
      if (cur.parent_kpi_id === id) fail('순환 참조는 허용되지 않습니다.');
      guard.add(cur.id);
      const next = await client.query('SELECT id, parent_kpi_id FROM org_kpis WHERE id = $1', [cur.parent_kpi_id]);
      cur = next.rows[0];
    }
  }
};

// 접근제어: KPI는 평가체인을 따른다. 비-HR 요청자는 '관리 조직'의 KPI만 조회/수정 가능.
// 관리 조직(레벨별) = 그 조직(레벨·값)의 평가대상 전원이 요청자의 하위 평가체인에 속하는 조직.
//   → 상위평가자는 하위 조직 전체를 보고, 일부만 평가하는 사람은 그 상위 조직을 못 본다(체인 격리).
// 반환: HR 이면 null(=전체 허용). 아니면 {corporation:Set, division:Set, department:Set, team:Set}.
// 'HR 모드로 동작 중인가' — HR 역할 보유 + 현재 활성 역할이 HR(또는 미지정). 평가자 모드면 false.
// 활성 역할은 클라이언트가 X-Active-Role 로 전달(role switch UX). available_roles 와 교차검증하므로
// evaluator 자청은 자기 권한 축소로만 작용(상향 불가).
const kpiActingAsHr = async (req) => {
  if (!(await requesterIsHr(req))) return false;
  const claim = String(req.headers['x-active-role'] || '').toLowerCase();
  return claim !== 'evaluator' && claim !== 'evaluatee';
};

// 요청자 하위 평가체인의 employee_id Set(본인 포함). actingAsHr 이면 null(=전체 접근).
// 평가자 노드를 통해서만 하강 — 상위평가자→차상위평가자→…→피평가자 전원.
const getDownwardChainIds = async (req, actingAsHr) => {
  if (actingAsHr) return null;
  const me = String(req.session.employeeId);
  const { rows } = await pool.query(
    `WITH RECURSIVE down AS (
       SELECT employee_id, evaluator_id, available_roles, 1 AS depth
         FROM employees WHERE evaluator_id::text = $1
       UNION ALL
       SELECT e.employee_id, e.evaluator_id, e.available_roles, d.depth + 1
         FROM employees e
         JOIN down d ON e.evaluator_id::text = d.employee_id::text
        WHERE d.depth < 50 AND 'evaluator' = ANY(d.available_roles)
     )
     SELECT DISTINCT employee_id FROM down`,
    [me],
  );
  const set = new Set(rows.map((r) => String(r.employee_id)));
  set.add(me); // 본인이 만든 KPI 조회 위해 본인 포함
  return set;
};

// KPI 가시성/수정권: HR 이거나, KPI 생성자(created_by)가 요청자 본인 또는 하위 평가체인에 속함.
//   → 평가자는 본인 KPI + 하위 평가자(차상위 평가자 등)의 KPI를 본다. 상위/타체인 KPI는 안 보인다.
const kpiVisibleTo = (chainOrNull, kpi) =>
  chainOrNull === null || chainOrNull.has(String(kpi.created_by));

// 조직 경로 튜플 키 — 최상위(법인)부터 해당 레벨까지 '|' 로 연결(동명 조직 구분의 기준 키).
const kpiTupleKey = (t, level) => {
  const parts = [];
  for (const l of KPI_LEVELS) {
    parts.push(t[l] ?? '');
    if (l === level) break;
  }
  return parts.join('|');
};

// 등록 가능 조직 '경로 튜플'(레벨별) — 요청자가 평가하는(하위체인) 인원들의 실제 조직 조합. HR 은 전체.
// 정형화 드롭다운의 원천이자 등록/변경 검증 기준. 반환: 레벨별 Map(pathKey → 튜플).
const getCreatableOrgTuples = async (req, periodId, actingAsHr) => {
  const chain = await getDownwardChainIds(req, actingAsHr); // HR 모드→null(전체)
  const { rows } = await pool.query(
    `SELECT evaluatee_id,
            evaluatee_org_corporation AS corporation, evaluatee_org_division AS division,
            evaluatee_org_department AS department, evaluatee_org_team AS team
       FROM evaluations WHERE evaluation_period_id = $1 AND record_status = 'active'`,
    [periodId],
  );
  const perLevel = { corporation: new Map(), division: new Map(), department: new Map(), team: new Map() };
  for (const e of rows) {
    if (chain !== null && !chain.has(String(e.evaluatee_id))) continue; // 비-HR: 체인 인원의 조직만
    for (const level of KPI_LEVELS) {
      if (!e[level]) continue;
      const tuple = { corporation: null, division: null, department: null, team: null };
      for (const l of KPI_LEVELS) {
        tuple[l] = e[l] ?? null;
        if (l === level) break;
      }
      perLevel[level].set(kpiTupleKey(tuple, level), tuple);
    }
  }
  return perLevel;
};
// 등록/변경 허용 검사 — (레벨·조직명·경로)가 실제 평가 데이터의 조직 조합과 일치해야 한다.
// path 값이 비어 있으면(레거시) 이름 일치만 요구해 기존 KPI 수정을 깨지 않는다.
const canCreateOrgTuple = (perLevel, level, orgKey, path) => {
  for (const tuple of perLevel[level].values()) {
    if (tuple[level] !== orgKey) continue;
    let ok = true;
    for (const l of kpiAncestorLevels(level)) {
      const want = path?.[KPI_PATH_COLS[l]] ?? null;
      if (want && tuple[l] !== want) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
};

// GET 목록(평면) — own_*/rolled_*/progress 동봉. 롤업 위해 기간 전체 로드 후 필터.
app.get('/api/org-kpis', async (req, res) => {
  if (!isDbAvailable) return res.json([]);
  if (!req.session?.employeeId) return res.status(401).json({ error: '로그인이 필요합니다.' });
  const periodId = req.query.periodId;
  if (!periodId) return res.status(400).json({ error: 'periodId가 필요합니다.' });
  try {
    const rows = await loadKpiRowsForPeriod(periodId);
    buildKpiTree(rows); // rolled_*/progress 채움(전체 기준)
    const chain = await getDownwardChainIds(req, await kpiActingAsHr(req));
    let out = rows.filter((r) => kpiVisibleTo(chain, r));
    if (req.query.level) out = out.filter((r) => r.org_level === req.query.level);
    if (req.query.orgKey) out = out.filter((r) => r.org_key === req.query.orgKey);
    res.json(out.map(serializeKpiBase));
  } catch (err) {
    console.error('Error listing KPIs:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET 트리(children 중첩) — :id 보다 먼저 등록해야 'tree' 가 :id 로 안 먹힘.
app.get('/api/org-kpis/tree', async (req, res) => {
  if (!isDbAvailable) return res.json([]);
  if (!req.session?.employeeId) return res.status(401).json({ error: '로그인이 필요합니다.' });
  const periodId = req.query.periodId;
  if (!periodId) return res.status(400).json({ error: 'periodId가 필요합니다.' });
  try {
    const rows = await loadKpiRowsForPeriod(periodId);
    buildKpiTree(rows); // 롤업은 전체 기준으로 먼저 계산(rolled_*/progress)
    const chain = await getDownwardChainIds(req, await kpiActingAsHr(req));
    if (chain === null) {
      // HR: 전체 트리
      const byId = new Map(rows.map((r) => [r.id, r]));
      const roots = rows.filter((r) => !(r.parent_kpi_id && byId.has(r.parent_kpi_id)));
      return res.json(roots.map(serializeKpiTree));
    }
    // 비-HR: 보이는 노드(본인/하위체인 생성)만 남기고, 보이지 않는 상위가 있으면 최상위로 재루팅.
    const visible = rows.filter((r) => kpiVisibleTo(chain, r));
    const visibleIds = new Set(visible.map((r) => r.id));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const nearestVisibleParent = (node) => {
      let p = node.parent_kpi_id ? byId.get(node.parent_kpi_id) : null;
      while (p && !visibleIds.has(p.id)) p = p.parent_kpi_id ? byId.get(p.parent_kpi_id) : null;
      return p || null;
    };
    const childrenMap = new Map(visible.map((r) => [r.id, []]));
    const roots = [];
    for (const n of visible) {
      const vp = nearestVisibleParent(n);
      if (vp) childrenMap.get(vp.id).push(n);
      else roots.push(n);
    }
    const serialize = (n) => ({ ...serializeKpiBase(n), children: (childrenMap.get(n.id) || []).map(serialize) });
    res.json(roots.map(serialize));
  } catch (err) {
    console.error('Error building KPI tree:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// 폼 드롭다운용 — 그 기간 평가에 존재하는 조직 옵션(레벨별 distinct) + 요청자 본인 조직.
app.get('/api/org-kpis/org-options', async (req, res) => {
  if (!isDbAvailable) return res.json({ corporation: [], division: [], department: [], team: [], mine: {} });
  if (!req.session?.employeeId) return res.status(401).json({ error: '로그인이 필요합니다.' });
  const periodId = req.query.periodId;
  if (!periodId) return res.status(400).json({ error: 'periodId가 필요합니다.' });
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT evaluatee_org_corporation AS c, evaluatee_org_division AS d,
              evaluatee_org_department AS dep, evaluatee_org_team AS t
         FROM evaluations
        WHERE evaluation_period_id = $1 AND record_status = 'active'`,
      [periodId],
    );
    const uniq = (k) => [...new Set(rows.map((r) => r[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko-KR'));
    const meRow = (
      await pool.query(
        `SELECT org_corporation, org_division, org_department, org_team FROM employees WHERE employee_id::text = $1`,
        [req.session.employeeId],
      )
    ).rows[0] || {};
    // 요청자가 이 기간에 실제 평가하는 팀들(평가자 KPI 등록 범위·기본값용).
    const myTeamsRows = await pool.query(
      `SELECT DISTINCT ev.evaluatee_org_team AS t
         FROM evaluations ev
         LEFT JOIN evaluator_assignment_history h ON h.id = ev.assignment_history_id
         LEFT JOIN employees e ON e.employee_id = ev.evaluatee_id
        WHERE ev.evaluation_period_id = $1 AND ev.record_status = 'active'
          AND ev.evaluatee_org_team IS NOT NULL
          AND (h.new_evaluator_id::text = $2 OR e.evaluator_id::text = $2)`,
      [periodId, req.session.employeeId],
    );
    const myTeams = myTeamsRows.rows.map((r) => r.t).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko-KR'));
    // 조직별 '조직장(평가자)' 라벨 — 동명 조직(법인 간 같은 팀명)·유사 조직명을 사람 이름으로 구분하는 용도.
    // 조직장 = 그 조직 구성원을 평가하면서, 본인도 그 조직 구성원이고, 본인의 평가자는 조직 밖인 사람
    // (= 조직 내부 평가체인의 최상위). 단순 '담당 인원수 1위'는 팀 상위 레벨(부·본부)에서 가장 큰 팀의
    // 팀장을 조직장으로 오표기하므로 쓰지 않는다. 팀 레벨만은 후보가 없으면 인원수 1위로 폴백(팀장이
    // 평가 대상이 아닌 경우), 상위 레벨은 오표기 위험이 커 라벨을 생략한다.
    const { rows: leaderRows } = await pool.query(
      `SELECT ev.evaluatee_id::text AS evaluatee_id,
              ev.evaluatee_org_corporation AS c, ev.evaluatee_org_division AS d,
              ev.evaluatee_org_department AS dep, ev.evaluatee_org_team AS t,
              COALESCE(h.new_evaluator_id::text, e.evaluator_id::text) AS evaluator_id,
              lead.name AS evaluator_name
         FROM evaluations ev
         LEFT JOIN evaluator_assignment_history h ON h.id = ev.assignment_history_id
         LEFT JOIN employees e ON e.employee_id = ev.evaluatee_id
         LEFT JOIN employees lead ON lead.employee_id::text = COALESCE(h.new_evaluator_id::text, e.evaluator_id::text)
        WHERE ev.evaluation_period_id = $1 AND ev.record_status = 'active'`,
      [periodId],
    );
    const leaderKeyCol = { corporation: 'c', division: 'd', department: 'dep', team: 't' };
    // 조직 식별은 이름이 아니라 '경로 키'(법인|본부|부|팀, 해당 레벨까지) — 동명 조직을 섞지 않는다.
    const rowPathKey = (o, lvl) => {
      const parts = [];
      for (const l of KPI_LEVELS) {
        parts.push(o?.[leaderKeyCol[l]] ?? '');
        if (l === lvl) break;
      }
      return parts.join('|');
    };
    // 개인별 소속(본인 평가 기준)과 평가자 — 체인 조건 판정용.
    const orgOfMember = new Map(); // evaluatee_id → {c,d,dep,t}
    const evaluatorOfMember = new Map(); // evaluatee_id → evaluator_id
    const nameOfEvaluator = new Map(); // evaluator_id → name
    for (const r of leaderRows) {
      orgOfMember.set(r.evaluatee_id, { c: r.c, d: r.d, dep: r.dep, t: r.t });
      if (r.evaluator_id) {
        evaluatorOfMember.set(r.evaluatee_id, r.evaluator_id);
        if (r.evaluator_name) nameOfEvaluator.set(r.evaluator_id, r.evaluator_name);
      }
    }
    // 조직(경로 키)별 평가자 담당 인원수(evaluator_id 기준 — 동명이인 합산 방지).
    const leaderAgg = { corporation: new Map(), division: new Map(), department: new Map(), team: new Map() };
    for (const r of leaderRows) {
      if (!r.evaluator_id || !r.evaluator_name) continue;
      for (const lvl of KPI_LEVELS) {
        if (!r[leaderKeyCol[lvl]]) continue;
        const key = rowPathKey(r, lvl);
        let m = leaderAgg[lvl].get(key);
        if (!m) {
          m = new Map();
          leaderAgg[lvl].set(key, m);
        }
        m.set(r.evaluator_id, (m.get(r.evaluator_id) ?? 0) + 1);
      }
    }
    const leaders = {};
    for (const lvl of KPI_LEVELS) {
      leaders[lvl] = {};
      for (const [key, m] of leaderAgg[lvl]) {
        const byCount = [...m.entries()].sort((a, b) => b[1] - a[1]);
        const qualified = byCount.filter(([id]) => {
          if (rowPathKey(orgOfMember.get(id), lvl) !== key) return false; // 본인이 그 조직 구성원
          const boss = evaluatorOfMember.get(id);
          return !boss || rowPathKey(orgOfMember.get(boss), lvl) !== key; // 그의 평가자는 조직 밖(=체인 최상위)
        });
        const picked = qualified.length > 0 ? qualified : lvl === 'team' ? byCount : [];
        const names = picked.map(([id]) => nameOfEvaluator.get(id)).filter(Boolean);
        if (names.length > 0) leaders[lvl][key] = names;
      }
    }
    // 등록 폼 드롭다운용 — 정형화 조직 선택지(경로 튜플, 레벨별). 비-HR 은 본인 평가 범위(하위체인)만.
    const actingAsHr = await kpiActingAsHr(req);
    const creatableTuples = await getCreatableOrgTuples(req, periodId, actingAsHr);
    const labelOfTuple = (t) => [t.corporation, t.division, t.department, t.team].filter(Boolean).join(' › ');
    const orgChoices = {};
    const manageableOut = {};
    for (const lvl of KPI_LEVELS) {
      orgChoices[lvl] = [...creatableTuples[lvl].entries()]
        .map(([key, t]) => ({ ...t, leader: leaders[lvl][key]?.[0] ?? null }))
        .sort((a, b) => labelOfTuple(a).localeCompare(labelOfTuple(b), 'ko-KR'));
      manageableOut[lvl] = [...new Set(orgChoices[lvl].map((t) => t[lvl]).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, 'ko-KR'),
      );
    }
    res.json({
      corporation: uniq('c'),
      division: uniq('d'),
      department: uniq('dep'),
      team: uniq('t'),
      mine: {
        corporation: meRow.org_corporation ?? null,
        division: meRow.org_division ?? null,
        department: meRow.org_department ?? null,
        team: meRow.org_team ?? null,
      },
      myTeams,
      manageable: manageableOut,
      leaders,
      orgChoices,
    });
  } catch (err) {
    console.error('Error fetching KPI org options:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// 상위 KPI 연결 후보 — 이 KPI 조직의 '상위 경로'에 있는 같은 기간·같은 단위·상위 레벨 KPI.
// 생성자-체인 가시성과 무관(연결 대상 조회일 뿐 관리 권한이 아님) → 팀장이 본부장 KPI 에 직접 연결 가능.
// :id 라우트보다 먼저 등록해야 'parent-candidates' 가 :id 로 잡히지 않는다.
app.get('/api/org-kpis/parent-candidates', requireHrOrEvaluator, async (req, res) => {
  if (!isDbAvailable) return res.json([]);
  const periodId = req.query.periodId;
  const orgLevel = String(req.query.orgLevel ?? '');
  const unit = String(req.query.unit ?? '').trim();
  if (!periodId || !Object.prototype.hasOwnProperty.call(KPI_LEVEL_DEPTH, orgLevel) || !unit) {
    return res.status(400).json({ error: 'periodId·orgLevel·unit 이 필요합니다.' });
  }
  // 이 KPI 조직의 조상 값(정형화 드롭다운에서 온 경로). 모르는 레벨의 후보는 내지 않는다(오연결 방지).
  const anc = {
    corporation: String(req.query.corporation ?? '').trim() || null,
    division: String(req.query.division ?? '').trim() || null,
    department: String(req.query.department ?? '').trim() || null,
  };
  try {
    const conds = [];
    const params = [periodId, unit];
    for (const l of kpiAncestorLevels(orgLevel)) {
      if (!anc[l]) continue;
      const parts = [`org_level = '${l}'`];
      params.push(anc[l]);
      parts.push(`org_key = $${params.length}`);
      for (const u of kpiAncestorLevels(l)) {
        if (!anc[u]) continue;
        params.push(anc[u]);
        parts.push(`(${KPI_PATH_COLS[u]} IS NULL OR ${KPI_PATH_COLS[u]} = $${params.length})`);
      }
      conds.push(`(${parts.join(' AND ')})`);
    }
    if (conds.length === 0) return res.json([]);
    const { rows } = await pool.query(
      `SELECT * FROM org_kpis
        WHERE evaluation_period_id = $1 AND status = 'active' AND unit = $2
          AND (${conds.join(' OR ')})
        ORDER BY CASE org_level WHEN 'department' THEN 0 WHEN 'division' THEN 1 ELSE 2 END, name`,
      params,
    );
    res.json(rows.map(serializeKpiBase));
  } catch (err) {
    console.error('Error fetching KPI parent candidates:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET 단건 + 배분 내역 + 자식 목록.
app.get('/api/org-kpis/:id', async (req, res) => {
  if (!isDbAvailable) return sendDbUnavailable(res);
  if (!req.session?.employeeId) return res.status(401).json({ error: '로그인이 필요합니다.' });
  try {
    const rows = await loadKpiRowsForPeriod(
      (await pool.query('SELECT evaluation_period_id FROM org_kpis WHERE id = $1', [req.params.id])).rows[0]
        ?.evaluation_period_id,
    );
    buildKpiTree(rows);
    const node = rows.find((r) => r.id === req.params.id);
    if (!node) return res.status(404).json({ error: 'KPI를 찾을 수 없습니다.' });
    const chain = await getDownwardChainIds(req, await kpiActingAsHr(req));
    if (!kpiVisibleTo(chain, node)) {
      return res.status(403).json({ error: '이 KPI에 접근할 권한이 없습니다.' });
    }
    const { rows: allocs } = await pool.query(
      `SELECT al.*, e.name AS evaluatee_name, t.title AS task_title
         FROM task_kpi_allocations al
         LEFT JOIN evaluations ev ON ev.id = al.evaluation_id
         LEFT JOIN employees e ON e.employee_id = ev.evaluatee_id
         LEFT JOIN tasks t ON t.id = al.task_uuid
        WHERE al.kpi_id = $1 ORDER BY al.updated_at DESC`,
      [req.params.id],
    );
    res.json({
      ...serializeKpiBase(node),
      children: (node.children || []).map(serializeKpiBase),
      allocations: allocs.map(serializeAllocation),
    });
  } catch (err) {
    console.error('Error fetching KPI:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/org-kpis', requireHrOrEvaluator, async (req, res) => {
  if (!isDbAvailable) return sendDbUnavailable(res);
  const b = req.body || {};
  const periodId = b.evaluation_period_id;
  const orgLevel = b.org_level;
  const orgKey = String(b.org_key ?? '').trim();
  const name = String(b.name ?? '').trim();
  const unit = String(b.unit ?? '').trim();
  const targetValue = Number(b.target_value);
  const direction = b.direction === 'lower' ? 'lower' : 'higher';
  if (!periodId || !Object.prototype.hasOwnProperty.call(KPI_LEVEL_DEPTH, orgLevel) || !orgKey || !name || !unit || !(targetValue > 0)) {
    return res.status(400).json({ error: '필수 항목(기간·조직레벨·조직·이름·단위·목표>0)을 확인하세요.' });
  }
  const orgPath = normalizeKpiPath(orgLevel, b);
  const actingAsHr = await kpiActingAsHr(req);
  // 등록 조직은 정형화 드롭다운(경로 튜플) 기준으로 서버에서도 검증 —
  //   비-HR: 본인이 평가하는(하위체인) 조직 조합만. HR: 그 기간 평가 데이터에 실존하는 조합만(유령 KPI 차단).
  const creatableTuples = await getCreatableOrgTuples(req, periodId, actingAsHr);
  if (!canCreateOrgTuple(creatableTuples, orgLevel, orgKey, orgPath)) {
    return res.status(actingAsHr ? 400 : 403).json({
      error: actingAsHr
        ? '해당 조직(경로 포함)이 이 평가기간의 평가 데이터에 없습니다. 목록에서 선택해 주세요.'
        : '본인이 평가하는 조직의 KPI만 등록할 수 있습니다.',
    });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await validateKpiParent(client, {
      id: null,
      parentKpiId: b.parent_kpi_id ?? null,
      periodId,
      orgLevel,
      unit,
      childPath: {
        corporation: orgPath.org_path_corporation,
        division: orgPath.org_path_division,
        department: orgPath.org_path_department,
      },
    });
    const { rows } = await client.query(
      `INSERT INTO org_kpis
         (evaluation_period_id, parent_kpi_id, org_level, org_key,
          org_path_corporation, org_path_division, org_path_department,
          name, unit, target_value, direction, description, owner_id, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active',$14) RETURNING *`,
      [
        periodId,
        b.parent_kpi_id ?? null,
        orgLevel,
        orgKey,
        orgPath.org_path_corporation,
        orgPath.org_path_division,
        orgPath.org_path_department,
        name,
        unit,
        targetValue,
        direction,
        b.description ?? null,
        b.owner_id ?? null,
        req.session.employeeId,
      ],
    );
    await insertAdminAuditLog(client, {
      actionType: 'kpi_create',
      actorId: req.session.employeeId,
      previousValue: null,
      newValue: rows[0],
      reason: 'KPI 등록',
    });
    await client.query('COMMIT');
    res.status(201).json(serializeKpiBase(rows[0]));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23503') return res.status(400).json({ error: '참조 무결성 오류(기간/상위 KPI 확인).' });
    console.error('Error creating KPI:', err.message);
    res.status(err.statusCode ?? 500).json({ error: err.statusCode ? err.message : 'Database error' });
  } finally {
    client.release();
  }
});

app.put('/api/org-kpis/:id', requireHrOrEvaluator, async (req, res) => {
  if (!isDbAvailable) return sendDbUnavailable(res);
  const b = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: existRows } = await client.query('SELECT * FROM org_kpis WHERE id = $1 FOR UPDATE', [req.params.id]);
    const existing = existRows[0];
    if (!existing) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'KPI를 찾을 수 없습니다.' });
    }
    const actingAsHr = await kpiActingAsHr(req);
    if (!actingAsHr) {
      // 생성자-체인: 본인 또는 하위 평가자가 만든 KPI만 수정.
      const chain = await getDownwardChainIds(req, actingAsHr);
      if (!kpiVisibleTo(chain, existing)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: '본인 또는 하위 평가자가 만든 KPI만 수정할 수 있습니다.' });
      }
    }
    // 조직(레벨·이름·경로) 머지 — 조직 관련 필드가 하나라도 오면 경로를 새 입력 기준으로 재구성.
    const orgProvided =
      b.org_level !== undefined ||
      b.org_key !== undefined ||
      b.org_path_corporation !== undefined ||
      b.org_path_division !== undefined ||
      b.org_path_department !== undefined;
    const nextLevel = b.org_level ?? existing.org_level;
    const nextKey = b.org_key !== undefined ? String(b.org_key).trim() : existing.org_key;
    const nextPath = orgProvided
      ? normalizeKpiPath(nextLevel, b)
      : {
          org_path_corporation: existing.org_path_corporation,
          org_path_division: existing.org_path_division,
          org_path_department: existing.org_path_department,
        };
    const orgChanged =
      nextLevel !== existing.org_level ||
      nextKey !== existing.org_key ||
      nextPath.org_path_corporation !== existing.org_path_corporation ||
      nextPath.org_path_division !== existing.org_path_division ||
      nextPath.org_path_department !== existing.org_path_department;
    if (orgChanged) {
      // 새 조직 조합은 실제 평가 데이터에 존재해야 하고, 비-HR 은 본인 평가 범위여야 함.
      const creatableTuples = await getCreatableOrgTuples(req, existing.evaluation_period_id, actingAsHr);
      if (!canCreateOrgTuple(creatableTuples, nextLevel, nextKey, nextPath)) {
        await client.query('ROLLBACK');
        return res.status(actingAsHr ? 400 : 403).json({
          error: actingAsHr
            ? '해당 조직(경로 포함)이 이 평가기간의 평가 데이터에 없습니다.'
            : '평가 범위 밖의 조직으로 변경할 수 없습니다.',
        });
      }
    }
    // 변경할 필드 머지(미지정은 기존값 유지)
    const next = {
      parent_kpi_id: b.parent_kpi_id !== undefined ? b.parent_kpi_id : existing.parent_kpi_id,
      org_level: nextLevel,
      org_key: nextKey,
      ...nextPath,
      name: b.name !== undefined ? String(b.name).trim() : existing.name,
      unit: b.unit !== undefined ? String(b.unit).trim() : existing.unit,
      target_value: b.target_value !== undefined ? Number(b.target_value) : Number(existing.target_value),
      direction: b.direction === 'lower' ? 'lower' : b.direction === 'higher' ? 'higher' : existing.direction,
      description: b.description !== undefined ? b.description : existing.description,
      owner_id: b.owner_id !== undefined ? b.owner_id : existing.owner_id,
      status: b.status === 'archived' || b.status === 'active' ? b.status : existing.status,
    };
    const fail = (msg) => {
      const e = new Error(msg);
      e.statusCode = 400;
      throw e;
    };
    if (!Object.prototype.hasOwnProperty.call(KPI_LEVEL_DEPTH, next.org_level)) fail('조직 레벨이 올바르지 않습니다.');
    if (!next.org_key || !next.name || !next.unit || !(next.target_value > 0)) fail('조직·이름·단위·목표(>0)를 확인하세요.');
    await validateKpiParent(client, {
      id: req.params.id,
      parentKpiId: next.parent_kpi_id,
      periodId: existing.evaluation_period_id,
      orgLevel: next.org_level,
      unit: next.unit,
      childPath: {
        corporation: next.org_path_corporation,
        division: next.org_path_division,
        department: next.org_path_department,
      },
    });
    // 자식 일관성: 단위/레벨 변경 시 자식이 깨지지 않는지.
    const { rows: kids } = await client.query('SELECT org_level, unit FROM org_kpis WHERE parent_kpi_id = $1', [req.params.id]);
    for (const kid of kids) {
      if (kid.unit !== next.unit) fail('하위 KPI와 단위가 달라집니다. 먼저 하위를 정리하세요.');
      if (KPI_LEVEL_DEPTH[kid.org_level] <= KPI_LEVEL_DEPTH[next.org_level]) fail('하위 KPI 레벨과 충돌합니다.');
    }
    const { rows } = await client.query(
      `UPDATE org_kpis SET
         parent_kpi_id=$1, org_level=$2, org_key=$3,
         org_path_corporation=$4, org_path_division=$5, org_path_department=$6,
         name=$7, unit=$8, target_value=$9,
         direction=$10, description=$11, owner_id=$12, status=$13, updated_at=now()
       WHERE id=$14 RETURNING *`,
      [
        next.parent_kpi_id,
        next.org_level,
        next.org_key,
        next.org_path_corporation,
        next.org_path_division,
        next.org_path_department,
        next.name,
        next.unit,
        next.target_value,
        next.direction,
        next.description,
        next.owner_id,
        next.status,
        req.params.id,
      ],
    );
    await insertAdminAuditLog(client, {
      actionType: 'kpi_update',
      actorId: req.session.employeeId,
      previousValue: existing,
      newValue: rows[0],
      reason: 'KPI 수정',
    });
    await client.query('COMMIT');
    res.json(serializeKpiBase(rows[0]));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error updating KPI:', err.message);
    res.status(err.statusCode ?? 500).json({ error: err.statusCode ? err.message : 'Database error' });
  } finally {
    client.release();
  }
});

app.delete('/api/org-kpis/:id', requireHrOrEvaluator, async (req, res) => {
  if (!isDbAvailable) return sendDbUnavailable(res);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM org_kpis WHERE id = $1 FOR UPDATE', [req.params.id]);
    const kpi = rows[0];
    if (!kpi) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'KPI를 찾을 수 없습니다.' });
    }
    // 생성자-체인: 본인 또는 하위 평가자가 만든 KPI만 삭제(HR 제외). 서브트리도 함께 삭제됨.
    const chain = await getDownwardChainIds(req, await kpiActingAsHr(req));
    if (!kpiVisibleTo(chain, kpi)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: '본인 또는 하위 평가자가 만든 KPI만 삭제할 수 있습니다.' });
    }
    await client.query('DELETE FROM org_kpis WHERE id = $1', [req.params.id]); // 자식·배분은 ON DELETE CASCADE
    await insertAdminAuditLog(client, {
      actionType: 'kpi_delete',
      actorId: req.session.employeeId,
      previousValue: kpi,
      newValue: null,
      reason: 'KPI 삭제(서브트리·배분 포함)',
    });
    await client.query('COMMIT');
    res.json({ ok: true, deleted_id: req.params.id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error deleting KPI:', err.message);
    res.status(err.statusCode ?? 500).json({ error: err.statusCode ? err.message : 'Database error' });
  } finally {
    client.release();
  }
});

// 평가건에 정렬 가능한 KPI 후보 — 그 피평가자 조직(레벨별)에 맞는 KPI만.
app.get('/api/evaluations/:evalId/kpi-candidates', guardEvaluationParam('evalId', { allowLineDescendant: true }), async (req, res) => {
  if (!isDbAvailable) return res.json({ candidates: [], evaluatee_org: null });
  try {
    const ev = (
      await pool.query(
        `SELECT evaluation_period_id,
                evaluatee_org_corporation AS c, evaluatee_org_division AS d,
                evaluatee_org_department AS dep, evaluatee_org_team AS t
           FROM evaluations WHERE id = $1`,
        [req.params.evalId],
      )
    ).rows[0];
    if (!ev) return res.json({ candidates: [], evaluatee_org: null });
    // 경로(org_path_*)가 있는 KPI 는 피평가자의 상위 조직까지 일치해야 후보가 된다 —
    // 동명 조직(다른 법인 같은 팀명) KPI 가 남의 조직 후보로 새지 않게. NULL 경로(레거시)는 이름만 매칭.
    const { rows } = await pool.query(
      `SELECT * FROM org_kpis
        WHERE evaluation_period_id = $1 AND status = 'active'
          AND ( (org_level='corporation' AND org_key = $2)
             OR (org_level='division'    AND org_key = $3
                 AND (org_path_corporation IS NULL OR org_path_corporation = $2))
             OR (org_level='department'  AND org_key = $4
                 AND (org_path_corporation IS NULL OR org_path_corporation = $2)
                 AND (org_path_division   IS NULL OR org_path_division   = $3))
             OR (org_level='team'        AND org_key = $5
                 AND (org_path_corporation IS NULL OR org_path_corporation = $2)
                 AND (org_path_division   IS NULL OR org_path_division   = $3)
                 AND (org_path_department IS NULL OR org_path_department = $4)) )
        ORDER BY org_level, name`,
      [ev.evaluation_period_id, ev.c, ev.d, ev.dep, ev.t],
    );
    // evaluatee_org: 빈 상태 문구에 "어떤 조직 기준으로 매칭했는지"를 보여주기 위해 동봉.
    res.json({
      candidates: rows.map((r) => ({ ...r, target_value: kpiNum(r.target_value) })),
      evaluatee_org: { corporation: ev.c, division: ev.d, department: ev.dep, team: ev.t },
    });
  } catch (err) {
    console.error('Error fetching KPI candidates:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// 과업의 정렬 KPI(배분) 목록 — 평가/과업 접근 권한 가드.
app.get('/api/tasks/:taskId/kpi-allocations', guardTaskParam('taskId'), async (req, res) => {
  if (!isDbAvailable) return res.json([]);
  try {
    const { rows } = await pool.query(
      `SELECT al.*, k.name AS kpi_name, k.unit AS kpi_unit, k.org_level AS kpi_org_level,
              k.org_key AS kpi_org_key, k.target_value AS kpi_target, k.direction AS kpi_direction
         FROM task_kpi_allocations al
         JOIN org_kpis k ON k.id = al.kpi_id
        WHERE al.task_uuid::text = $1
        ORDER BY k.name`,
      [String(req.params.taskId)],
    );
    res.json(
      rows.map((r) => ({ ...serializeAllocation(r), kpi_target: kpiNum(r.kpi_target) })),
    );
  } catch (err) {
    console.error('Error fetching task KPI allocations:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// 한 KPI 의 과업 배분/실적 upsert(배치). HR 또는 그 평가의 평가자/상위라인만.
app.put('/api/org-kpis/:id/allocations', requireHrOrEvaluator, async (req, res) => {
  if (!isDbAvailable) return sendDbUnavailable(res);
  const items = Array.isArray(req.body?.allocations) ? req.body.allocations : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: kRows } = await client.query('SELECT * FROM org_kpis WHERE id = $1', [req.params.id]);
    const kpi = kRows[0];
    if (!kpi) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'KPI를 찾을 수 없습니다.' });
    }
    const isHr = await requesterIsHr(req);
    const orgCol = KPI_LEVEL_ORG_COL[kpi.org_level];
    const out = [];
    for (const it of items) {
      const taskUuid = String(it.task_uuid ?? '');
      const evalId = String(it.evaluation_id ?? '');
      if (!taskUuid || !evalId) {
        const e = new Error('task_uuid·evaluation_id 가 필요합니다.');
        e.statusCode = 400;
        throw e;
      }
      // 평가행 + 권한/정렬 검증
      const { rows: evRows } = await client.query(
        `SELECT ev.id, ev.evaluatee_id, ev.${orgCol} AS org_val,
                ev.evaluatee_org_corporation AS org_corporation,
                ev.evaluatee_org_division    AS org_division,
                ev.evaluatee_org_department  AS org_department,
                h.new_evaluator_id AS assigned_evaluator_id, e.evaluator_id AS current_evaluator_id
           FROM evaluations ev
           LEFT JOIN evaluator_assignment_history h ON h.id = ev.assignment_history_id
           LEFT JOIN employees e ON e.employee_id = ev.evaluatee_id
          WHERE ev.id = $1`,
        [evalId],
      );
      const evRow = evRows[0];
      if (!evRow) {
        const e = new Error('평가를 찾을 수 없습니다.');
        e.statusCode = 400;
        throw e;
      }
      if (!isHr && !(await canAccessEvaluation(req, evRow, { allowLineDescendant: true }))) {
        const e = new Error('해당 과업에 배분할 권한이 없습니다.');
        e.statusCode = 403;
        throw e;
      }
      if (String(evRow.org_val ?? '') !== kpi.org_key) {
        const e = new Error('과업 피평가자의 조직이 KPI 조직과 일치하지 않습니다.');
        e.statusCode = 400;
        throw e;
      }
      // KPI 에 상위 경로가 저장돼 있으면 그 경로까지 일치해야 배분 가능(동명 조직 오배분 차단).
      for (const l of kpiAncestorLevels(kpi.org_level)) {
        const want = kpi[KPI_PATH_COLS[l]];
        if (want && String(evRow[`org_${l}`] ?? '') !== want) {
          const e = new Error('과업 피평가자의 상위 조직 경로가 KPI 조직 경로와 일치하지 않습니다.');
          e.statusCode = 400;
          throw e;
        }
      }
      // 과업이 그 평가 소속이고 삭제되지 않았는지
      const { rows: tRows } = await client.query(
        `SELECT task_id FROM tasks WHERE id = $1 AND evaluation_id = $2 AND deleted_at IS NULL`,
        [taskUuid, evalId],
      );
      if (!tRows[0]) {
        const e = new Error('유효한 과업이 아닙니다.');
        e.statusCode = 400;
        throw e;
      }
      const allocated = Number(it.allocated_target ?? 0);
      const achieved = it.achieved_value === null || it.achieved_value === undefined || it.achieved_value === '' ? null : Number(it.achieved_value);
      const { rows: upRows } = await client.query(
        `INSERT INTO task_kpi_allocations
           (kpi_id, task_uuid, task_id, evaluation_id, allocated_target, achieved_value, note, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (kpi_id, task_uuid) DO UPDATE SET
           allocated_target = EXCLUDED.allocated_target,
           achieved_value   = EXCLUDED.achieved_value,
           note             = EXCLUDED.note,
           updated_by       = EXCLUDED.updated_by,
           updated_at       = now()
         RETURNING *`,
        [req.params.id, taskUuid, tRows[0].task_id, evalId, allocated >= 0 ? allocated : 0, achieved, it.note ?? null, req.session.employeeId],
      );
      out.push(upRows[0]);
    }
    await insertAdminAuditLog(client, {
      actionType: 'kpi_allocation_upsert',
      actorId: req.session.employeeId,
      previousValue: { kpi_id: req.params.id },
      newValue: { count: out.length },
      reason: 'KPI 과업 배분/실적 저장',
    });
    await client.query('COMMIT');
    res.json(out.map(serializeAllocation));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error upserting KPI allocations:', err.message);
    res.status(err.statusCode ?? 500).json({ error: err.statusCode ? err.message : 'Database error' });
  } finally {
    client.release();
  }
});

app.delete('/api/org-kpis/:id/allocations/:allocId', requireHrOrEvaluator, async (req, res) => {
  if (!isDbAvailable) return sendDbUnavailable(res);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT al.*, ev.evaluatee_id, ev.evaluation_period_id,
              h.new_evaluator_id AS assigned_evaluator_id, e.evaluator_id AS current_evaluator_id
         FROM task_kpi_allocations al
         JOIN evaluations ev ON ev.id = al.evaluation_id
         LEFT JOIN evaluator_assignment_history h ON h.id = ev.assignment_history_id
         LEFT JOIN employees e ON e.employee_id = ev.evaluatee_id
        WHERE al.id = $1 AND al.kpi_id = $2`,
      [req.params.allocId, req.params.id],
    );
    const alloc = rows[0];
    if (!alloc) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '배분을 찾을 수 없습니다.' });
    }
    const isHr = await requesterIsHr(req);
    if (!isHr && !(await canAccessEvaluation(req, alloc, { allowLineDescendant: true }))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: '해당 배분을 삭제할 권한이 없습니다.' });
    }
    await client.query('DELETE FROM task_kpi_allocations WHERE id = $1', [req.params.allocId]);
    await insertAdminAuditLog(client, {
      actionType: 'kpi_allocation_delete',
      actorId: req.session.employeeId,
      previousValue: alloc,
      newValue: null,
      reason: 'KPI 과업 배분 해제',
    });
    await client.query('COMMIT');
    res.json({ ok: true, deleted_id: req.params.allocId });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error deleting KPI allocation:', err.message);
    res.status(err.statusCode ?? 500).json({ error: err.statusCode ? err.message : 'Database error' });
  } finally {
    client.release();
  }
});

app.get('/api/evaluations', requireHr, async (req, res) => {
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
app.get('/api/evaluations/employee/:employeeId', guardEmployeeEvaluationsParam('employeeId', { allowLineDescendant: true }), async (req, res) => {
  try {
    const filter = await resolveEvaluationPeriodFilter(req.query, 2);
    const { rows } = await pool.query(
      `
        SELECT
          ev.*,
          COALESCE(latest_ah.new_evaluator_id, emp.evaluator_id) AS evaluator_id,
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
        LEFT JOIN employees ev_emp ON ev_emp.employee_id = COALESCE(latest_ah.new_evaluator_id, emp.evaluator_id)
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

app.get('/api/evaluation/:id', guardEvaluationParam('id', { allowLineDescendant: true }), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT
          ev.*,
          COALESCE(latest_ah.new_evaluator_id, emp.evaluator_id) AS evaluator_id,
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
        LEFT JOIN employees ev_emp ON ev_emp.employee_id = COALESCE(latest_ah.new_evaluator_id, emp.evaluator_id)
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
    // 보안(P0): 본인 평가만 생성 가능(HR 제외) — 타인 evaluatee_id 로 임의 평가 생성 차단.
    const creatorIsHr = await requesterIsHr(req).catch(() => false);
    if (!creatorIsHr && String(evaluation.evaluatee_id ?? '') !== req.session.employeeId) {
      return res.status(403).json({ error: '본인 평가만 생성할 수 있습니다.' });
    }
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

    const cols = Object.keys(evaluation).filter((k) => EVALUATION_INSERT_FIELDS.has(k));
    if (cols.length === 0) {
      return res.status(400).json({ error: 'No valid evaluation fields to insert' });
    }
    const vals = cols.map((k) => evaluation[k]);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await pool.query(
      `INSERT INTO evaluations (${cols.join(',')}) VALUES (${placeholders}) RETURNING *`,
      vals
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error creating evaluation:', err);
    res.status(err.statusCode ?? 500).json({ error: err.statusCode ? err.message : 'Database error' });
  }
});

app.put('/api/evaluation/:id', guardEvaluationParam('id'), async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }

  const client = await pool.connect();
  try {
    await assertEvaluationWritableById(req.params.id);
    await client.query('BEGIN');

    // 감사로그용 직전 전체 스냅샷(변경 필드 old→new 비교 기준).
    const { rows: priorFullRows } = await client.query(
      'SELECT * FROM evaluations WHERE id = $1',
      [req.params.id]
    );
    const priorFull = priorFullRows[0] ?? null;

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

    // 보안(P0): 피평가자는 본인 평가를 'submitted'로만 전이 가능(자기 완료/되돌리기 차단).
    const meId = req.session.employeeId;
    const evalIsHr = await requesterIsHr(req).catch(() => false);
    const isEvaluatee = String(prior?.evaluatee_id ?? '') === meId;
    const isEvaluator = String(prior?.evaluator_id ?? '') === meId;
    const nextStatus = req.body?.evaluation_status;
    if (isEvaluatee && !isEvaluator && !evalIsHr && nextStatus && nextStatus !== 'submitted') {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: '피평가자는 평가를 제출 상태로만 변경할 수 있습니다.' });
    }

    // 보안(P0): 수정 가능 컬럼 화이트리스트(임의 컬럼/식별자 인젝션·mass-assignment 차단).
    const updateEntries = Object.entries(req.body).filter(([k]) => EVALUATION_UPDATE_FIELDS.has(k));
    if (updateEntries.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No valid evaluation fields to update' });
    }
    const set = updateEntries.map(([k], i) => `${k} = $${i + 1}`).join(', ');
    const values = [...updateEntries.map(([, v]) => v), req.params.id];
    const { rows } = await client.query(
      `UPDATE evaluations SET ${set}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
      values
    );
    const after = rows[0];

    // 상태 전이 타임스탬프(#4) — 칸반 진입/성과보고(최종제출) 시점 계산용.
    if (prior && after && prior.evaluation_status !== after.evaluation_status) {
      const b = prior.evaluation_status;
      const a = after.evaluation_status;
      const stamps = [];
      if (a === 'submitted') stamps.push('submitted_at = NOW()'); // 피평가자 최종제출
      if (a === 'completed' && b !== 'completed') stamps.push('completed_at = NOW()'); // 완료
      if (a === 'evaluating' && b === 'completed') stamps.push('reverted_at = NOW()'); // 완료→임시저장 되돌림
      if (a === 'in-progress') stamps.push('returned_at = NOW()'); // 피평가자에게 돌려보냄
      if (stamps.length) {
        await client.query(`UPDATE evaluations SET ${stamps.join(', ')} WHERE id = $1`, [req.params.id]);
      }
    }

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

    // 감사로그: 화이트리스트 필드 중 실제로 값이 바뀐 것만 old→new 기록(상태·성장레벨 등).
    const changedKeys = updateEntries
      .map(([k]) => k)
      .filter((k) => !EVALUATION_AUDIT_IGNORED_FIELDS.has(k))
      .filter((k) => JSON.stringify(priorFull?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null));
    if (changedKeys.length > 0) {
      const previousValue = {};
      const newValue = {};
      for (const k of changedKeys) {
        previousValue[k] = priorFull?.[k] ?? null;
        newValue[k] = after?.[k] ?? null;
      }
      await insertAdminAuditLog(client, {
        actionType: 'evaluation_update',
        actorId: req.session.employeeId,
        targetEmployeeId: prior?.evaluatee_id ?? null,
        previousValue,
        newValue,
        reason: `평가 필드 변경(${changedKeys.join(', ')}) · 피평가자 ${prior?.evaluatee_name ?? prior?.evaluatee_id ?? ''}`,
      });
    }

    await client.query('COMMIT');
    res.json(after);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error updating evaluation:', err);
    res.status(err.statusCode ?? 500).json({ error: err.statusCode ? err.message : 'Database error' });
  } finally {
    client.release();
  }
});

app.delete('/api/evaluation/:id', requireHr, async (req, res) => {
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
    res.status(err.statusCode ?? 500).json({ error: err.statusCode ? err.message : 'Database error' });
  }
});
// 피평가자가 평가자에게 평가 반려를 요청 (알림만, status 변경 없음)
app.post('/api/evaluation/:id/return-request', guardEvaluationParam('id'), async (req, res) => {
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
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

// 평가자가 완료 평가를 피평가자에게 돌려보냄 → in-progress 로 전환해 피평가자 측 잠금 해제
// 피평가자 재제출 시 자동으로 submitted → evaluating 흐름으로 복귀
app.post('/api/evaluation/:id/reopen', guardEvaluationParam('id'), async (req, res) => {
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
            returned_at = NOW(),
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
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

// 평가자가 자기 완료 평가를 다시 열어 점수/피드백을 수정할 수 있는 단계(evaluating)로 되돌림
// 피평가자에게 알림 발송 없음 (평가자 자신만의 액션)
app.post('/api/evaluation/:id/reopen-for-evaluator', guardEvaluationParam('id'), async (req, res) => {
  if (!isDbAvailable) return sendDbUnavailable(res);
  const evaluationId = req.params.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `
        SELECT ev.id, ev.evaluation_status, ev.evaluatee_id,
               h.new_evaluator_id AS assigned_evaluator_id,
               e.evaluator_id AS current_evaluator_id
        FROM evaluations ev
        LEFT JOIN evaluator_assignment_history h ON h.id = ev.assignment_history_id
        LEFT JOIN employees e ON e.employee_id = ev.evaluatee_id
        WHERE ev.id = $1 AND COALESCE(ev.record_status, 'active') = 'active'
        LIMIT 1
      `,
      [evaluationId]
    );
    const evaluation = rows[0];
    if (!evaluation) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Evaluation not found' });
    }
    // 보안(P0): 담당 평가자/HR만 재오픈 가능 — 피평가자의 자기 완료평가 재오픈 차단.
    const reopenMe = req.session.employeeId;
    const reopenIsHr = await requesterIsHr(req).catch(() => false);
    const reopenIsEvaluator =
      String(evaluation.assigned_evaluator_id ?? '') === reopenMe ||
      String(evaluation.current_evaluator_id ?? '') === reopenMe;
    if (!reopenIsHr && !reopenIsEvaluator) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: '담당 평가자 또는 HR만 평가를 재오픈할 수 있습니다.' });
    }
    if (evaluation.evaluation_status !== 'completed') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Evaluation is not in completed state' });
    }
    await client.query(
      `
        UPDATE evaluations
        SET evaluation_status = 'evaluating',
            reverted_at = NOW(),
            last_modified = NOW(),
            updated_at = NOW()
        WHERE id = $1
      `,
      [evaluationId]
    );
    // 감사로그: 완료 평가 재오픈(상태 전이 고정) 기록.
    await insertAdminAuditLog(client, {
      actionType: 'evaluation_reopen',
      actorId: req.session.employeeId,
      targetEmployeeId: evaluation.evaluatee_id ?? null,
      previousValue: { evaluation_status: 'completed' },
      newValue: { evaluation_status: 'evaluating' },
      reason: `완료 평가 재오픈(completed→evaluating) · evaluation ${evaluationId}`,
    });
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error reopening evaluation for evaluator:', err);
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

// Get evaluations by status ('in-progress' or 'completed')
app.get('/api/evaluations/status/:status', requireHr, async (req, res) => {
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
app.get('/api/tasks/evaluation/:evaluationId', guardEvaluationParam('evaluationId', { allowLineDescendant: true }), async (req, res) => {
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
          t.evaluation_period_id,
          t.is_ai_task
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
        ORDER BY t.created_at ASC, t.id ASC
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
app.get('/api/tasks/current-year', requireHr, async (req, res) => {
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
          t.evaluation_period_id,
          t.is_ai_task
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
app.get('/api/task-evaluation-entries/evaluation/:evaluationId', guardEvaluationParam('evaluationId', { allowLineDescendant: true }), async (req, res) => {
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
// 보안(P0): 채점자 신원은 세션에서 파생한다. 비-HR은 '본인 명의' 엔트리만 기록 가능하고
// (본문 evaluator_id 신뢰 금지 — 점수 위조 차단), HR은 평가자 대리 입력을 위해 본문 값을 허용한다.
// guardTaskParam 으로 그 과업에 접근 권한 없는 사용자를 먼저 차단(방어심층).
app.put('/api/task-evaluation-entry', guardTaskParam('task_uuid', 'body'), async (req, res) => {
  if (!isDbAvailable) {
    return sendDbUnavailable(res);
  }

  const payload = normalizeTaskEvaluationEntryPayload(req.body);

  const isHr = await requesterIsHr(req).catch(() => false);
  if (!isHr) {
    const sessionId = req.session.employeeId;
    const { rows: selfRows } = await pool.query(
      'SELECT name FROM employees WHERE employee_id::text = $1 LIMIT 1',
      [sessionId],
    );
    payload.evaluator_id = sessionId;
    payload.evaluator_name = selfRows[0]?.name ?? payload.evaluator_name ?? sessionId;
  }

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

    // 감사로그용: upsert 전 동일 (task, 평가자) 활성 엔트리의 직전 값(old→new 비교 기준).
    const { rows: priorEntryRows } = await client.query(
      `SELECT score, contribution_method, contribution_scope, feedback
         FROM task_evaluation_entries
        WHERE task_uuid = $1 AND evaluator_id = $2`,
      [task.id, payload.evaluator_id]
    );
    const priorEntry = priorEntryRows[0] ?? null;

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

    // 감사로그: 점수/기여방식/기여범위/피드백이 실제로 바뀐 경우에만 who/when/old→new 기록.
    const savedEntry = rows[0];
    const entryChanged =
      !priorEntry ||
      priorEntry.score !== savedEntry.score ||
      priorEntry.contribution_method !== savedEntry.contribution_method ||
      priorEntry.contribution_scope !== savedEntry.contribution_scope ||
      (priorEntry.feedback ?? '') !== (savedEntry.feedback ?? '');
    if (entryChanged) {
      await insertAdminAuditLog(client, {
        actionType: 'evaluation_score_change',
        actorId: req.session.employeeId,
        targetEmployeeId: task.evaluatee_id ?? null,
        previousValue: priorEntry
          ? {
              score: priorEntry.score,
              contribution_method: priorEntry.contribution_method,
              contribution_scope: priorEntry.contribution_scope,
              feedback: priorEntry.feedback,
            }
          : null,
        newValue: {
          score: savedEntry.score,
          contribution_method: savedEntry.contribution_method,
          contribution_scope: savedEntry.contribution_scope,
          feedback: savedEntry.feedback,
        },
        reason: `과업 평가 ${priorEntry ? '수정' : '입력'} · 평가자 ${payload.evaluator_name}(${payload.evaluator_id}) · task ${task.task_id}`,
      });
    }

    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error upserting task evaluation entry:', err);
    res.status(err.statusCode ?? 500).json({ error: err.statusCode ? err.message : 'Database error' });
  } finally {
    client.release();
  }
});
// Phase 3: 평가 저장 시 그 항목의 AI 검수 결과(플래그·요약·해시)를 기록. 매 저장 덮어쓰기 →
// 경고 없이 통과하면 flagged=false 로 '이상없음' 갱신.
app.patch('/api/task-evaluation-entry/:id/ai-review', async (req, res) => {
  if (!isDbAvailable) return sendDbUnavailable(res);
  const id = req.params.id;
  const flagged = req.body?.flagged === true;
  const summary = normalizeOptionalText(req.body?.summary);
  const type = normalizeOptionalText(req.body?.type);
  const feedbackHash = normalizeOptionalText(req.body?.feedbackHash);
  try {
    // 보안(P0): 본인이 작성한 엔트리(또는 HR)만 그 AI 검수 결과를 기록/변경할 수 있다.
    const { rows: ownerRows } = await pool.query(
      `SELECT tee.evaluator_id, tee.ai_flagged, tee.ai_summary, tee.ai_type, ev.evaluatee_id
         FROM task_evaluation_entries tee
         LEFT JOIN evaluations ev ON ev.id = tee.evaluation_id
        WHERE tee.id = $1 LIMIT 1`,
      [id],
    );
    if (!ownerRows[0]) return res.status(404).json({ error: 'Entry not found' });
    const isHr = await requesterIsHr(req).catch(() => false);
    if (!isHr && String(ownerRows[0].evaluator_id ?? '') !== req.session.employeeId) {
      return res.status(403).json({ error: '해당 평가 항목에 접근할 권한이 없습니다.' });
    }
    const priorReview = ownerRows[0];
    const { rows } = await pool.query(
      `
        UPDATE task_evaluation_entries
        SET ai_flagged = $2, ai_summary = $3, ai_type = $4, ai_feedback_hash = $5, ai_reviewed_at = NOW()
        WHERE id = $1
        RETURNING id, ai_flagged
      `,
      [id, flagged, flagged ? summary : null, flagged ? type : null, feedbackHash]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Entry not found' });

    // 감사로그: 플래그가 걸려있거나 새로 걸리는 변경만 기록(매 저장 호출의 null/false 노이즈 차단). best-effort.
    const newFlagged = flagged;
    const newSummary = flagged ? summary : null;
    const newType = flagged ? type : null;
    const flagInvolved = newFlagged === true || priorReview.ai_flagged === true;
    const reviewChanged =
      flagInvolved &&
      ((priorReview.ai_flagged ?? null) !== (newFlagged ?? null) ||
        (priorReview.ai_summary ?? null) !== (newSummary ?? null) ||
        (priorReview.ai_type ?? null) !== (newType ?? null));
    if (reviewChanged) {
      try {
        await insertAdminAuditLog(pool, {
          actionType: 'ai_review_change',
          actorId: req.session.employeeId,
          targetEmployeeId: priorReview.evaluatee_id ?? null,
          previousValue: {
            ai_flagged: priorReview.ai_flagged ?? null,
            ai_summary: priorReview.ai_summary ?? null,
            ai_type: priorReview.ai_type ?? null,
          },
          newValue: { ai_flagged: newFlagged, ai_summary: newSummary, ai_type: newType },
          reason: `AI 검수 결과 변경 · entry ${id}`,
        });
      } catch (e) {
        console.error('audit log (ai_review_change) failed:', e.message);
      }
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Error saving AI review:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// 복붙 검수용 — 같은 평가자가 그 기간 '다른 피평가자'에게 쓴 피드백 모음(현재 평가 제외).
app.get('/api/evaluator-feedbacks', async (req, res) => {
  if (!isDbAvailable) return res.json([]);
  // 보안(P0): 비-HR은 '본인'이 쓴 피드백만 조회 가능(쿼리 evaluatorId 신뢰 금지 — 평가자 간 유출 차단).
  const requestedEvaluatorId =
    typeof req.query.evaluatorId === 'string' && req.query.evaluatorId.trim()
      ? req.query.evaluatorId.trim()
      : null;
  const feedbackIsHr = await requesterIsHr(req).catch(() => false);
  const evaluatorId = feedbackIsHr ? requestedEvaluatorId : req.session.employeeId;
  if (!evaluatorId) return res.json([]);
  const excludeEvaluationId =
    typeof req.query.excludeEvaluationId === 'string' && req.query.excludeEvaluationId.trim()
      ? req.query.excludeEvaluationId.trim()
      : null;
  try {
    const filter = await resolveEvaluationPeriodFilter(req.query, 2);
    const periodClause = filter.clause
      .replaceAll('evaluation_period_id', 'ev.evaluation_period_id')
      .replaceAll('evaluation_year', 'ev.evaluation_year');
    const excludeIdx = 2 + filter.values.length;
    const excludeClause = excludeEvaluationId ? `AND ev.id <> $${excludeIdx}` : '';
    const params = excludeEvaluationId
      ? [evaluatorId, ...filter.values, excludeEvaluationId]
      : [evaluatorId, ...filter.values];
    const { rows } = await pool.query(
      `
        SELECT DISTINCT btrim(tee.feedback) AS feedback
        FROM task_evaluation_entries tee
        JOIN evaluations ev ON ev.id = tee.evaluation_id
        WHERE COALESCE(tee.status, 'active') = 'active'
          AND tee.evaluator_id = $1
          AND tee.feedback IS NOT NULL AND btrim(tee.feedback) <> ''
          AND COALESCE(ev.record_status, 'active') = 'active'
          AND ${periodClause}
          ${excludeClause}
        LIMIT 100
      `,
      params
    );
    res.json(rows.map((r) => r.feedback));
  } catch (err) {
    console.error('Error fetching evaluator feedbacks:', err);
    res.json([]);
  }
});

// Phase 3: HR AI검수 롤업 — 그 기간 피드백 항목의 검수 현황(전체/검수완료/플래그) + 평가자별 +
// 플래그된 항목 목록. 평가자가 저장 시 쌓아둔 1차 결과만 읽는다(여기서 AI 재호출 없음).
app.get('/api/ai-reviews', requireHr, async (req, res) => {
  if (!isDbAvailable) return res.json({ total: 0, reviewed: 0, flagged: 0, byEvaluator: [], items: [] });
  try {
    const filter = await resolveEvaluationPeriodFilter(req.query);
    const periodClause = filter.clause
      .replaceAll('evaluation_period_id', 'ev.evaluation_period_id')
      .replaceAll('evaluation_year', 'ev.evaluation_year');
    const base = `
      FROM task_evaluation_entries tee
      JOIN evaluations ev ON ev.id = tee.evaluation_id
      WHERE COALESCE(tee.status, 'active') = 'active'
        AND tee.feedback IS NOT NULL AND btrim(tee.feedback) <> ''
        AND COALESCE(ev.record_status, 'active') = 'active'
        AND ${periodClause}
    `;
    const counts = await pool.query(
      `SELECT count(*)::int total,
              count(*) FILTER (WHERE tee.ai_reviewed_at IS NOT NULL)::int reviewed,
              count(*) FILTER (WHERE tee.ai_flagged IS TRUE)::int flagged
       ${base}`,
      filter.values
    );
    const byEvaluator = await pool.query(
      `SELECT tee.evaluator_name,
              count(*)::int total,
              count(*) FILTER (WHERE tee.ai_flagged IS TRUE)::int flagged
       ${base}
       GROUP BY tee.evaluator_name
       HAVING count(*) FILTER (WHERE tee.ai_flagged IS TRUE) > 0
       ORDER BY flagged DESC, total DESC
       LIMIT 50`,
      filter.values
    );
    const items = await pool.query(
      `SELECT tee.evaluation_id, ev.evaluatee_id, ev.evaluatee_name,
              tee.evaluator_name, t.title AS task_title, tee.ai_type, tee.ai_summary, tee.ai_reviewed_at,
              tee.task_uuid, tee.feedback
       FROM task_evaluation_entries tee
       JOIN evaluations ev ON ev.id = tee.evaluation_id
       LEFT JOIN tasks t ON t.id = tee.task_uuid
       WHERE COALESCE(tee.status, 'active') = 'active'
         AND tee.ai_flagged IS TRUE
         AND COALESCE(ev.record_status, 'active') = 'active'
         AND ${periodClause}
       ORDER BY tee.ai_reviewed_at DESC NULLS LAST
       LIMIT 300`,
      filter.values
    );
    res.json({
      total: counts.rows[0].total,
      reviewed: counts.rows[0].reviewed,
      flagged: counts.rows[0].flagged,
      byEvaluator: byEvaluator.rows,
      items: items.rows,
    });
  } catch (err) {
    console.error('Error fetching AI review rollup:', err);
    res.json({ total: 0, reviewed: 0, flagged: 0, byEvaluator: [], items: [] });
  }
});

// ============================================================
// 조회 시 재호출 없는 AI 결과물(요약·제안) 영속 저장소 — /api/ai-content
// 조회 때마다 AI를 돌리던 항목을 '트리거 시 1회 생성 → DB 저장 → 조회 시 그대로 출력'으로 전환.
// kind/scope_id 규약은 db_mig/add_ai_generated_content.sql 주석 참조. 생성은 클라이언트(/api/ai/chat),
// 여기서는 저장/조회만 하며 AI를 호출하지 않는다.
// ============================================================
const AI_CONTENT_KINDS = new Set([
  'evaluatee_feedback_summary',
  'evaluator_feedback_summary',
  'task_growth_suggestion',
  'evaluatee_growth_suggestion',
  'evaluatee_feedback_keywords',
  'evaluator_feedback_keywords',
]);

// 이 사용자가 해당 (kind, scopeId)를 읽기/쓰기할 수 있는지. HR은 전부 허용.
async function authorizeAiContent(req, kind, scopeId) {
  const me = req.session?.employeeId;
  if (!me) return false;
  if (await requesterIsHr(req).catch(() => false)) return true;
  const parts = String(scopeId).split(':');
  if (
    kind === 'evaluatee_feedback_summary' ||
    kind === 'evaluatee_growth_suggestion' ||
    kind === 'evaluatee_feedback_keywords'
  ) {
    // '<evaluatee_id>:<period_id>' — 본인(피평가자, 읽기) 또는 그 피평가자의 평가자(평가 저장 시 쓰기).
    // evaluations 엔 평가자 컬럼이 없어, 평가자 연결은 task_evaluation_entries.evaluator_id 로 판정한다
    // (평가 저장 시 엔트리가 먼저 생성되므로 저장 시점 쓰기 권한이 성립).
    if (parts[0] === me) return true;
    const { rows } = await pool.query(
      `SELECT 1
         FROM evaluations ev
         JOIN task_evaluation_entries tee
           ON tee.evaluation_id = ev.id
          AND COALESCE(tee.status, 'active') = 'active'
          AND tee.evaluator_id = $3
        WHERE ev.evaluatee_id = $1 AND ev.evaluation_period_id = $2
        LIMIT 1`,
      [parts[0], parts[1], me],
    );
    return rows.length > 0;
  }
  if (kind === 'evaluator_feedback_summary' || kind === 'evaluator_feedback_keywords') {
    // '<evaluator_id>:<evaluatee_id>:<period_id>' — 그 평가자만.
    return parts[0] === me;
  }
  if (kind === 'task_growth_suggestion') {
    // '<task_uuid>' — 그 과업의 피평가자(본인) 또는 평가자만.
    const { rows } = await pool.query(
      `SELECT 1
         FROM tasks t
         JOIN evaluations ev ON ev.id = t.evaluation_id
         LEFT JOIN task_evaluation_entries tee
           ON tee.task_uuid = t.id AND COALESCE(tee.status, 'active') = 'active'
        WHERE t.id = $1 AND (ev.evaluatee_id = $2 OR tee.evaluator_id = $2)
        LIMIT 1`,
      [parts[0], me],
    );
    return rows.length > 0;
  }
  return false;
}

// 배치 조회 — ?scopeIds=a,b,c (피평가자 과업 성장제안 일괄 로드 등). 1세그먼트 라우트.
app.get('/api/ai-content/:kind', async (req, res) => {
  if (!isDbAvailable) return res.json([]);
  const { kind } = req.params;
  if (!AI_CONTENT_KINDS.has(kind)) return res.status(400).json({ error: 'unknown kind' });
  if (!req.session?.employeeId) return res.status(401).json({ error: 'unauthorized' });
  const ids = String(req.query.scopeIds ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 200);
  if (ids.length === 0) return res.json([]);
  try {
    const allowed = [];
    for (const sid of ids) {
      if (await authorizeAiContent(req, kind, sid)) allowed.push(sid);
    }
    if (allowed.length === 0) return res.json([]);
    const { rows } = await pool.query(
      `SELECT scope_id, content, generated_at FROM ai_generated_content WHERE kind = $1 AND scope_id = ANY($2::text[])`,
      [kind, allowed],
    );
    res.json(rows);
  } catch (err) {
    console.error('ai-content batch get failed:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// 단건 조회 — 2세그먼트 라우트.
app.get('/api/ai-content/:kind/:scopeId', async (req, res) => {
  if (!isDbAvailable) return res.json(null);
  const { kind, scopeId } = req.params;
  if (!AI_CONTENT_KINDS.has(kind)) return res.status(400).json({ error: 'unknown kind' });
  if (!(await authorizeAiContent(req, kind, scopeId))) return res.status(403).json({ error: 'forbidden' });
  try {
    const { rows } = await pool.query(
      `SELECT content, generated_at, generated_by FROM ai_generated_content WHERE kind = $1 AND scope_id = $2 LIMIT 1`,
      [kind, scopeId],
    );
    res.json(rows[0] ?? null);
  } catch (err) {
    console.error('ai-content get failed:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// 생성/갱신(upsert) — 본인 소유 scope 만.
app.put('/api/ai-content/:kind/:scopeId', async (req, res) => {
  if (!isDbAvailable) return sendDbUnavailable(res);
  const { kind, scopeId } = req.params;
  if (!AI_CONTENT_KINDS.has(kind)) return res.status(400).json({ error: 'unknown kind' });
  if (!(await authorizeAiContent(req, kind, scopeId))) return res.status(403).json({ error: 'forbidden' });
  const content = normalizeOptionalText(req.body?.content);
  if (!content) return res.status(400).json({ error: 'content required' });
  const meta = req.body?.meta && typeof req.body.meta === 'object' ? req.body.meta : null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO ai_generated_content (kind, scope_id, content, generated_by, meta, generated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (kind, scope_id)
       DO UPDATE SET content = EXCLUDED.content, generated_by = EXCLUDED.generated_by, meta = EXCLUDED.meta, generated_at = now()
       RETURNING content, generated_at, generated_by`,
      [kind, scopeId, content, req.session.employeeId, meta],
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('ai-content put failed:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// 자연어 인물검색(HR 전용) — 클라이언트가 질의를 AI로 키워드 파싱한 뒤 호출. 여기서는 SQL 검색만(LLM 호출 없음).
// 피드백 본문(tee.feedback)을 키워드로 매칭해 평가대상별로 집계·랭킹하고, 그 인물의 AI 키워드를 첨부한다.
// periodIds(다중) 범위로 한정. ILIKE 패턴은 LLM이 만든 한국어 명사라 와일드카드 위험 낮음.
app.post('/api/people-search', requireHr, async (req, res) => {
  if (!isDbAvailable) return res.json([]);
  const rawKeywords = Array.isArray(req.body?.keywords) ? req.body.keywords : [];
  const keywords = [
    ...new Set(rawKeywords.map((k) => String(k).trim()).filter((k) => k.length >= 1 && k.length <= 40)),
  ].slice(0, 12);
  const rawPeriods = Array.isArray(req.body?.periodIds) ? req.body.periodIds : [];
  const periodIds = [...new Set(rawPeriods.map((p) => String(p).trim()).filter(Boolean))].slice(0, 20);
  if (keywords.length === 0 || periodIds.length === 0) return res.json([]);
  try {
    const { rows } = await pool.query(
      `WITH kw AS (SELECT DISTINCT trim(t) AS term FROM unnest($1::text[]) AS t WHERE trim(t) <> ''),
       fb AS (
         SELECT ev.evaluatee_id AS emp,
                count(DISTINCT kw.term) AS kw_hits,
                count(*)::int AS fb_hits,
                array_agg(DISTINCT kw.term) AS terms,
                (array_agg(left(tee.feedback, 160) ORDER BY tee.score DESC NULLS LAST))[1:3] AS snippets,
                round(avg(tee.score)::numeric, 1) AS avg_score
           FROM kw
           JOIN task_evaluation_entries tee
             ON tee.feedback ILIKE '%' || kw.term || '%'
            AND COALESCE(tee.status, 'active') = 'active'
            AND COALESCE(tee.feedback, '') <> ''
           JOIN tasks t ON t.id = tee.task_uuid
           JOIN evaluations ev ON ev.id = t.evaluation_id
          WHERE ev.evaluation_period_id::text = ANY($2::text[])
          GROUP BY ev.evaluatee_id
       )
       SELECT fb.emp AS employee_id, e.name, e.department,
              e.org_corporation, e.org_division, e.org_department, e.org_team,
              fb.kw_hits::int AS kw_hits, fb.fb_hits, fb.terms, fb.snippets, fb.avg_score,
              kwc.content AS ai_keywords
         FROM fb
         JOIN employees e ON e.employee_id = fb.emp
         LEFT JOIN LATERAL (
           SELECT content FROM ai_generated_content agc
            WHERE agc.kind = 'evaluatee_feedback_keywords'
              AND split_part(agc.scope_id, ':', 1) = fb.emp
              AND split_part(agc.scope_id, ':', 2) = ANY($2::text[])
            ORDER BY agc.generated_at DESC LIMIT 1
         ) kwc ON true
        ORDER BY fb.kw_hits DESC, fb.fb_hits DESC, e.name
        LIMIT 25`,
      [keywords, periodIds],
    );
    res.json(rows);
  } catch (err) {
    console.error('people-search failed:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// 감사로그(F-1) 조회 — HR 전용. 점수·평가자·상태·과업·AI플래그 변경의 who/when/old→new.
// 필터(target/actor/actionType/from/to)는 전부 파라미터 바인딩, 정렬·LIMIT 은 고정/검증되어 주입 불가.
app.get('/api/audit-logs', requireHr, async (req, res) => {
  if (!isDbAvailable) return sendDbUnavailable(res);
  try {
    const trim = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const target = trim(req.query.target);
    const actor = trim(req.query.actor);
    const actionType = trim(req.query.actionType);
    const from = trim(req.query.from);
    const to = trim(req.query.to);

    const rawLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;
    const rawOffset = Number.parseInt(req.query.offset, 10);
    const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;

    const conditions = [];
    const params = [];
    if (target) { params.push(target); conditions.push(`a.target_employee_id = $${params.length}`); }
    if (actor) { params.push(actor); conditions.push(`a.actor_id = $${params.length}`); }
    if (actionType) { params.push(actionType); conditions.push(`a.action_type = $${params.length}`); }
    if (from) { params.push(from); conditions.push(`a.created_at >= $${params.length}::timestamptz`); }
    if (to) { params.push(to); conditions.push(`a.created_at <= $${params.length}::timestamptz`); }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM admin_audit_logs a ${whereClause}`,
      params
    );
    const total = countResult.rows[0]?.total ?? 0;

    const rowsResult = await pool.query(
      `SELECT a.id, a.action_type, a.actor_id, a.target_employee_id,
              a.previous_value, a.new_value, a.reason, a.created_at,
              actor.name AS actor_name,
              target.name AS target_employee_name
         FROM admin_audit_logs a
         LEFT JOIN employees actor ON actor.employee_id = a.actor_id
         LEFT JOIN employees target ON target.employee_id = a.target_employee_id
         ${whereClause}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    // action_type 목록은 필터 드롭다운용 — 페이지마다 재계산할 필요 없어 첫 페이지에서만 조회(클라가 캐시).
    const actionTypes =
      offset === 0
        ? (
            await pool.query('SELECT DISTINCT action_type FROM admin_audit_logs ORDER BY action_type')
          ).rows.map((r) => r.action_type)
        : [];

    res.json({
      rows: rowsResult.rows,
      total,
      limit,
      offset,
      actionTypes,
    });
  } catch (err) {
    // 잘못된 from/to 날짜 문자열 → pg 가 22007/22008 throw. 500 대신 400 으로 명확히 응답.
    if (err.code === '22007' || err.code === '22008') {
      return res.status(400).json({ error: '잘못된 날짜 형식입니다(from/to).' });
    }
    console.error('Error fetching audit logs:', err);
    res.status(500).json({ error: 'Database error' });
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
    res.status(err.statusCode ?? 500).json({ error: err.statusCode ? err.message : 'Database error' });
  }
});

// ==================== Task Update / Delete Routes ====================

// Update an existing task (partial update)
app.put('/api/task/:id', guardTaskParam('id'), async (req, res) => {
  try {
    const bypassCompletedLock = req.query?.past === '1' || req.query?.past === 'true';
    await assertTaskWritableById(req.params.id);
    const updates = req.body;
    if (hasTaskStructureChanges(updates)) {
      await assertTaskStructureEditableById(req.params.id, { bypassCompletedLock });
    }
    if (hasTaskEvaluationContentChanges(updates)) {
      await assertTaskEvaluationEditableById(req.params.id);
      // 보안(P0): 점수·피드백 등 평가 내용은 담당 평가자/HR만 수정 가능 —
      // 피평가자가 자기 과업에 점수를 직접 써넣는 위조 경로 차단(채점 정식 경로는 entry 엔드포인트).
      const { rows: contentOwnerRows } = await pool.query(
        `SELECT h.new_evaluator_id AS assigned_evaluator_id, e.evaluator_id AS current_evaluator_id
           FROM tasks t
           JOIN evaluations ev ON ev.id = t.evaluation_id
           LEFT JOIN evaluator_assignment_history h ON h.id = ev.assignment_history_id
           LEFT JOIN employees e ON e.employee_id = ev.evaluatee_id
          WHERE t.id::text = $1`,
        [String(req.params.id)],
      );
      const contentOwner = contentOwnerRows[0];
      const meId = req.session.employeeId;
      const isAssignedEvaluator =
        contentOwner &&
        (String(contentOwner.assigned_evaluator_id ?? '') === meId ||
          String(contentOwner.current_evaluator_id ?? '') === meId);
      if (contentOwner && !isAssignedEvaluator && !(await requesterIsHr(req).catch(() => false))) {
        return res.status(403).json({ error: '평가 점수·피드백은 담당 평가자만 수정할 수 있습니다.' });
      }
    }

    const setClauses = [];
    const values = [];
    const auditDbKeys = [];
    let idx = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) continue; // skip undefined
      // Translate key if needed
      const dbKey = TASK_FIELD_MAP[key] ?? key;
      // Skip attempts to modify a non-existent updated_at column
      if (dbKey === 'updated_at') continue;
      // 보안(P0): 허용된 과업 컬럼만 수정(임의 컬럼/식별자 인젝션·mass-assignment 차단).
      if (
        !TASK_STRUCTURE_FIELDS.has(key) && !TASK_STRUCTURE_FIELDS.has(dbKey) &&
        !TASK_EVALUATION_FIELDS.has(key) && !TASK_EVALUATION_FIELDS.has(dbKey)
      ) {
        continue;
      }
      setClauses.push(`${dbKey} = $${idx}`);
      values.push(value);
      auditDbKeys.push(dbKey);
      idx++;
    }

    if (setClauses.length === 0) {
      console.warn('?좑툘 No valid fields provided for task update.');
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Use the raw task ID (UUID string) as provided
    const taskId = req.params.id;

    // 감사로그용 직전 스냅샷(+피평가자) — 비트랜잭션 라우트라 변경 직전에 조회.
    const { rows: priorTaskRows } = await pool.query(
      `SELECT t.*, ev.evaluatee_id, ev.evaluatee_name
         FROM tasks t LEFT JOIN evaluations ev ON ev.id = t.evaluation_id
        WHERE t.id = $1`,
      [taskId],
    );
    const priorTask = priorTaskRows[0] ?? null;

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

    // 감사로그: 실제로 바뀐 과업 컬럼만 old→new 기록(점수·피드백·구조 등). best-effort(본 작업 비차단).
    const newTask = rows[0];
    const changedTaskKeys = auditDbKeys.filter(
      (k) => JSON.stringify(priorTask?.[k] ?? null) !== JSON.stringify(newTask?.[k] ?? null),
    );
    if (changedTaskKeys.length > 0) {
      const previousValue = {};
      const newValue = {};
      for (const k of changedTaskKeys) {
        previousValue[k] = priorTask?.[k] ?? null;
        newValue[k] = newTask?.[k] ?? null;
      }
      try {
        await insertAdminAuditLog(pool, {
          actionType: 'task_update',
          actorId: req.session.employeeId,
          targetEmployeeId: priorTask?.evaluatee_id ?? null,
          previousValue,
          newValue,
          reason: `과업 수정(${changedTaskKeys.join(', ')}) · task ${priorTask?.task_id ?? taskId}`,
        });
      } catch (e) {
        console.error('audit log (task_update) failed:', e.message);
      }
    }

    res.json(newTask);
  } catch (err) {
    console.error('Error updating task:', err);
    res.status(err.statusCode ?? 500).json({ error: err.statusCode ? err.message : 'Database error' });
  }
});

// Soft?멶elete a task (set deleted_at timestamp) ??PATCH endpoint
app.patch('/api/task/:id', guardTaskParam('id'), async (req, res) => {
  try {
    const bypassCompletedLock = req.query?.past === '1' || req.query?.past === 'true';
    await assertTaskWritableById(req.params.id);
    await assertTaskStructureEditableById(req.params.id, { bypassCompletedLock });
    // 감사로그용 직전 스냅샷(+피평가자).
    const { rows: priorRows } = await pool.query(
      `SELECT t.task_id, t.title, t.weight, t.score, ev.evaluatee_id
         FROM tasks t LEFT JOIN evaluations ev ON ev.id = t.evaluation_id
        WHERE t.id = $1`,
      [req.params.id],
    );
    const priorTask = priorRows[0] ?? null;
    const { rowCount } = await pool.query(
      'UPDATE tasks SET deleted_at = NOW() WHERE id = $1',
      [req.params.id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    // 감사로그: 과업 소프트삭제(best-effort).
    try {
      await insertAdminAuditLog(pool, {
        actionType: 'task_soft_delete',
        actorId: req.session.employeeId,
        targetEmployeeId: priorTask?.evaluatee_id ?? null,
        previousValue: priorTask
          ? { task_id: priorTask.task_id, title: priorTask.title, weight: priorTask.weight, score: priorTask.score }
          : null,
        newValue: null,
        reason: `과업 소프트삭제 · task ${priorTask?.task_id ?? req.params.id}`,
      });
    } catch (e) {
      console.error('audit log (task_soft_delete) failed:', e.message);
    }
    // Soft?멶elete successful
    res.json({ success: true });
  } catch (err) {
    console.error('Error soft deleting task:', err);
    res.status(err.statusCode ?? 500).json({ error: err.statusCode ? err.message : 'Database error' });
  }
});

// Hard delete a task (remove task and related feedback) ??retained for legacy use
app.delete('/api/task/:id', guardTaskParam('id'), async (req, res) => {
  try {
    const bypassCompletedLock = req.query?.past === '1' || req.query?.past === 'true';
    await assertTaskWritableById(req.params.id);
    await assertTaskStructureEditableById(req.params.id, { bypassCompletedLock });
    // 1. Retrieve the task to obtain its human?몉eadable task_id (+ 피평가자, 감사로그용)
    const taskResult = await pool.query(
      `SELECT t.task_id, ev.evaluatee_id
         FROM tasks t LEFT JOIN evaluations ev ON ev.id = t.evaluation_id
        WHERE t.id = $1`,
      [req.params.id]
    );
    if (taskResult.rowCount === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    const taskId = taskResult.rows[0].task_id;
    const evaluateeId = taskResult.rows[0].evaluatee_id ?? null;

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
    // 감사로그: 과업 하드삭제 — 삭제된 행 전체를 previous_value 로 보존(best-effort).
    try {
      await insertAdminAuditLog(pool, {
        actionType: 'task_delete',
        actorId: req.session.employeeId,
        targetEmployeeId: evaluateeId,
        previousValue: rows[0],
        newValue: null,
        reason: `과업 하드삭제 · task ${taskId}`,
      });
    } catch (e) {
      console.error('audit log (task_delete) failed:', e.message);
    }
    // Deletion successful
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting task:', err);
    res.status(err.statusCode ?? 500).json({ error: err.statusCode ? err.message : 'Database error' });
  }
});

/* ==================== Feedback Routes ==================== */

app.get('/api/feedbacks', requireHr, async (req, res) => {
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

app.get('/api/feedback/:id', guardFeedbackParam('id'), async (req, res) => {
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

app.post('/api/feedback', guardTaskParam('task_id', 'body'), async (req, res) => {
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
    res.status(err.statusCode ?? 500).json({ error: err.statusCode ? err.message : 'Database error' });
  }
});

app.delete('/api/feedback/:id', requireHr, async (req, res) => {
  try {
    await assertFeedbackWritableById(req.params.id);
    const { rowCount } = await pool.query('DELETE FROM feedback_history WHERE id = $1', [req.params.id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Feedback not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting feedback:', err);
    res.status(err.statusCode ?? 500).json({ error: err.statusCode ? err.message : 'Database error' });
  }
});
// Get feedback history by task ID
app.get('/api/feedbacks/task/:taskId', guardTaskParam('taskId'), async (req, res) => {
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
// 한 피평가자의 모든 과업 피드백을 일괄 조회 (N+1 제거: 평가 화면이 과업당 조회 대신 1회).
// 필터는 task별 엔드포인트와 동일(활성 피드백 + 활성/취소-아닌 평가). 접근제어=직원평가 가드.
app.get('/api/feedbacks/employee/:employeeId', guardEmployeeEvaluationsParam('employeeId'), async (req, res) => {
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
        WHERE fh.task_id IN (
          SELECT t.task_id
          FROM tasks t
          JOIN evaluations te ON te.id = t.evaluation_id
          WHERE te.evaluatee_id = $1
        )
          AND COALESCE(fh.status, 'active') = 'active'
          AND (ev.id IS NULL OR COALESCE(ev.record_status, 'active') = 'active')
          AND h.id IS NULL
        ORDER BY fh.created_at DESC
      `,
      [req.params.employeeId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching feedbacks by employee:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

/* ==================== Notification Routes ==================== */

app.get('/api/notifications', async (req, res) => {
  try {
    const requested = normalizeOptionalText(req.query?.recipientId ?? req.query?.recipient_id);
    // 비HR은 본인 알림만 — 쿼리의 recipient 를 무시하고 세션 사번으로 강제한다.
    const recipientId = (await requesterIsHr(req)) ? requested : req.session.employeeId;
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
  const requested = normalizeOptionalText(req.query?.recipientId ?? req.body?.recipientId);
  // 비HR은 본인 것만 일괄 읽음 처리.
  const recipientId = (await requesterIsHr(req).catch(() => false)) ? requested : req.session.employeeId;
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
  const requested = normalizeOptionalText(req.query?.recipientId ?? req.body?.recipientId);
  // 본인 알림 비우기 흐름이므로 HR 전용이 아님 — 비HR은 본인 것만 삭제 가능.
  const recipientId = (await requesterIsHr(req).catch(() => false)) ? requested : req.session.employeeId;
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

app.get('/api/notification/:id', guardNotificationParam('id'), async (req, res) => {
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

    // 보안(P0): 직원 자동생성 로직 제거 — 임의 사번으로 직원 디렉터리를 오염시키던 경로 차단.
    // 발신자 신원은 세션에서 강제한다(본문 sender_id 신뢰 금지 → 알림 발신 사칭 차단).
    // 세션 사번은 실재 직원이므로 별도 존재 확인/생성이 필요 없다.
    const effectiveSenderId = req.session.employeeId;

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
    // 보안(P0): 컬럼 화이트리스트 명시 — 동적 키 보간(식별자 인젝션)·mass-assignment 제거.
    const { rows } = await pool.query(
      `INSERT INTO notifications (
         notification_type, title, message, priority,
         sender_id, sender_name, recipient_id,
         related_evaluation_id, related_task_id, is_read
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false) RETURNING *`,
      [
        notification_type,
        title,
        sanitizedMessage,
        priority,
        effectiveSenderId,
        sender_name ?? '시스템',
        recipient_id,
        req.body.related_evaluation_id,
        req.body.related_task_id,
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error creating notification:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.put('/api/notification/:id/read', guardNotificationParam('id'), async (req, res) => {
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

app.delete('/api/notification/:id', guardNotificationParam('id'), async (req, res) => {
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

// settings 읽기: 'system'(공유: FAQ·매트릭스 등)은 로그인 사용자 누구나, 개인 설정은 본인·HR.
const requireSettingsRead = async (req, res, next) => {
  const target = String(req.params?.userId ?? '');
  if (target === 'system' || target === req.session.employeeId) return next();
  try {
    if (await requesterIsHr(req)) return next();
  } catch (err) {
    console.error('설정 읽기 권한 확인 실패:', err.message);
    return res.status(500).json({ error: '권한 확인 중 오류가 발생했습니다.' });
  }
  return res.status(403).json({ error: '해당 설정에 접근할 권한이 없습니다.' });
};

// settings 쓰기/삭제: 본인 설정이거나 HR(system·타인 포함). 피평가자의 시스템 설정 조작 차단.
const requireSettingsWrite = async (req, res, next) => {
  const target = String(req.body?.user_id ?? req.params?.userId ?? '');
  if (target && target === req.session.employeeId) return next();
  try {
    if (await requesterIsHr(req)) return next();
  } catch (err) {
    console.error('설정 쓰기 권한 확인 실패:', err.message);
    return res.status(500).json({ error: '권한 확인 중 오류가 발생했습니다.' });
  }
  return res.status(403).json({ error: '해당 설정을 변경할 권한이 없습니다.' });
};

app.get('/api/settings/:userId/:type', requireSettingsRead, async (req, res) => {
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

app.get('/api/settings/:userId', requireSettingsRead, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM settings WHERE user_id = $1', [req.params.userId]);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching user settings:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/setting', requireSettingsWrite, async (req, res) => {
  try {
    const { user_id, setting_type, setting_data } = req.body ?? {};
    if (!user_id || !setting_type || setting_data === undefined) {
      return res.status(400).json({ error: 'user_id, setting_type, setting_data가 필요합니다.' });
    }
    // node-pg는 배열 파라미터를 JSON이 아닌 Postgres 배열 리터럴로 직렬화하므로,
    // 루트가 배열인 payload(평가 매트릭스 등)는 jsonb 바인딩이 invalid input syntax로 실패한다.
    // 항상 문자열화해 jsonb로 캐스팅한다(객체·배열·스칼라 모두 안전).
    const { rows } = await pool.query(
      `INSERT INTO settings (user_id, setting_type, setting_data, updated_at)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (user_id, setting_type) DO UPDATE
       SET setting_data = EXCLUDED.setting_data,
           updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [user_id, setting_type, JSON.stringify(setting_data), new Date().toISOString()]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error upserting setting:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.delete('/api/setting/:userId/:type', requireSettingsWrite, async (req, res) => {
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

app.put('/api/prompt/:key', requireHr, async (req, res) => {
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

app.delete('/api/prompt/:key', requireHr, async (req, res) => {
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
app.get('/api/evaluator-qna-logs', requireHr, async (req, res) => {
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
/* ==================== Static SPA (production) ==================== */
// 프런트 빌드물(dist)을 같은 서버에서 서빙한다. dist 가 있을 때만 활성화하므로
// 로컬 dev(vite 5173 + 이 서버 5000 분리)에는 영향이 없다. Render 등 단일 서비스 배포용.
// 모든 /api 라우트 정의 뒤에 위치해야 한다(API 가 먼저 매칭되도록).
const distPath = path.resolve(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  // 정적 자산(해시 파일명)은 장기 캐시, index.html 은 캐시 금지(새 배포 즉시 반영).
  app.use(express.static(distPath, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));

  // SPA 폴백: /api 가 아닌 GET 요청은 index.html 로 돌려 클라이언트 라우팅에 맡긴다.
  // Express 5 는 '*' 문자열 라우트를 못 쓰므로 경로 없는 미들웨어로 처리한다.
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
  console.log('[static] dist 서빙 활성화 (단일 서비스 모드)');
} else {
  console.log('[static] dist 없음 — API 전용 모드 (프런트는 vite dev 서버)');
}

/* ==================== Server Start ==================== */

const PORT = Number(process.env.PORT) || 5000;
app.listen(PORT, () => {
  console.log(`?윟 API server listening on http://localhost:${PORT}`);
});

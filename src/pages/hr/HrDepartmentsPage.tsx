import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download, X } from 'lucide-react';
import PageHeader from '@/components/Layout/PageHeader';
import { LoadingState } from '@/components/ui/state-views';
import { IconSearch, Pill } from '@/components/brand';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useCompanyDashboardRecords } from '@/hooks/useDashboardRecords';
import { useSharedOrgFilter } from '@/hooks/useSharedOrgFilter';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import OrgChecklist from '@/components/hr/OrgChecklist';
import {
  getOrgValue,
  matchesOrgNodes,
  ORG_LEVEL_LABELS,
  ORG_LEVELS,
  orgFieldsFromEvaluation,
  type OrgLevel,
} from '@/lib/orgHierarchy';
import type { EmployeeEvaluationRecord } from '@/lib/dashboardData';
import { isFinalizedEvaluationStatus } from '@/lib/evaluationStatus';
import { employeeService } from '@/lib/services';
import type { Employee } from '@/types';
import {
  downloadDepartmentMembersWorkbook,
  downloadOrgResultWorkbook,
  type DepartmentExportMember,
  type OrgResultRow,
} from '@/utils/hrDataExport';
import {
  MIN_SAMPLE,
  emptyBuckets,
  sampleStdDev,
  toValidSample,
  type ValidSample,
} from '@/lib/orgStats';

type SortKey =
  | 'completion-asc'
  | 'completion-desc'
  | 'achievement-desc'
  | 'achievement-asc'
  | 'score-desc'
  | 'score-asc'
  | 'name-asc';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'completion-asc', label: '완료율 낮은 순' },
  { value: 'completion-desc', label: '완료율 높은 순' },
  { value: 'achievement-desc', label: '목표달성률 높은 순' },
  { value: 'achievement-asc', label: '목표달성률 낮은 순' },
  { value: 'score-desc', label: '평균 점수 높은 순' },
  { value: 'score-asc', label: '평균 점수 낮은 순' },
  { value: 'name-asc', label: '부서명 가나다순' },
];

// 완료 판정 단일 기준(src/lib/evaluationStatus.ts) — 완료 = 평가자 확정(completed/locked).
const isEvaluationFinalized = (record: EmployeeEvaluationRecord) =>
  isFinalizedEvaluationStatus(record.reviewStatus);

// 그룹핑·필터·표 org 표시는 '그 평가 기간'의 조직 기준(evaluatee_org_*), 없으면 현재 employee.org_* 폴백.
const recordOrg = (record: EmployeeEvaluationRecord) =>
  orgFieldsFromEvaluation(record.evaluation, record.employee);

// 카드 집계 단위 — 본부 > 부 > 팀 중 선택.
const GROUP_LEVELS: OrgLevel[] = ['division', 'department', 'team'];

// 그룹(부서) 대상자들의 평가자 전원(중복 제거).
// 평가자는 반드시 '그룹에 잡힌 그 평가(record.evaluation)'의 평가자에서 가져온다 — 그래야
// 그룹핑 조직(평가 스냅샷)과 평가자가 한 평가에서 나와 일관된다. 직원 마스터 evaluator_id
// (전 기간 통틀어 최신)로 잡으면, 발령으로 다른 팀으로 옮겨간 사람의 '현재 평가자'가 옛 팀
// 카드에 섞여 들어오므로(예: 인사팀으로 이동한 사람의 평가자가 인사기획팀 카드에) 쓰지 않는다.
// 평가의 latest-applied 평가자라 같은 평가 안의 이전(발령 전) 평가자는 이미 제외된 값이다.
// 정렬: 담당 인원 많은 평가자 먼저, 동률은 가나다순.
const groupEvaluatorNames = (
  members: EmployeeEvaluationRecord[],
  nameById: Map<string, string>,
): string[] => {
  if (!members.length) return [];
  const counts = new Map<string, number>();
  for (const m of members) {
    const evId = m.evaluation?.evaluator_id ?? '';
    const name = m.evaluation?.evaluator_name ?? (evId ? nameById.get(evId) ?? evId : '');
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
    .map(([name]) => name);
};

const HrDepartmentsPage = () => {
  const { records, isLoading, error } = useCompanyDashboardRecords();
  const { selectedPeriodId, selectedPeriod } = useEvaluationPeriod();
  const { toast } = useToast();
  const [openDepartment, setOpenDepartment] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const deptParam = searchParams.get('dept');
  const consumedDeptParam = useRef(false);
  const openParam = searchParams.get('open');
  const lvlParam = searchParams.get('lvl');
  const consumedOpenParam = useRef(false);
  const [searchQuery, setSearchQuery] = useState('');
  // 대시보드에서 ?dept=로 들어온 부서 필터(레코드 단위, 그룹핑과 무관). 칩으로 해제 가능.
  const [deptFilter, setDeptFilter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('completion-asc');
  const [orgNodeKeys, setOrgNodeKeys] = useSharedOrgFilter(selectedPeriodId);
  const [groupLevel, setGroupLevel] = useState<OrgLevel>('team');
  const [groupBySection, setGroupBySection] = useState(true); // 상위조직 섹션으로 묶기
  const groupLabel = ORG_LEVEL_LABELS[groupLevel]; // 본부 / 부 / 팀

  // 평가자 사번 → 이름 해석 맵. 평가의 evaluator_name 이 비면 사번 대신 이 맵으로 이름을 보여준다.
  // records(평가대상자)만으로는 평가자(피평가자 아님)가 빠질 수 있어 전체 직원으로 보강한다.
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  useEffect(() => {
    let cancelled = false;
    employeeService
      .getAllEmployees()
      .then((list) => {
        if (!cancelled) setAllEmployees(list);
      })
      .catch(() => {
        /* 실패 시 records 기반 맵으로 폴백 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const empNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of records) map.set(r.employee.employee_id, r.employee.name);
    for (const e of allEmployees) map.set(e.employee_id, e.name);
    return map;
  }, [records, allEmployees]);

  const filteredRecords = useMemo(
    () =>
      records.filter(
        (r) =>
          // 선택 기간에 평가가 있는 사람만(그 기간 평가 대상). 26년 발령자가 25년 화면에
          // 현재 부서 기준으로 잡히던 문제 해소. (전사현황 부서 바와 동일 기준)
          r.evaluation != null &&
          matchesOrgNodes(recordOrg(r), orgNodeKeys) &&
          (!deptFilter || ((r.evaluation?.evaluatee_department || r.employee.department) || '미지정') === deptFilter),
      ),
    [records, orgNodeKeys, deptFilter],
  );

  // 선택한 집계 단위의 조직 값으로 그룹 키 + 그 키가 실제 속한 레벨을 만든다.
  // 그룹 키 = 선택 레벨까지의 압축 조직경로(빈 레벨은 건너뜀)를 " › "로 이은 문자열.
  // 전사현황 부서 바(deptPathOf)와 동일 규칙이라, 바 클릭 시 ?open 키가 이 키와 정확히 일치한다.
  // 동명이부서(예: OK 인사팀 vs OKH 인사팀)는 상위경로가 달라 키가 갈린다.
  // 팀이 비어 선택 레벨보다 얕게 묶이면(예: 팀단위 보기인데 팀이 없는 부 직속) 압축경로 말단(부)으로 묶인다.
  // level = 압축경로 말단 레벨(구멍이 있으면 선택 레벨보다 얕을 수 있음). 아무 조직도 없으면 레거시 department → '미지정'.
  const groupStartIdx = ORG_LEVELS.indexOf(groupLevel);
  const resolveGroup = (
    record: EmployeeEvaluationRecord,
  ): { key: string; level: OrgLevel | null; label: string } => {
    const path: string[] = [];
    let deepest: OrgLevel | null = null;
    for (let i = 0; i <= groupStartIdx; i += 1) {
      const value = getOrgValue(recordOrg(record), ORG_LEVELS[i]);
      if (value) {
        path.push(value);
        deepest = ORG_LEVELS[i];
      }
    }
    if (path.length > 0) {
      return { key: path.join(' › '), level: deepest, label: path[path.length - 1] };
    }
    const legacyDept = record.evaluation?.evaluatee_department || record.employee.department;
    if (legacyDept) {
      return { key: legacyDept, level: null, label: legacyDept };
    }
    return { key: '미지정', level: null, label: '미지정' };
  };

  // 상위 조직 경로(선택 레벨보다 위 레벨들)를 사람이 읽는 문자열로. 예) 부 조회 시 "경영지원본부".
  const parentLevels = ORG_LEVELS.slice(0, groupStartIdx);
  const parentPathOf = (record: EmployeeEvaluationRecord) =>
    parentLevels
      .map((level) => getOrgValue(recordOrg(record), level))
      .filter(Boolean)
      .join(' › ');

  const recordsByDepartment = useMemo(() => {
    const map = new Map<string, EmployeeEvaluationRecord[]>();
    for (const record of filteredRecords) {
      const key = resolveGroup(record).key;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(record);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredRecords, groupLevel]);

  // 대시보드 등에서 ?dept=<부서명> 으로 들어오면 그 부서로 필터(레코드 단위 department 필드)를 걸어
  // 해당 부서 카드만 보이게 한다(1회). 페이지는 조직계층으로 그룹핑하지만 대시보드는 레거시
  // department로 그룹핑하므로, 그룹 키가 아니라 department 필드로 매칭해야 일치한다.
  useEffect(() => {
    if (!deptParam || consumedDeptParam.current) return;
    const exists = records.some((r) => (r.employee.department || '미지정') === deptParam);
    if (exists) {
      setDeptFilter(deptParam);
      consumedDeptParam.current = true;
      const next = new URLSearchParams(searchParams);
      next.delete('dept');
      setSearchParams(next, { replace: true });
    }
  }, [deptParam, records, searchParams, setSearchParams]);

  // 대시보드 부서 바 클릭: 필터는 그대로(공유), 전달된 레벨로 그룹핑을 맞추고 그 카드를 연다(1회).
  useEffect(() => {
    if (!openParam || consumedOpenParam.current) return;
    consumedOpenParam.current = true;
    if (lvlParam && (ORG_LEVELS as readonly string[]).includes(lvlParam)) {
      setGroupLevel(lvlParam as OrgLevel);
    }
    setOpenDepartment(openParam);
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    next.delete('lvl');
    setSearchParams(next, { replace: true });
  }, [openParam, lvlParam, searchParams, setSearchParams]);

  const openDepartmentRecords = openDepartment
    ? (recordsByDepartment.get(openDepartment) ?? []).slice().sort((a, b) => {
        // 평가 미확정 우선, 그 다음 직급순.
        const aFinal = isEvaluationFinalized(a);
        const bFinal = isEvaluationFinalized(b);
        if (aFinal && !bFinal) return 1;
        if (!aFinal && bFinal) return -1;
        return a.employee.name.localeCompare(b.employee.name);
      })
    : [];

  const departments = useMemo(
    () =>
      Object.values(
        filteredRecords.reduce<
          Record<
            string,
            {
              groupKey: string;
              name: string;
              totalMembers: number;
              finalizedMembers: number;
              achievedMembers: number;
              totalProgress: number;
              finalizedScoreSum: number;
              scoreCounts: Record<1 | 2 | 3 | 4, number>;
              parentCounts: Record<string, number>;
              levelCounts: Record<string, number>;
            }
          >
        >((acc, record) => {
          const { key, level, label } = resolveGroup(record);

          if (!acc[key]) {
            acc[key] = {
              groupKey: key,
              name: label,
              totalMembers: 0,
              finalizedMembers: 0,
              achievedMembers: 0,
              totalProgress: 0,
              finalizedScoreSum: 0,
              scoreCounts: { 1: 0, 2: 0, 3: 0, 4: 0 },
              parentCounts: {},
              levelCounts: {},
            };
          }

          const levelKey = level ?? 'none';
          acc[key].levelCounts[levelKey] = (acc[key].levelCounts[levelKey] ?? 0) + 1;

          const parentPath = parentPathOf(record);
          if (parentPath) acc[key].parentCounts[parentPath] = (acc[key].parentCounts[parentPath] ?? 0) + 1;

          const finalized = isEvaluationFinalized(record);

          acc[key].totalMembers += 1;
          acc[key].totalProgress += record.progress;

          if (finalized) {
            acc[key].finalizedMembers += 1;
            acc[key].finalizedScoreSum += record.weightedScore;
            if (record.achieved) acc[key].achievedMembers += 1;

            const rounded = Math.round(record.weightedScore);
            if (rounded >= 1 && rounded <= 4) {
              acc[key].scoreCounts[rounded as 1 | 2 | 3 | 4] += 1;
            }
          }

          return acc;
        }, {}),
      )
        .map((department) => {
          const completionRate =
            department.totalMembers > 0
              ? Math.round((department.finalizedMembers / department.totalMembers) * 100)
              : 0;
          const achievementRate =
            department.totalMembers > 0
              ? Math.round((department.achievedMembers / department.totalMembers) * 100)
              : 0;
          const averageProgress =
            department.totalMembers > 0
              ? Math.round(department.totalProgress / department.totalMembers)
              : 0;
          const averageScore =
            department.finalizedMembers > 0
              ? (department.finalizedScoreSum / department.finalizedMembers).toFixed(1)
              : '-';
          // 가장 많이 등장한 상위 조직 경로(부 조회 시 본부 등). 여러 상위에 걸치면 최빈값.
          const parentEntries = Object.entries(department.parentCounts);
          const parentPath = parentEntries.length
            ? parentEntries.sort((a, b) => b[1] - a[1])[0][0]
            : '';
          // 이 그룹이 실제 속한 레벨(폴백되면 선택 레벨보다 하위일 수 있음).
          const levelEntries = Object.entries(department.levelCounts);
          const topLevel = levelEntries.length ? levelEntries.sort((a, b) => b[1] - a[1])[0][0] : 'none';
          const level: OrgLevel | null = topLevel === 'none' ? null : (topLevel as OrgLevel);
          // 이 그룹 대상자들의 평가자 전원(중복 제거).
          const evaluatorNames = groupEvaluatorNames(recordsByDepartment.get(department.groupKey) ?? [], empNameById);

          return {
            ...department,
            completionRate,
            achievementRate,
            averageProgress,
            averageScore,
            parentPath,
            level,
            evaluatorNames,
          };
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredRecords, groupLevel],
  );

  const visibleDepartments = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const filtered = normalizedQuery
      ? departments.filter(
          (dept) =>
            dept.name.toLowerCase().includes(normalizedQuery) ||
            dept.evaluatorNames.some((n) => n.toLowerCase().includes(normalizedQuery)),
        )
      : departments;

    const sorted = [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'completion-asc':
          return a.completionRate - b.completionRate || a.name.localeCompare(b.name);
        case 'completion-desc':
          return b.completionRate - a.completionRate || a.name.localeCompare(b.name);
        case 'achievement-desc':
          return b.achievementRate - a.achievementRate || a.name.localeCompare(b.name);
        case 'achievement-asc':
          return a.achievementRate - b.achievementRate || a.name.localeCompare(b.name);
        case 'score-desc': {
          const av = a.averageScore === '-' ? -1 : Number(a.averageScore);
          const bv = b.averageScore === '-' ? -1 : Number(b.averageScore);
          return bv - av || a.name.localeCompare(b.name);
        }
        case 'score-asc': {
          const av = a.averageScore === '-' ? Number.POSITIVE_INFINITY : Number(a.averageScore);
          const bv = b.averageScore === '-' ? Number.POSITIVE_INFINITY : Number(b.averageScore);
          return av - bv || a.name.localeCompare(b.name);
        }
        case 'name-asc':
        default:
          return a.name.localeCompare(b.name);
      }
    });

    return sorted;
  }, [departments, searchQuery, sortKey]);

  // 카드를 상위 조직(parentPath)별 섹션으로 묶는다. 상위가 없으면 맨 끝 '상위 미지정' 섹션.
  // 그룹화를 끄면 정렬이 섹션에 갇히지 않도록 전체를 한 그룹(헤더 없음)으로 둔다.
  const sections = useMemo<[string, typeof visibleDepartments][]>(() => {
    if (!groupBySection) return [['__all__', visibleDepartments]];
    const map = new Map<string, typeof visibleDepartments>();
    for (const dept of visibleDepartments) {
      const key = dept.parentPath || '상위 미지정';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(dept);
    }
    return [...map.entries()].sort((a, b) => {
      if (a[0] === '상위 미지정') return 1;
      if (b[0] === '상위 미지정') return -1;
      return a[0].localeCompare(b[0], 'ko');
    });
  }, [visibleDepartments, groupBySection]);

  // P3-6: 화면에 집계된 그룹(현재 필터·집계 단위 그대로)을 부서·본부 결과 엑셀로 —
  // downloadOrgResultWorkbook(기구현, F-D2)을 배선. 통계 정의는 orgStats 단일 출처.
  const handleExportOrgResults = () => {
    const rows: OrgResultRow[] = [...recordsByDepartment.entries()]
      .map(([key, members]) => {
        const samples = members
          .map(toValidSample)
          .filter((s): s is ValidSample => s !== null);
        const gaps = samples.map((s) => s.gap);
        const buckets = emptyBuckets();
        for (const s of samples) buckets[s.bucket] += 1;
        const scores = samples
          .map((s) => Number(s.record.weightedScore))
          .filter((v) => Number.isFinite(v));
        const sepIdx = key.lastIndexOf(' › ');
        return {
          levelLabel: groupLabel,
          org: sepIdx >= 0 ? key.slice(sepIdx + 3) : key,
          parentPath: sepIdx >= 0 ? key.slice(0, sepIdx) : '',
          assignedCount: members.length,
          completedCount: members.filter(isEvaluationFinalized).length,
          n: samples.length,
          achievedCount: samples.filter((s) => s.gap >= 0).length,
          meanGap: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null,
          sd: sampleStdDev(gaps),
          meanScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
          buckets,
          isSmall: samples.length < MIN_SAMPLE,
          isUnassigned: key === '미지정',
        };
      })
      .sort((a, b) => a.parentPath.localeCompare(b.parentPath, 'ko') || a.org.localeCompare(b.org, 'ko'));
    if (rows.length === 0) {
      toast({ title: '내보낼 집계 결과가 없습니다.' });
      return;
    }
    const { fileName, rowCount } = downloadOrgResultWorkbook(rows, {
      levelLabel: groupLabel,
      periodLabel: selectedPeriod?.name ?? undefined,
    });
    toast({ title: '집계표 다운로드 완료', description: `${fileName} · ${rowCount}개 조직` });
  };

  return (
    <>
      <PageHeader
        title="부서별 진행 현황"
        subtitle="본부·부·팀 단위로 완료율, 목표 달성률, 점수 분포를 한 화면에서 확인합니다."
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              className="sd-btn sd-btn-outline sd-btn-sm"
              onClick={handleExportOrgResults}
              disabled={recordsByDepartment.size === 0}
              title="현재 필터·집계 단위 기준의 조직별 결과(완료율·평균갭·표준편차·분포)를 엑셀로 내려받습니다."
            >
              <Download size={14} aria-hidden="true" />
              집계표 엑셀
            </button>
            <Pill tone="orange">{groupLabel} {departments.length}개</Pill>
          </div>
        }
        filters={
          <>
            <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 360 }}>
              <span
                style={{ position: 'absolute', left: 12, top: 11, color: 'var(--fg-subtle)', pointerEvents: 'none' }}
              >
                <IconSearch width={16} height={16} />
              </span>
              <input
                className="sd-input"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={`${groupLabel}·평가자 검색`}
                style={{ paddingLeft: 36, width: '100%' }}
              />
            </div>

            <OrgChecklist items={records.map((r) => recordOrg(r))} value={orgNodeKeys} onChange={setOrgNodeKeys} />

            {deptFilter && (
              <button
                type="button"
                onClick={() => setDeptFilter(null)}
                title="부서 필터 해제"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--ok-orange-100)',
                  background: 'var(--ok-orange-50)',
                  color: 'var(--ok-brown)',
                  fontSize: 'var(--fs-sm)',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                부서: {deptFilter} ✕
              </button>
            )}

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 'var(--fs-sm)',
                fontWeight: 700,
                color: 'var(--fg-muted)',
              }}
            >
              집계 단위
              <select
                className="sd-input"
                value={groupLevel}
                onChange={(event) => setGroupLevel(event.target.value as OrgLevel)}
                style={{ minWidth: 90, width: 90 }}
              >
                {GROUP_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {ORG_LEVEL_LABELS[level]}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={() => setGroupBySection((v) => !v)}
              aria-pressed={groupBySection}
              title="상위 조직별로 카드를 묶어 봅니다. 끄면 전체를 한 번에 정렬합니다."
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                fontSize: 'var(--fs-sm)',
                fontWeight: 700,
                cursor: 'pointer',
                border: `1px solid ${groupBySection ? 'var(--ok-orange)' : 'var(--border)'}`,
                background: groupBySection ? 'var(--ok-orange-50)' : 'transparent',
                color: groupBySection ? 'var(--ok-orange)' : 'var(--fg-muted)',
              }}
            >
              상위조직 묶기 {groupBySection ? 'ON' : 'OFF'}
            </button>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 'var(--fs-sm)',
                fontWeight: 700,
                color: 'var(--fg-muted)',
              }}
            >
              정렬
              <select
                className="sd-input"
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value as SortKey)}
                style={{ minWidth: 220, width: 220, whiteSpace: 'nowrap' }}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <div style={{ marginLeft: 'auto', fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
              {groupLabel} {visibleDepartments.length}/{departments.length}개
            </div>
          </>
        }
      />

      <div className="flex flex-col gap-5" style={{ padding: '24px 32px 32px' }}>
        {isLoading ? (
          <LoadingState message="부서 데이터를 불러오는 중입니다." />
        ) : error ? (
          <div className="sd-card" style={{ color: 'var(--danger)' }}>
            {error}
          </div>
        ) : (
          <>
            {sections.map(([parent, depts]) => (
              <section key={parent} className="flex flex-col" style={{ gap: 12 }}>
                {groupBySection && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 10,
                      paddingBottom: 8,
                      borderBottom: '2px solid var(--ok-orange-100)',
                    }}
                  >
                    <span style={{ fontSize: 'var(--fs-h4)', fontWeight: 900, color: 'var(--ok-brown)' }}>
                      {parent}
                    </span>
                    <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', fontWeight: 700 }}>
                      {(() => {
                        const counts = depts.reduce<Record<string, number>>((acc, d) => {
                          const lbl = d.level ? ORG_LEVEL_LABELS[d.level] : '미지정';
                          acc[lbl] = (acc[lbl] ?? 0) + 1;
                          return acc;
                        }, {});
                        return Object.entries(counts)
                          .map(([lbl, n]) => `${lbl} ${n}개`)
                          .join(' · ');
                      })()}
                    </span>
                  </div>
                )}
                {/* 사용자 요구(2026-07-07): 카드 그리드 → 비교형 테이블. 한 화면에서 조직 간
                    수치를 열 단위로 훑을 수 있게 하고, 행 클릭으로 기존 부서원 상세를 유지한다. */}
                <div className="sd-card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{ overflowX: 'auto' }}>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>조직</TableHead>
                          <TableHead style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>인원</TableHead>
                          <TableHead style={{ minWidth: 200 }}>완료 (완료/전체)</TableHead>
                          <TableHead style={{ minWidth: 220 }}>달성 현황 (달성·미달성·미평가)</TableHead>
                          <TableHead style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>평균 점수</TableHead>
                          <TableHead>평가자</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {depts.map((department) => {
                          const missedMembers = Math.max(
                            0,
                            department.finalizedMembers - department.achievedMembers,
                          );
                          const pendingMembers = Math.max(
                            0,
                            department.totalMembers - department.finalizedMembers,
                          );
                          const denom = department.totalMembers || 1;
                          const segments = [
                            { key: 'achieved', count: department.achievedMembers, color: 'var(--ok-orange)', label: '달성' },
                            { key: 'missed', count: missedMembers, color: 'var(--warning)', label: '미달성' },
                            { key: 'pending', count: pendingMembers, color: 'var(--border)', label: '미평가' },
                          ];
                          return (
                            <TableRow
                              key={department.groupKey}
                              onClick={() => setOpenDepartment(department.groupKey)}
                              style={{ cursor: 'pointer' }}
                              title="클릭하면 부서원 상세를 봅니다."
                            >
                              <TableCell>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                  <span style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{department.name}</span>
                                  {department.level && department.level !== groupLevel && (
                                    <span
                                      style={{
                                        flexShrink: 0,
                                        fontSize: 'var(--fs-xs)',
                                        fontWeight: 800,
                                        color: 'var(--ok-orange-700)',
                                        background: 'var(--ok-orange-50)',
                                        border: '1px solid var(--ok-orange-100)',
                                        borderRadius: 6,
                                        padding: '1px 6px',
                                      }}
                                    >
                                      {ORG_LEVEL_LABELS[department.level]}
                                    </span>
                                  )}
                                </div>
                                {!groupBySection && department.parentPath && (
                                  <div
                                    style={{
                                      fontSize: 'var(--fs-xs)',
                                      color: 'var(--fg-muted)',
                                      fontWeight: 700,
                                      marginTop: 2,
                                      whiteSpace: 'nowrap',
                                    }}
                                    title={department.parentPath}
                                  >
                                    {department.parentPath}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="tnum" style={{ textAlign: 'right', fontWeight: 700 }}>
                                {department.totalMembers}
                              </TableCell>
                              <TableCell>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <div className="sd-bar" style={{ flex: 1, height: 8, minWidth: 80 }}>
                                    <div
                                      className="sd-bar-fill"
                                      style={{ width: `${department.completionRate}%` }}
                                    />
                                  </div>
                                  <span
                                    className="tnum"
                                    style={{ fontWeight: 800, whiteSpace: 'nowrap', fontSize: 'var(--fs-sm)' }}
                                  >
                                    {department.finalizedMembers}/{department.totalMembers} · {department.completionRate}%
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <div
                                    style={{
                                      flex: 1,
                                      display: 'flex',
                                      height: 10,
                                      borderRadius: 5,
                                      overflow: 'hidden',
                                      background: 'var(--bg-muted)',
                                      minWidth: 90,
                                    }}
                                  >
                                    {segments.map((seg) =>
                                      seg.count > 0 ? (
                                        <div
                                          key={seg.key}
                                          style={{
                                            width: `${(seg.count / denom) * 100}%`,
                                            background: seg.color,
                                          }}
                                          title={`${seg.label} ${seg.count}명`}
                                        />
                                      ) : null,
                                    )}
                                  </div>
                                  <span
                                    className="tnum"
                                    style={{ fontWeight: 800, whiteSpace: 'nowrap', fontSize: 'var(--fs-sm)' }}
                                    title={segments.map((seg) => `${seg.label} ${seg.count}명`).join(' · ')}
                                  >
                                    {department.achievementRate}%
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="tnum" style={{ textAlign: 'right', fontWeight: 800 }}>
                                {department.averageScore}
                              </TableCell>
                              <TableCell style={{ maxWidth: 240 }}>
                                <span
                                  style={{
                                    display: 'block',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    color: 'var(--ok-brown)',
                                    fontWeight: 700,
                                  }}
                                  title={department.evaluatorNames.join(', ')}
                                >
                                  {department.evaluatorNames.join(', ') || '-'}
                                </span>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </section>
            ))}

            {!visibleDepartments.length && (
              <div className="sd-card">
                {departments.length === 0
                  ? '표시할 부서 데이터가 없습니다.'
                  : '검색 조건에 맞는 부서가 없습니다.'}
              </div>
            )}
          </>
        )}
      </div>

      {openDepartment && (
        <DepartmentMembersModal
          name={departments.find((d) => d.groupKey === openDepartment)?.name ?? openDepartment}
          levelLabel={groupLabel}
          parentPath={departments.find((d) => d.groupKey === openDepartment)?.parentPath ?? ''}
          records={openDepartmentRecords}
          evaluatorNameById={empNameById}
          onClose={() => setOpenDepartment(null)}
        />
      )}
    </>
  );
};

type DepartmentMembersModalProps = {
  name: string;
  levelLabel: string;
  parentPath: string;
  records: EmployeeEvaluationRecord[];
  evaluatorNameById: Map<string, string>;
  onClose: () => void;
};

const REVIEW_STATUS_LABEL: Record<EmployeeEvaluationRecord['reviewStatus'], string> = {
  'not-started': '시작 전',
  draft: '작성 중',
  submitted: '검토 대기',
  evaluating: '평가 중',
  completed: '완료',
  locked: '잠금',
};

const REVIEW_STATUS_TONE: Record<
  EmployeeEvaluationRecord['reviewStatus'],
  'success' | 'orange' | 'warning' | 'info' | 'neutral'
> = {
  'not-started': 'warning',
  draft: 'warning',
  submitted: 'orange',
  evaluating: 'info',
  completed: 'success',
  locked: 'neutral',
};

const DepartmentMembersModal = ({ name, levelLabel, parentPath, records, evaluatorNameById, onClose }: DepartmentMembersModalProps) => {
  const { toast } = useToast();
  const { selectedPeriod } = useEvaluationPeriod();
  const navigate = useNavigate();
  const finalizedRecords = records.filter(isEvaluationFinalized);
  const finalized = finalizedRecords.length;
  const achieved = finalizedRecords.filter((r) => r.achieved).length;
  const averageScore =
    finalized > 0
      ? (finalizedRecords.reduce((sum, r) => sum + r.weightedScore, 0) / finalized).toFixed(1)
      : '-';
  const total = records.length;
  const completionRate = total > 0 ? Math.round((finalized / total) * 100) : 0;
  const achievementRate = total > 0 ? Math.round((achieved / total) * 100) : 0;
  const missed = Math.max(0, finalized - achieved);
  const pending = Math.max(0, total - finalized);
  const levelChips = [4, 3, 2, 1]
    .map((lv) => ({ lv, n: records.filter((r) => (r.employee.growth_level ?? 1) === lv).length }))
    .filter((x) => x.n > 0);
  const achSegments = [
    { key: 'a', label: '달성', n: achieved, color: 'var(--ok-orange)' },
    { key: 'm', label: '미달성', n: missed, color: 'var(--warning)' },
    { key: 'p', label: '미평가', n: pending, color: 'var(--border)' },
  ];

  const handleDownload = () => {
    try {
      const members: DepartmentExportMember[] = records.map((record) => ({
        employeeId: record.employee.employee_id,
        name: record.employee.name,
        position: record.employee.position,
        department: record.evaluation?.evaluatee_department ?? record.employee.department,
        jobRole: record.employee.job_role ?? null,
        growthLevel: record.employee.growth_level,
        evaluatorName:
          record.evaluation?.evaluator_name ??
          (record.employee.evaluator_id
            ? evaluatorNameById.get(record.employee.evaluator_id) ?? record.employee.evaluator_id
            : null),
        reviewStatusLabel: REVIEW_STATUS_LABEL[record.reviewStatus],
        weightedScore: record.weightedScore,
        isFinalized: isEvaluationFinalized(record),
        achieved: record.achieved,
        progress: record.progress,
      }));
      const result = downloadDepartmentMembersWorkbook(name, members, selectedPeriod?.name ?? null);
      toast({
        title: '부서 명단 다운로드 완료',
        description: `${name} · ${result.memberCount}명 명단을 받았습니다.`,
      });
    } catch (error) {
      console.error('부서 명단 다운로드 실패:', error);
      toast({
        title: '부서 명단 다운로드 실패',
        description: error instanceof Error ? error.message : '다시 시도해 주세요.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="sd-card sd-card-lg"
        style={{
          width: 'min(1200px, 100%)',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          padding: 0,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div>
            <div className="sd-label-mini">
              {levelLabel}
              {parentPath && <span style={{ color: 'var(--fg-subtle)', fontWeight: 700 }}> · {parentPath}</span>}
            </div>
            <h2 style={{ marginTop: 2, fontSize: 'var(--fs-h3)', fontWeight: 900 }}>{name}</h2>
            <div style={{ marginTop: 6, fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
              대상자 {total}명
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              className="sd-btn sd-btn-outline sd-btn-sm"
              onClick={handleDownload}
              disabled={records.length === 0}
            >
              <Download size={14} />
              엑셀 다운로드
            </button>
            <button className="sd-btn sd-btn-ghost sd-btn-sm" onClick={onClose}>
              <X size={16} />
              닫기
            </button>
          </div>
        </div>

        {records.length > 0 && (
          <div
            style={{
              padding: '16px 24px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: 22,
              flexWrap: 'wrap',
            }}
          >
            <ModalStat label="완료율" value={`${completionRate}%`} sub={`${finalized}/${total}`} bar={completionRate} barColor="var(--ok-orange)" />
            <ModalStat label="목표 달성" value={`${achievementRate}%`} sub={`${achieved}명`} bar={achievementRate} barColor="var(--warning)" />
            <ModalStat label="평균 점수" value={averageScore} sub="완료자 기준" />
            <div style={{ flex: '1 1 240px', minWidth: 200 }}>
              <div className="sd-label-mini" style={{ marginBottom: 6 }}>달성 현황</div>
              <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', background: 'var(--bg-muted)' }}>
                {achSegments.map((s) =>
                  s.n > 0 ? (
                    <div
                      key={s.key}
                      style={{ width: `${(s.n / (total || 1)) * 100}%`, background: s.color }}
                      title={`${s.label} ${s.n}명`}
                    />
                  ) : null,
                )}
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
                {achSegments.map((s) => (
                  <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)' }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: 'inline-block' }} />
                    {s.label} {s.n}
                  </span>
                ))}
              </div>
            </div>
            {levelChips.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="sd-label-mini">레벨 분포</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {levelChips.map((c) => (
                    <span
                      key={c.lv}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 'var(--fs-xs)',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: 999,
                        background: 'var(--bg-muted)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <span style={{ color: 'var(--fg-muted)', fontWeight: 700 }}>Lv.{c.lv}</span>
                      <b className="tnum">{c.n}명</b>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ overflow: 'auto', padding: '0 4px 4px' }}>
          {records.length === 0 ? (
            <div style={{ padding: 24, color: 'var(--fg-muted)' }}>
              이 부서에는 표시할 평가 대상자가 없습니다.
            </div>
          ) : (
            <Table>
              <TableHeader style={{ background: 'var(--bg-muted)' }}>
                <TableRow>
                  <TableHead style={{ whiteSpace: 'nowrap' }}>사번</TableHead>
                  <TableHead style={{ whiteSpace: 'nowrap' }}>이름</TableHead>
                  <TableHead style={{ whiteSpace: 'nowrap' }}>직책</TableHead>
                  <TableHead style={{ whiteSpace: 'nowrap' }}>법인</TableHead>
                  <TableHead style={{ whiteSpace: 'nowrap' }}>본부</TableHead>
                  <TableHead style={{ whiteSpace: 'nowrap' }}>부</TableHead>
                  <TableHead style={{ whiteSpace: 'nowrap' }}>팀</TableHead>
                  <TableHead style={{ whiteSpace: 'nowrap' }}>직무</TableHead>
                  <TableHead style={{ whiteSpace: 'nowrap' }}>레벨</TableHead>
                  <TableHead style={{ whiteSpace: 'nowrap' }}>평가자</TableHead>
                  <TableHead style={{ minWidth: 120 }}>진행률</TableHead>
                  <TableHead>점수</TableHead>
                  <TableHead>달성</TableHead>
                  <TableHead>상태</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record) => {
                  const finalized = isEvaluationFinalized(record);
                  return (
                    <TableRow key={record.employee.id}>
                      <TableCell
                        style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}
                      >
                        {record.employee.employee_id}
                      </TableCell>
                      <TableCell style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>
                        <button
                          type="button"
                          onClick={() =>
                            navigate(`/hr/evaluation-viewer?evaluatee=${encodeURIComponent(record.employee.employee_id)}`)
                          }
                          title="이 피평가자의 평가 내역(읽기 전용) 열람"
                          style={{
                            border: 'none',
                            background: 'transparent',
                            padding: 0,
                            font: 'inherit',
                            fontWeight: 800,
                            color: 'var(--ok-orange)',
                            cursor: 'pointer',
                            textDecoration: 'underline',
                            textUnderlineOffset: 2,
                          }}
                        >
                          {record.employee.name}
                        </button>
                      </TableCell>
                      <TableCell style={{ whiteSpace: 'nowrap' }}>{record.employee.position}</TableCell>
                      <TableCell style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
                        {getOrgValue(recordOrg(record), 'corporation') || '-'}
                      </TableCell>
                      <TableCell style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
                        {getOrgValue(recordOrg(record), 'division') || '-'}
                      </TableCell>
                      <TableCell style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
                        {getOrgValue(recordOrg(record), 'department') || '-'}
                      </TableCell>
                      <TableCell style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
                        {getOrgValue(recordOrg(record), 'team') || '-'}
                      </TableCell>
                      <TableCell style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
                        {record.employee.job_role ?? '-'}
                      </TableCell>
                      <TableCell style={{ whiteSpace: 'nowrap' }}>
                        {record.employee.growth_level ? `Lv.${record.employee.growth_level}` : '-'}
                      </TableCell>
                      <TableCell style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
                        {record.evaluation?.evaluator_name ??
                          (record.employee.evaluator_id
                            ? evaluatorNameById.get(record.employee.evaluator_id) ?? record.employee.evaluator_id
                            : '-')}
                      </TableCell>
                      <TableCell style={{ minWidth: 120 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--bg-muted)', overflow: 'hidden', minWidth: 56 }}>
                            <div
                              style={{
                                height: '100%',
                                width: `${record.progress}%`,
                                background: record.progress >= 100 ? 'var(--ok-orange)' : 'var(--warning)',
                                borderRadius: 3,
                              }}
                            />
                          </div>
                          <span className="tnum" style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', minWidth: 30, textAlign: 'right' }}>
                            {record.progress}%
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="tnum">
                        {finalized ? (
                          <span style={{ fontWeight: 800, color: record.achieved ? 'var(--ok-orange)' : 'var(--fg)' }}>
                            {record.weightedScore.toFixed(1)}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--fg-muted)' }}>-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {finalized ? (
                          record.achieved ? (
                            <Pill tone="success">달성</Pill>
                          ) : (
                            <Pill tone="warning">미달성</Pill>
                          )
                        ) : (
                          <span style={{ color: 'var(--fg-muted)' }}>-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Pill tone={REVIEW_STATUS_TONE[record.reviewStatus]}>
                          {REVIEW_STATUS_LABEL[record.reviewStatus]}
                        </Pill>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
};

const ModalStat = ({
  label,
  value,
  sub,
  bar,
  barColor,
}: {
  label: string;
  value: string;
  sub?: string;
  bar?: number;
  barColor?: string;
}) => (
  <div style={{ minWidth: 92 }}>
    <div className="sd-label-mini">{label}</div>
    <div className="tnum" style={{ fontSize: 'var(--fs-h3)', fontWeight: 900, marginTop: 2, lineHeight: 1 }}>
      {value}
    </div>
    {sub && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', marginTop: 2 }}>{sub}</div>}
    {bar !== undefined && (
      <div style={{ marginTop: 6, height: 6, borderRadius: 3, background: 'var(--bg-muted)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${bar}%`, background: barColor ?? 'var(--ok-orange)', borderRadius: 3 }} />
      </div>
    )}
  </div>
);

export default HrDepartmentsPage;

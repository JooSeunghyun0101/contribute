import * as XLSX from 'xlsx';
import { toValidSample } from '@/lib/orgStats';
import { getOrgValue, orgFieldsFromEvaluation } from '@/lib/orgHierarchy';
import type { ScatterPoint } from '@/lib/insightScatter';
import type { EmployeeEvaluationRecord } from '@/lib/dashboardData';

const pad = (n: number) => String(n).padStart(2, '0');
const todayText = () => {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
};

// 평가 인사이트 현재 화면(축·필터 반영)을 엑셀로. 그룹 요약 + 대상자 원자료 2시트.
export const downloadInsightWorkbook = (
  axisLabel: string,
  points: ScatterPoint[],
  records: EmployeeEvaluationRecord[],
  periodLabel?: string | null,
): { fileName: string; groupCount: number; memberCount: number } => {
  const summaryHeader = [
    axisLabel,
    '인원',
    '레벨평균 대비',
    '변별력(갭 편차)',
    '쏠림 %',
    '최빈',
    '평균 점수',
    '평균 갭',
    '표본부족(n<5)',
  ];
  const summaryRows = [...points]
    .sort((a, b) => b.n - a.n)
    .map((p) => [
      p.label,
      p.n,
      Math.round(p.bias * 100) / 100,
      p.stdDev == null ? '' : Math.round(p.stdDev * 100) / 100,
      Math.round(p.modeShare * 100),
      p.modeLabel,
      p.meanScore,
      p.meanGap,
      p.isSmall ? 'Y' : '',
    ]);

  const memberHeader = ['사번', '이름', '법인', '본부', '부', '팀', '직종', '성장레벨', '평가점수', '갭', '평가자'];
  const memberRows: (string | number)[][] = [];
  for (const r of records) {
    const s = toValidSample(r);
    if (!s) continue;
    const org = orgFieldsFromEvaluation(r.evaluation, r.employee);
    memberRows.push([
      r.employee.employee_id,
      r.employee.name,
      getOrgValue(org, 'corporation'),
      getOrgValue(org, 'division'),
      getOrgValue(org, 'department'),
      getOrgValue(org, 'team'),
      r.employee.job_role ?? '',
      r.employee.growth_level ?? '',
      Math.round(r.weightedScore * 10) / 10,
      s.gap,
      r.evaluation?.evaluator_name ?? '',
    ]);
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([summaryHeader, ...summaryRows]), '그룹 요약');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([memberHeader, ...memberRows]), '대상자');

  const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
  const periodPart = periodLabel && periodLabel.trim() ? `_${safe(periodLabel)}` : '';
  const fileName = `평가인사이트_${safe(axisLabel)}${periodPart}_${todayText()}.xlsx`;
  XLSX.writeFile(wb, fileName);
  return { fileName, groupCount: summaryRows.length, memberCount: memberRows.length };
};

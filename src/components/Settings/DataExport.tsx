import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { X, Download, FileText, Calendar } from 'lucide-react';
import {
  employeeService,
  evaluationService,
  taskService,
} from '@/lib/services';
import * as XLSX from 'xlsx';
import type { Employee, Evaluation } from '@/types';

interface DataExportProps {
  onClose: () => void;
}

type EvaluationWithTasks = Evaluation & { tasks: any[] };

const formatDate = (value?: string | null) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('ko-KR');
};

const calcWeightedScore = (tasks: any[]) =>
  tasks.reduce(
    (sum, t) => sum + (t.score != null ? (Number(t.score) * Number(t.weight ?? 0)) / 100 : 0),
    0,
  );

const buildEvaluationRow = (evaluation: EvaluationWithTasks) => {
  const totalScore = calcWeightedScore(evaluation.tasks);
  return {
    피평가자ID: evaluation.evaluatee_id,
    피평가자명: evaluation.evaluatee_name,
    직급: evaluation.evaluatee_position,
    부서: evaluation.evaluatee_department,
    성장레벨: evaluation.growth_level,
    평가자: evaluation.evaluator_name ?? '미지정',
    평가시작일: formatDate(evaluation.evaluator_assigned_at),
    평가상태:
      evaluation.evaluation_status === 'completed'
        ? '완료'
        : evaluation.evaluation_status === 'submitted'
          ? '제출'
          : evaluation.evaluation_status === 'evaluating'
            ? '평가중'
            : '진행중',
    구분: '현재',
    총점수: totalScore.toFixed(1),
    달성여부: Math.floor(totalScore) >= (evaluation.growth_level ?? 0) ? '달성' : '미달성',
    최종수정일: formatDate(evaluation.last_modified),
  };
};

const buildHistoricalRow = (evaluation: EvaluationWithTasks) => ({
  ...buildEvaluationRow(evaluation),
  구분: '과거',
});

const buildTaskFeedbackRows = (evaluation: EvaluationWithTasks) =>
  evaluation.tasks
    .filter((t) => t.feedback)
    .map((task) => ({
      피평가자ID: evaluation.evaluatee_id,
      피평가자명: evaluation.evaluatee_name,
      부서: evaluation.evaluatee_department,
      평가자: task.evaluator_name ?? evaluation.evaluator_name ?? '평가자 미확인',
      과업명: task.title,
      가중치: task.weight,
      기여방식: task.contribution_method ?? '',
      기여범위: task.contribution_scope ?? '',
      점수: task.score ?? 0,
      피드백: task.feedback,
      피드백일시: formatDate(task.feedback_date),
      구분: evaluation.evaluation_status === 'completed' && evaluation.evaluator_assigned_at
        ? '과거'
        : '현재',
    }));

export const DataExport: React.FC<DataExportProps> = ({ onClose }) => {
  const { toast } = useToast();
  const [exportOptions, setExportOptions] = useState({
    evaluationData: true,
    employeeInfo: true,
    feedbackData: true,
    statisticsData: false,
    includePastEvaluations: false,
  });
  const [isExporting, setIsExporting] = useState(false);

  const handleOptionChange = (option: keyof typeof exportOptions, checked: boolean) => {
    setExportOptions((prev) => ({ ...prev, [option]: checked }));
  };

  const loadEvaluationsWithTasks = async (
    includePast: boolean,
  ): Promise<{ current: EvaluationWithTasks[]; past: EvaluationWithTasks[] }> => {
    const employees = await employeeService.getAllEmployees();
    const allEmployees = new Map(employees.map((e) => [e.employee_id, e]));
    const current: EvaluationWithTasks[] = [];
    const past: EvaluationWithTasks[] = [];

    for (const employee of employees) {
      const evaluations = await evaluationService.getEvaluationsByEmployeeId(employee.employee_id);
      for (const ev of evaluations) {
        const tasks = (await taskService.getTasksByEvaluationId(ev.id)).filter(
          (t: any) => !t.deleted_at,
        );
        const enriched: EvaluationWithTasks = { ...ev, tasks };
        const isCurrent =
          ev.evaluator_id != null && ev.evaluator_id === allEmployees.get(employee.employee_id)?.evaluator_id;
        if (isCurrent) {
          current.push(enriched);
        } else {
          past.push(enriched);
        }
      }
    }

    if (!includePast) {
      return { current, past: [] };
    }
    return { current, past };
  };

  const exportToExcel = async () => {
    setIsExporting(true);
    try {
      const wb = XLSX.utils.book_new();
      const employees = exportOptions.employeeInfo ? await employeeService.getAllEmployees() : [];

      if (exportOptions.employeeInfo && employees.length > 0) {
        const sheet = XLSX.utils.json_to_sheet(
          employees.map((emp: Employee) => ({
            직원ID: emp.employee_id,
            이름: emp.name,
            직급: emp.position,
            부서: emp.department,
            성장레벨: emp.growth_level ?? '',
            평가자ID: emp.evaluator_id ?? '',
            역할: (emp.available_roles ?? []).join(','),
          })),
        );
        XLSX.utils.book_append_sheet(wb, sheet, '직원정보');
      }

      let currentEvaluations: EvaluationWithTasks[] = [];
      let pastEvaluations: EvaluationWithTasks[] = [];
      if (exportOptions.evaluationData || exportOptions.feedbackData || exportOptions.statisticsData) {
        const loaded = await loadEvaluationsWithTasks(exportOptions.includePastEvaluations);
        currentEvaluations = loaded.current;
        pastEvaluations = loaded.past;
      }

      if (exportOptions.evaluationData) {
        const rows = [
          ...currentEvaluations.map(buildEvaluationRow),
          ...pastEvaluations.map(buildHistoricalRow),
        ];
        const sheet = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, sheet, '평가현황');
      }

      if (exportOptions.feedbackData) {
        const rows = [
          ...currentEvaluations.flatMap(buildTaskFeedbackRows),
          ...pastEvaluations.flatMap(buildTaskFeedbackRows),
        ];
        const sheet = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, sheet, '피드백내역');
      }

      if (exportOptions.statisticsData) {
        const employeeList = employees.length > 0 ? employees : await employeeService.getAllEmployees();
        const deptStats = new Map<string, { total: number; completed: number }>();
        for (const emp of employeeList) {
          const dept = emp.department ?? '미지정';
          const stat = deptStats.get(dept) ?? { total: 0, completed: 0 };
          stat.total += 1;
          deptStats.set(dept, stat);
        }
        for (const ev of currentEvaluations) {
          if (ev.evaluation_status === 'completed') {
            const dept = ev.evaluatee_department;
            const stat = deptStats.get(dept) ?? { total: 0, completed: 0 };
            stat.completed += 1;
            deptStats.set(dept, stat);
          }
        }
        const rows = [...deptStats.entries()].map(([dept, stat]) => ({
          부서: dept,
          전체인원: stat.total,
          완료인원: stat.completed,
          완료율: stat.total > 0 ? `${Math.round((stat.completed / stat.total) * 100)}%` : '0%',
        }));
        const sheet = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, sheet, '부서별통계');
      }

      const today = new Date().toISOString().slice(0, 10);
      const suffix = exportOptions.includePastEvaluations ? '_과거포함' : '';
      XLSX.writeFile(wb, `평가데이터_${today}${suffix}.xlsx`);

      toast({
        title: '데이터 내보내기 완료',
        description: `Excel 파일이 다운로드되었습니다.${exportOptions.includePastEvaluations ? ` (과거 평가 ${pastEvaluations.length}건 포함)` : ''}`,
      });
    } catch (error) {
      console.error('데이터 내보내기 실패:', error);
      toast({
        title: '내보내기 실패',
        description: '데이터 내보내기 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const exportReports = async () => {
    setIsExporting(true);
    try {
      const employees = await employeeService.getAllEmployees();
      const evaluations = await evaluationService.getAllEvaluations();
      const totalEmployees = employees.length;
      const completedEvaluations = evaluations.filter(
        (e) => e.evaluation_status === 'completed',
      ).length;
      const evaluationsWithTasks = await Promise.all(
        evaluations.map(async (ev) => {
          const tasks = (await taskService.getTasksByEvaluationId(ev.id)).filter(
            (t: any) => !t.deleted_at,
          );
          return { ev, tasks };
        }),
      );
      const achievedCount = evaluationsWithTasks.filter(
        ({ ev, tasks }) => Math.floor(calcWeightedScore(tasks)) >= (ev.growth_level ?? 0),
      ).length;

      const wb = XLSX.utils.book_new();
      const sheet = XLSX.utils.json_to_sheet([
        {
          '보고서 생성일': new Date().toLocaleDateString('ko-KR'),
          '전체 직원 수': totalEmployees,
          '평가 완료 수': completedEvaluations,
          '평가 완료율':
            totalEmployees > 0
              ? `${Math.round((completedEvaluations / totalEmployees) * 100)}%`
              : '0%',
          '목표 달성 수': achievedCount,
          '목표 달성률':
            completedEvaluations > 0
              ? `${Math.round((achievedCount / completedEvaluations) * 100)}%`
              : '0%',
        },
      ]);
      XLSX.utils.book_append_sheet(wb, sheet, '요약보고서');

      const today = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `평가보고서_${today}.xlsx`);

      toast({
        title: '보고서 생성 완료',
        description: '요약 보고서가 생성되었습니다.',
      });
    } catch (error) {
      console.error('보고서 생성 실패:', error);
      toast({
        title: '보고서 생성 실패',
        description: '보고서 생성 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">데이터 내보내기</h2>
          <p className="text-muted-foreground">평가 데이터를 백업하고 리포트를 생성하세요</p>
        </div>
        <Button variant="outline" onClick={onClose}>
          <X className="mr-2 h-4 w-4" />
          닫기
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            데이터 선택
          </CardTitle>
          <CardDescription>내보낼 데이터를 선택하세요</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(
            [
              { id: 'evaluationData', label: '평가 현황 데이터' },
              { id: 'employeeInfo', label: '직원 정보' },
              { id: 'feedbackData', label: '피드백 내역' },
              { id: 'statisticsData', label: '부서별 통계' },
            ] as const
          ).map((opt) => (
            <div key={opt.id} className="flex items-center space-x-2">
              <Checkbox
                id={opt.id}
                checked={exportOptions[opt.id]}
                onCheckedChange={(checked) => handleOptionChange(opt.id, checked as boolean)}
              />
              <label htmlFor={opt.id} className="text-sm font-medium leading-none">
                {opt.label}
              </label>
            </div>
          ))}

          <div
            className="flex items-center space-x-2"
            style={{
              borderTop: '1px solid var(--border)',
              paddingTop: 12,
              marginTop: 12,
            }}
          >
            <Checkbox
              id="includePastEvaluations"
              checked={exportOptions.includePastEvaluations}
              onCheckedChange={(checked) =>
                handleOptionChange('includePastEvaluations', checked as boolean)
              }
            />
            <label
              htmlFor="includePastEvaluations"
              className="text-sm font-medium leading-none"
              style={{ color: 'var(--ok-orange)' }}
            >
              과거 평가 포함 (이전 평가자/투어 데이터)
            </label>
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              상세 데이터 내보내기
            </CardTitle>
            <CardDescription>선택한 데이터를 Excel 파일로 내보냅니다</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={exportToExcel} className="w-full" disabled={isExporting}>
              <Download className="mr-2 h-4 w-4" />
              {isExporting ? '내보내는 중...' : 'Excel로 내보내기'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              요약 보고서
            </CardTitle>
            <CardDescription>전체 평가 현황 요약 보고서를 생성합니다</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={exportReports}
              variant="outline"
              className="w-full"
              disabled={isExporting}
            >
              <FileText className="mr-2 h-4 w-4" />
              {isExporting ? '생성 중...' : '보고서 생성'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

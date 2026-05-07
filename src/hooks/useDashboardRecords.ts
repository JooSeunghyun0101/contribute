import { useCallback, useEffect, useRef, useState } from 'react';
import { employeeService } from '@/lib/services';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import {
  getActiveEvaluatees,
  loadEmployeeEvaluationRecords,
  type EmployeeEvaluationRecord,
} from '@/lib/dashboardData';
import type { Employee } from '@/types';

type DashboardState = {
  employees: Employee[];
  records: EmployeeEvaluationRecord[];
  isLoading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

// `loaderKey` is a stable string that identifies the current loader's inputs
// (e.g. `team:${evaluatorId}`). The loader function itself is held in a ref so
// inline arrow functions in the wrapper hooks don't cause re-runs every render.
const useRecordsLoader = (
  loaderFn: () => Promise<Employee[]>,
  loaderKey: string,
  includeFeedbackHistory = false,
): DashboardState => {
  const { selectedPeriodId } = useEvaluationPeriod();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [records, setRecords] = useState<EmployeeEvaluationRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loaderRef = useRef(loaderFn);
  loaderRef.current = loaderFn;

  const reload = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const loadedEmployees = await loaderRef.current();
      setEmployees(loadedEmployees);
      const loadedRecords = await loadEmployeeEvaluationRecords(loadedEmployees, {
        includeFeedbackHistory,
        periodId: selectedPeriodId,
      });
      setRecords(loadedRecords);
    } catch (err) {
      setEmployees([]);
      setRecords([]);
      setError(err instanceof Error ? err.message : '데이터를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [includeFeedbackHistory, selectedPeriodId]);

  useEffect(() => {
    void reload();
    // re-run only when the input identity changes, not on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaderKey, includeFeedbackHistory, selectedPeriodId]);

  return { employees, records, isLoading, error, reload };
};

export const useTeamDashboardRecords = (
  evaluatorId: string,
  includeFeedbackHistory = false,
): DashboardState =>
  useRecordsLoader(
    () => (evaluatorId ? employeeService.getEvaluateesByEvaluator(evaluatorId) : Promise.resolve([])),
    `team:${evaluatorId}`,
    includeFeedbackHistory,
  );

export const useFormerTeamDashboardRecords = (
  evaluatorId: string,
  includeFeedbackHistory = false,
): DashboardState =>
  useRecordsLoader(
    () => (evaluatorId ? employeeService.getFormerEvaluateesByEvaluator(evaluatorId) : Promise.resolve([])),
    `former-team:${evaluatorId}`,
    includeFeedbackHistory,
  );

export const useCompanyDashboardRecords = (includeFeedbackHistory = false) =>
  useRecordsLoader(
    async () => {
      const employees = await employeeService.getAllEmployees();
      return getActiveEvaluatees(employees);
    },
    'company',
    includeFeedbackHistory,
  );

export const useAllEmployees = (): DashboardState =>
  useRecordsLoader(() => employeeService.getAllEmployees(), 'all', false);

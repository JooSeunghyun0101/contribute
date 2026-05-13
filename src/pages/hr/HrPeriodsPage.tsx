import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, CalendarDays, CheckCircle2, LockKeyhole, Plus, RefreshCw } from 'lucide-react';
import PageHeader from '@/components/Layout/PageHeader';
import { evaluationPeriodService } from '@/lib/services';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import type { EvaluationPeriod, EvaluationPeriodStatus } from '@/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';

type PeriodForm = {
  code: string;
  name: string;
  evaluation_year: string;
  starts_on: string;
  ends_on: string;
  status: 'draft' | 'active';
};

const getDefaultForm = (): PeriodForm => {
  const year = new Date().getFullYear();
  return {
    code: `${year}-annual`,
    name: `${year} 연간 기여도 평가`,
    evaluation_year: String(year),
    starts_on: `${year}-01-01`,
    ends_on: `${year}-12-31`,
    status: 'draft',
  };
};

const STATUS_LABEL: Record<EvaluationPeriodStatus, string> = {
  draft: '작성 전',
  active: '진행 중',
  closed: '마감',
  locked: '잠금',
};

const STATUS_STYLE: Record<EvaluationPeriodStatus, { bg: string; fg: string; border: string }> = {
  draft: { bg: 'var(--bg-muted)', fg: 'var(--fg-muted)', border: 'var(--border)' },
  active: { bg: 'var(--ok-orange-50)', fg: 'var(--ok-orange-700)', border: 'var(--ok-orange-100)' },
  closed: { bg: '#EFF6FF', fg: '#1D4ED8', border: '#BFDBFE' },
  locked: { bg: '#F8FAFC', fg: '#334155', border: '#CBD5E1' },
};

const formatDate = (value: string | null) => (value ? value.slice(0, 10).replace(/-/g, '.') : '-');

const StatusBadge = ({ status }: { status: EvaluationPeriodStatus }) => {
  const style = STATUS_STYLE[status];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        minWidth: 66,
        justifyContent: 'center',
        padding: '4px 10px',
        borderRadius: 999,
        border: `1px solid ${style.border}`,
        background: style.bg,
        color: style.fg,
        fontSize: 'var(--fs-sm)',
        fontWeight: 800,
      }}
    >
      {STATUS_LABEL[status]}
    </span>
  );
};

const SummaryBox = ({ label, value }: { label: string; value: string | number }) => (
  <div
    style={{
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--bg-card)',
      padding: '16px 18px',
      minHeight: 82,
    }}
  >
    <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', fontWeight: 700 }}>{label}</div>
    <div style={{ marginTop: 8, fontSize: 'var(--fs-h2)', lineHeight: 1.1, fontWeight: 900 }}>{value}</div>
  </div>
);

const HrPeriodsPage = () => {
  const { toast } = useToast();
  const { reloadPeriods, setSelectedPeriodId } = useEvaluationPeriod();
  const [periods, setPeriods] = useState<EvaluationPeriod[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [form, setForm] = useState<PeriodForm>(() => getDefaultForm());

  const loadPeriods = useCallback(async () => {
    try {
      setIsLoading(true);
      setPeriods(await evaluationPeriodService.getPeriods());
    } catch (error) {
      toast({
        title: '평가기간을 불러오지 못했습니다.',
        description: error instanceof Error ? error.message : '다시 시도해 주세요.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadPeriods();
  }, [loadPeriods]);

  const activePeriod = useMemo(
    () => periods.find((period) => period.status === 'active' && period.is_default) ?? periods.find((period) => period.status === 'active'),
    [periods],
  );

  const summary = useMemo(
    () =>
      periods.reduce(
        (acc, period) => {
          acc.total += 1;
          acc[period.status] += 1;
          return acc;
        },
        { total: 0, draft: 0, active: 0, closed: 0, locked: 0 },
      ),
    [periods],
  );

  const handleYearChange = (value: string) => {
    setForm((prev) => {
      const previousDefaultCode = `${prev.evaluation_year}-annual`;
      const previousDefaultName = `${prev.evaluation_year} 연간 기여도 평가`;
      return {
        ...prev,
        evaluation_year: value,
        code: !prev.code || prev.code === previousDefaultCode ? `${value}-annual` : prev.code,
        name: !prev.name || prev.name === previousDefaultName ? `${value} 연간 기여도 평가` : prev.name,
        starts_on: `${value}-01-01`,
        ends_on: `${value}-12-31`,
      };
    });
  };

  const handleCreate = async () => {
    const year = Number(form.evaluation_year);
    if (!Number.isInteger(year)) {
      toast({ title: '연도를 숫자로 입력해 주세요.', variant: 'destructive' });
      return;
    }
    if (form.starts_on && form.ends_on && form.starts_on > form.ends_on) {
      toast({ title: '종료일은 시작일 이후여야 합니다.', variant: 'destructive' });
      return;
    }

    try {
      setIsCreating(true);
      const createdPeriod = await evaluationPeriodService.createPeriod({
        code: form.code.trim(),
        name: form.name.trim(),
        evaluation_year: year,
        starts_on: form.starts_on || null,
        ends_on: form.ends_on || null,
        status: form.status,
        is_default: form.status === 'active',
      });
      if (createdPeriod.status === 'active') {
        setSelectedPeriodId(createdPeriod.id);
      }
      setForm(getDefaultForm());
      setShowForm(false);
      await loadPeriods();
      await reloadPeriods();
      toast({ title: '평가기간을 생성했습니다.' });
    } catch (error) {
      toast({
        title: '평가기간 생성에 실패했습니다.',
        description: error instanceof Error ? error.message : '입력값을 확인해 주세요.',
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  const updateStatus = async (period: EvaluationPeriod, status: EvaluationPeriodStatus) => {
    if (status === 'locked' && period.status !== 'locked' && !window.confirm(`${period.name} 기간을 잠그시겠습니까?`)) {
      return;
    }

    try {
      setPendingId(period.id);
      if (status === 'active') {
        await evaluationPeriodService.activatePeriod(period.id);
      } else if (status === 'closed') {
        await evaluationPeriodService.closePeriod(period.id);
      } else if (status === 'locked') {
        await evaluationPeriodService.lockPeriod(period.id);
      } else {
        await evaluationPeriodService.updatePeriod(period.id, { status });
      }
      if (status === 'active') {
        setSelectedPeriodId(period.id);
      }
      await loadPeriods();
      await reloadPeriods();
      toast({ title: `평가기간 상태를 ${STATUS_LABEL[status]}(으)로 변경했습니다.` });
    } catch (error) {
      toast({
        title: '상태 변경에 실패했습니다.',
        description: error instanceof Error ? error.message : '다시 시도해 주세요.',
        variant: 'destructive',
      });
    } finally {
      setPendingId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="평가기간 관리"
        subtitle="기여도평가 라운드 생성, 활성화, 마감, 잠금"
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button className="sd-btn sd-btn-outline sd-btn-sm" onClick={loadPeriods} disabled={isLoading}>
              <RefreshCw size={15} />
              새로고침
            </button>
            <button className="sd-btn sd-btn-primary sd-btn-sm" onClick={() => setShowForm((value) => !value)}>
              <Plus size={15} />
              평가기간 추가
            </button>
          </div>
        }
      />

      <div style={{ padding: '24px 32px 32px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
          }}
        >
          <SummaryBox label="활성 평가기간" value={activePeriod?.name ?? '-'} />
          <SummaryBox label="전체 기간" value={summary.total} />
          <SummaryBox label="진행 중" value={summary.active} />
          <SummaryBox label="잠금" value={summary.locked} />
        </div>

        {showForm && (
          <section className="sd-card sd-card-lg">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
              <CalendarDays size={18} color="var(--ok-orange)" />
              <h2 style={{ fontSize: 'var(--fs-h4)', fontWeight: 900 }}>새 평가기간</h2>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 14,
              }}
            >
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--fs-sm)', fontWeight: 800 }}>
                연도
                <input
                  className="sd-input"
                  value={form.evaluation_year}
                  onChange={(event) => handleYearChange(event.target.value)}
                  inputMode="numeric"
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--fs-sm)', fontWeight: 800 }}>
                코드
                <input
                  className="sd-input"
                  value={form.code}
                  onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--fs-sm)', fontWeight: 800 }}>
                평가기간명
                <input
                  className="sd-input"
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--fs-sm)', fontWeight: 800 }}>
                시작일
                <input
                  className="sd-input"
                  type="date"
                  value={form.starts_on}
                  onChange={(event) => setForm((prev) => ({ ...prev, starts_on: event.target.value }))}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--fs-sm)', fontWeight: 800 }}>
                종료일
                <input
                  className="sd-input"
                  type="date"
                  value={form.ends_on}
                  onChange={(event) => setForm((prev) => ({ ...prev, ends_on: event.target.value }))}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--fs-sm)', fontWeight: 800 }}>
                초기 상태
                <select
                  className="sd-input"
                  value={form.status}
                  onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value as PeriodForm['status'] }))}
                >
                  <option value="draft">작성 전</option>
                  <option value="active">진행 중</option>
                </select>
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button className="sd-btn sd-btn-outline sd-btn-sm" onClick={() => setShowForm(false)}>
                취소
              </button>
              <button className="sd-btn sd-btn-primary sd-btn-sm" onClick={handleCreate} disabled={isCreating}>
                <Plus size={15} />
                생성
              </button>
            </div>
          </section>
        )}

        <section className="sd-card sd-card-lg" style={{ padding: 0, overflow: 'hidden' }}>
          {isLoading ? (
            <div style={{ padding: 20, color: 'var(--fg-muted)' }}>평가기간을 불러오는 중입니다.</div>
          ) : (
            <Table>
              <TableHeader style={{ background: 'var(--bg-muted)' }}>
                <TableRow>
                  <TableHead>평가기간</TableHead>
                  <TableHead>코드</TableHead>
                  <TableHead>연도</TableHead>
                  <TableHead>시작일</TableHead>
                  <TableHead>종료일</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead>기본</TableHead>
                  <TableHead className="text-right">작업</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map((period) => {
                  const isPending = pendingId === period.id;
                  const isActive = period.status === 'active';
                  const isLocked = period.status === 'locked';

                  return (
                    <TableRow key={period.id}>
                      <TableCell>
                        <strong>{period.name}</strong>
                        <div style={{ marginTop: 4, fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
                          생성 {formatDate(period.created_at)}
                        </div>
                      </TableCell>
                      <TableCell style={{ fontFamily: 'monospace', fontSize: 'var(--fs-sm)' }}>{period.code}</TableCell>
                      <TableCell>{period.evaluation_year}</TableCell>
                      <TableCell>{formatDate(period.starts_on)}</TableCell>
                      <TableCell>{formatDate(period.ends_on)}</TableCell>
                      <TableCell>
                        <StatusBadge status={period.status} />
                      </TableCell>
                      <TableCell>{period.is_default ? '예' : '-'}</TableCell>
                      <TableCell>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            className="sd-btn sd-btn-outline sd-btn-xs"
                            onClick={() => updateStatus(period, 'active')}
                            disabled={isPending || isActive || isLocked}
                          >
                            <CheckCircle2 size={14} />
                            활성화
                          </button>
                          <button
                            className="sd-btn sd-btn-outline sd-btn-xs"
                            onClick={() => updateStatus(period, 'closed')}
                            disabled={isPending || period.status === 'closed' || isLocked}
                          >
                            <Archive size={14} />
                            마감
                          </button>
                          <button
                            className="sd-btn sd-btn-outline sd-btn-xs"
                            onClick={() => updateStatus(period, 'locked')}
                            disabled={isPending || isLocked}
                          >
                            <LockKeyhole size={14} />
                            잠금
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}

                {!periods.length && (
                  <TableRow>
                    <TableCell colSpan={8} style={{ color: 'var(--fg-muted)' }}>
                      등록된 평가기간이 없습니다.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </section>
      </div>
    </>
  );
};

export default HrPeriodsPage;

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, CalendarDays, CheckCircle2, LockKeyhole, LockKeyholeOpen, Pencil, Plus, RefreshCw, Star, Trash2, X } from 'lucide-react';
import PageHeader from '@/components/Layout/PageHeader';
import { Pill, type PillTone } from '@/components/brand';
import { EmptyState, LoadingState } from '@/components/ui/state-views';
import { evaluationPeriodService } from '@/lib/services';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import type { EvaluationPeriod, EvaluationPeriodStatus } from '@/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DateRangePicker } from '@/components/ui/date-picker';
import { useToast } from '@/hooks/use-toast';
import { useConfirm } from '@/components/ui/confirm-dialog';

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

// 상태 배지 톤 — 공용 Pill(brand) 톤으로 통일 (Home 대시보드의 상태 톤 매핑과 동일 원칙)
const STATUS_TONE: Record<EvaluationPeriodStatus, PillTone> = {
  draft: 'neutral',
  active: 'orange',
  closed: 'success',
  locked: 'info',
};

const formatDate = (value: string | null) => (value ? value.slice(0, 10).replace(/-/g, '.') : '-');

const isValidPeriodDateInput = (value: string) => {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return (
    year >= 1000 &&
    year <= 9999 &&
    month >= 1 &&
    month <= 12 &&
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
};

const normalizeYearInput = (value: string) => value.replace(/\D/g, '').slice(0, 4);

const isValidYearInput = (value: string) => /^\d{4}$/.test(value);

const StatusBadge = ({ status }: { status: EvaluationPeriodStatus }) => (
  <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>
);

const SummaryBox = ({ label, value }: { label: string; value: string | number }) => (
  <div className="sd-card" style={{ padding: '16px 18px', minHeight: 82 }}>
    <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', fontWeight: 700 }}>{label}</div>
    <div className="tnum" style={{ marginTop: 8, fontSize: 'var(--fs-h2)', lineHeight: 1.1, fontWeight: 800 }}>{value}</div>
  </div>
);

const HrPeriodsPage = () => {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { reloadPeriods, setSelectedPeriodId } = useEvaluationPeriod();
  const [periods, setPeriods] = useState<EvaluationPeriod[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [form, setForm] = useState<PeriodForm>(() => getDefaultForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    name: string;
    code: string;
    evaluation_year: string;
    starts_on: string;
    ends_on: string;
  } | null>(null);
  const [savingEditId, setSavingEditId] = useState<string | null>(null);
  const [defaultPendingId, setDefaultPendingId] = useState<string | null>(null);
  const [deletePendingId, setDeletePendingId] = useState<string | null>(null);

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
    const nextYear = normalizeYearInput(value);
    setForm((prev) => {
      const previousDefaultCode = `${prev.evaluation_year}-annual`;
      const previousDefaultName = `${prev.evaluation_year} 연간 기여도 평가`;
      return {
        ...prev,
        evaluation_year: nextYear,
        code: !prev.code || prev.code === previousDefaultCode ? `${nextYear}-annual` : prev.code,
        name: !prev.name || prev.name === previousDefaultName ? `${nextYear} 연간 기여도 평가` : prev.name,
        starts_on: isValidYearInput(nextYear) ? `${nextYear}-01-01` : '',
        ends_on: isValidYearInput(nextYear) ? `${nextYear}-12-31` : '',
      };
    });
  };

  const handleCreate = async () => {
    const year = Number(form.evaluation_year);
    if (!isValidYearInput(form.evaluation_year) || !Number.isInteger(year)) {
      toast({ title: '연도는 4자리 숫자로 입력해 주세요.', variant: 'destructive' });
      return;
    }
    if (!isValidPeriodDateInput(form.starts_on) || !isValidPeriodDateInput(form.ends_on)) {
      toast({ title: '날짜는 YYYY-MM-DD 형식으로 입력해 주세요.', variant: 'destructive' });
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

  const startEdit = (period: EvaluationPeriod) => {
    setEditingId(period.id);
    setEditDraft({
      name: period.name,
      code: period.code,
      evaluation_year: String(period.evaluation_year),
      starts_on: period.starts_on ? period.starts_on.slice(0, 10) : '',
      ends_on: period.ends_on ? period.ends_on.slice(0, 10) : '',
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(null);
  };

  const saveEdit = async (period: EvaluationPeriod) => {
    if (!editDraft) return;

    const year = Number(editDraft.evaluation_year);
    if (!isValidYearInput(editDraft.evaluation_year) || !Number.isInteger(year)) {
      toast({ title: '연도는 4자리 숫자로 입력해 주세요.', variant: 'destructive' });
      return;
    }
    if (!isValidPeriodDateInput(editDraft.starts_on) || !isValidPeriodDateInput(editDraft.ends_on)) {
      toast({ title: '날짜는 YYYY-MM-DD 형식으로 입력해 주세요.', variant: 'destructive' });
      return;
    }
    if (editDraft.starts_on && editDraft.ends_on && editDraft.starts_on > editDraft.ends_on) {
      toast({ title: '종료일은 시작일 이후여야 합니다.', variant: 'destructive' });
      return;
    }
    const name = editDraft.name.trim();
    const code = editDraft.code.trim();
    if (!name || !code) {
      toast({ title: '평가기간명과 코드는 비워둘 수 없습니다.', variant: 'destructive' });
      return;
    }

    try {
      setSavingEditId(period.id);
      await evaluationPeriodService.updatePeriod(period.id, {
        name,
        code,
        evaluation_year: year,
        starts_on: editDraft.starts_on || null,
        ends_on: editDraft.ends_on || null,
      });
      await loadPeriods();
      await reloadPeriods();
      cancelEdit();
      toast({ title: '평가기간이 수정되었습니다.' });
    } catch (error) {
      toast({
        title: '평가기간 수정에 실패했습니다.',
        description: error instanceof Error ? error.message : '다시 시도해 주세요.',
        variant: 'destructive',
      });
    } finally {
      setSavingEditId(null);
    }
  };

  const setAsDefault = async (period: EvaluationPeriod) => {
    if (period.is_default) return;
    try {
      setDefaultPendingId(period.id);
      await evaluationPeriodService.updatePeriod(period.id, { is_default: true });
      setSelectedPeriodId(period.id);
      await loadPeriods();
      await reloadPeriods();
      toast({ title: `${period.name}이(가) 기본 평가기간으로 지정되었습니다.` });
    } catch (error) {
      toast({
        title: '기본 평가기간 지정 실패',
        description: error instanceof Error ? error.message : '다시 시도해 주세요.',
        variant: 'destructive',
      });
    } finally {
      setDefaultPendingId(null);
    }
  };

  const deletePeriod = async (period: EvaluationPeriod) => {
    const ok = await confirm({
      title: `"${period.name}" 평가기간을 삭제할까요?`,
      description: '평가 데이터가 연결되지 않은 평가기간만 삭제됩니다.',
      variant: 'danger',
      confirmText: '삭제',
    });
    if (!ok) return;
    try {
      setDeletePendingId(period.id);
      await evaluationPeriodService.deletePeriod(period.id);
      await loadPeriods();
      await reloadPeriods();
      toast({ title: '평가기간이 삭제되었습니다.' });
    } catch (error) {
      toast({
        title: '평가기간 삭제 실패',
        description: error instanceof Error ? error.message : '다시 시도해 주세요.',
        variant: 'destructive',
      });
    } finally {
      setDeletePendingId(null);
    }
  };

  const updateStatus = async (period: EvaluationPeriod, status: EvaluationPeriodStatus) => {
    if (status === 'locked' && period.status !== 'locked') {
      if (!(await confirm({ title: `${period.name} 기간을 잠그시겠습니까?`, confirmText: '잠금' }))) return;
    }
    if (period.status === 'locked' && status !== 'locked') {
      const ok = await confirm({
        title: `${period.name} 기간의 잠금을 해제하시겠습니까?`,
        description: `해제 후 ${STATUS_LABEL[status]} 상태로 돌아갑니다.`,
        confirmText: '잠금 해제',
      });
      if (!ok) return;
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
              <h2 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800 }}>새 평가기간</h2>
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
                  maxLength={4}
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
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--fs-sm)', fontWeight: 800, gridColumn: 'span 2' }}>
                기간
                <DateRangePicker
                  startValue={form.starts_on}
                  endValue={form.ends_on}
                  onChange={({ startDate, endDate }) =>
                    setForm((prev) => ({ ...prev, starts_on: startDate, ends_on: endDate }))
                  }
                  startPlaceholder="시작일"
                  endPlaceholder="종료일"
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

        {isLoading ? (
          <LoadingState message="평가기간을 불러오는 중입니다." />
        ) : !periods.length ? (
          <EmptyState message="등록된 평가기간이 없습니다." />
        ) : (
          <section className="sd-card sd-card-lg" style={{ padding: 0, overflow: 'hidden' }}>
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
                  const isEditing = editingId === period.id && Boolean(editDraft);
                  const isSavingEdit = savingEditId === period.id;
                  const isSettingDefault = defaultPendingId === period.id;
                  const isDeleting = deletePendingId === period.id;
                  const rowBusy = isPending || isSavingEdit || isSettingDefault || isDeleting;

                  return (
                    <TableRow key={period.id} className="row-hover">
                      <TableCell>
                        {isEditing && editDraft ? (
                          <input
                            className="sd-input"
                            value={editDraft.name}
                            onChange={(event) =>
                              setEditDraft((prev) => (prev ? { ...prev, name: event.target.value } : prev))
                            }
                            style={{ minWidth: 200 }}
                          />
                        ) : (
                          <>
                            <strong>{period.name}</strong>
                            <div className="tnum" style={{ marginTop: 4, fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
                              생성 {formatDate(period.created_at)}
                            </div>
                          </>
                        )}
                      </TableCell>
                      <TableCell style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)' }}>
                        {isEditing && editDraft ? (
                          <input
                            className="sd-input"
                            value={editDraft.code}
                            onChange={(event) =>
                              setEditDraft((prev) => (prev ? { ...prev, code: event.target.value } : prev))
                            }
                            style={{ minWidth: 130, fontFamily: 'var(--font-mono)' }}
                          />
                        ) : (
                          period.code
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing && editDraft ? (
                          <input
                            className="sd-input"
                            inputMode="numeric"
                            maxLength={4}
                            value={editDraft.evaluation_year}
                            onChange={(event) =>
                              setEditDraft((prev) =>
                                prev ? { ...prev, evaluation_year: normalizeYearInput(event.target.value) } : prev,
                              )
                            }
                            style={{ width: 80 }}
                          />
                        ) : (
                          period.evaluation_year
                        )}
                      </TableCell>
                      <TableCell colSpan={isEditing && editDraft ? 2 : undefined} className="tnum">
                        {isEditing && editDraft ? (
                          <DateRangePicker
                            startValue={editDraft.starts_on}
                            endValue={editDraft.ends_on}
                            onChange={({ startDate, endDate }) =>
                              setEditDraft((prev) =>
                                prev ? { ...prev, starts_on: startDate, ends_on: endDate } : prev,
                              )
                            }
                            className="w-[310px]"
                            startPlaceholder="시작일"
                            endPlaceholder="종료일"
                          />
                        ) : (
                          formatDate(period.starts_on)
                        )}
                      </TableCell>
                      {!(isEditing && editDraft) && (
                        <TableCell className="tnum">
                          {formatDate(period.ends_on)}
                        </TableCell>
                      )}
                      <TableCell>
                        <StatusBadge status={period.status} />
                      </TableCell>
                      <TableCell>
                        {period.is_default ? (
                          <Pill tone="orange">
                            <Star size={12} fill="currentColor" aria-hidden />
                            기본
                          </Pill>
                        ) : (
                          <button
                            className="sd-btn sd-btn-ghost sd-btn-xs"
                            onClick={() => setAsDefault(period)}
                            disabled={rowBusy || isLocked || isEditing}
                            title={
                              isLocked
                                ? '잠금된 평가기간은 기본으로 지정할 수 없습니다.'
                                : '클릭하면 이 평가기간을 기본으로 지정합니다.'
                            }
                          >
                            {isSettingDefault ? '지정 중' : '기본 지정'}
                          </button>
                        )}
                      </TableCell>
                      <TableCell>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' }}>
                          {isEditing ? (
                            <>
                              <button
                                className="sd-btn sd-btn-primary sd-btn-xs"
                                onClick={() => saveEdit(period)}
                                disabled={isSavingEdit}
                              >
                                {isSavingEdit ? '저장 중' : '저장'}
                              </button>
                              <button
                                className="sd-btn sd-btn-ghost sd-btn-xs"
                                onClick={cancelEdit}
                                disabled={isSavingEdit}
                              >
                                <X size={14} />
                                취소
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                className="sd-btn sd-btn-outline sd-btn-xs"
                                onClick={() => startEdit(period)}
                                disabled={rowBusy || isLocked}
                                title={isLocked ? '잠금된 평가기간은 수정할 수 없습니다.' : undefined}
                              >
                                <Pencil size={14} />
                                편집
                              </button>
                              <button
                                className="sd-btn sd-btn-outline sd-btn-xs"
                                onClick={() => updateStatus(period, 'active')}
                                disabled={rowBusy || isActive || isLocked}
                              >
                                <CheckCircle2 size={14} />
                                활성화
                              </button>
                              <button
                                className="sd-btn sd-btn-outline sd-btn-xs"
                                onClick={() => updateStatus(period, 'closed')}
                                disabled={rowBusy || period.status === 'closed' || isLocked}
                              >
                                <Archive size={14} />
                                마감
                              </button>
                              <button
                                className="sd-btn sd-btn-outline sd-btn-xs"
                                onClick={() => updateStatus(period, isLocked ? 'closed' : 'locked')}
                                disabled={rowBusy}
                                title={
                                  isLocked
                                    ? '잠금을 해제하고 마감 상태로 되돌립니다.'
                                    : '평가기간을 잠그면 모든 수정이 차단됩니다.'
                                }
                              >
                                {isLocked ? <LockKeyholeOpen size={14} /> : <LockKeyhole size={14} />}
                                {isLocked ? '잠금 해제' : '잠금'}
                              </button>
                              <button
                                className="sd-btn sd-btn-ghost sd-btn-xs"
                                onClick={() => deletePeriod(period)}
                                disabled={rowBusy || isLocked || period.is_default}
                                title={
                                  period.is_default
                                    ? '기본 평가기간은 삭제할 수 없습니다.'
                                    : isLocked
                                      ? '잠금된 평가기간은 삭제할 수 없습니다.'
                                      : '평가 데이터가 없는 평가기간을 삭제합니다.'
                                }
                                style={{ color: 'var(--danger)' }}
                              >
                                <Trash2 size={14} />
                                {isDeleting ? '삭제 중' : '삭제'}
                              </button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}

              </TableBody>
            </Table>
          </section>
        )}
      </div>
    </>
  );
};

export default HrPeriodsPage;

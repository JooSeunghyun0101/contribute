import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { DiffItem, DiffResult, DiffStatus } from '@/lib/uploadDiff';
import type { MatchingImportCounts } from '@/lib/services/employeeService';

// F2-1: 매칭 preview/apply 가 공통으로 돌려주는 17키 카운트(서버 계약)는
// employeeService 의 MatchingImportCounts 를 단일 원천으로 재사용한다.
export type { MatchingImportCounts };

// 탈락 사유별 요약 항목 — 0건은 숨긴다.
const DROP_ITEMS: Array<{ key: keyof MatchingImportCounts; label: (n: number) => string }> = [
  {
    key: 'stages_other_year_dropped',
    label: (n) => `연도 불일치로 제외된 발령 단계 ${n}건 (발령일 연도가 평가기간 연도와 다름)`,
  },
  {
    key: 'no_evaluator_rows',
    label: (n) => `평가자 없는 행 ${n}건 (평가자사번 공란·영문 — 반영 제외)`,
  },
  { key: 'dropped_letter_id', label: (n) => `영문 사번 행 폐기 ${n}건` },
  {
    key: 'ignored_date',
    label: (n) => `발령일 무시 ${n}건 (같은 평가자 — 발령일만 달라 기존 날짜 유지)`,
  },
  {
    key: 'name_mismatch',
    label: (n) => `성명 불일치 ${n}건 (매칭 업로드는 성명을 갱신하지 않습니다)`,
  },
  { key: 'employees_missing', label: (n) => `미등록 사번 ${n}건 (직원 마스터에 없어 건너뜀)` },
  { key: 'employees_no_stage', label: (n) => `반영할 발령 단계가 없어 건너뛴 직원 ${n}명` },
];

// 미리보기 모달과 업로드 결과 다이얼로그가 같은 형태로 재사용하는 요약 패널.
export const MatchingCountsSummary = ({
  counts,
  mode,
}: {
  counts: MatchingImportCounts;
  mode: 'preview' | 'result';
}) => {
  const drops = DROP_ITEMS.filter((d) => (counts[d.key] ?? 0) > 0);
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-sm)',
        background: 'var(--bg-subtle)',
        padding: '10px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        fontSize: 'var(--fs-sm)',
      }}
    >
      <strong>{mode === 'preview' ? '반영 제외·주의 요약' : '반영 제외·주의 상세'}</strong>
      {drops.length === 0 ? (
        <span style={{ color: 'var(--fg-muted)' }}>제외·주의 항목이 없습니다.</span>
      ) : (
        <ul
          style={{
            margin: 0,
            paddingLeft: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            color: 'var(--fg-muted)',
          }}
        >
          {drops.map((d) => (
            <li key={d.key}>{d.label(counts[d.key])}</li>
          ))}
        </ul>
      )}
      <span style={{ color: 'var(--fg-muted)' }}>
        무변경 <strong className="tnum">{counts.unchanged}</strong>건 —{' '}
        {mode === 'preview'
          ? '적용해도 값이 그대로인 발령 단계입니다(미리보기에서 "변경"으로 보여도 실제로는 무변경일 수 있음).'
          : '값이 그대로 유지된 발령 단계입니다.'}
      </span>
    </div>
  );
};

interface Props {
  title: string;
  fileName: string;
  result: DiffResult;
  isApplying: boolean;
  // F2-1: 매칭 업로드 미리보기에서만 전달 — 서버 dry-run 의 탈락 사유별 카운트.
  counts?: MatchingImportCounts | null;
  onConfirm: () => void;
  onClose: () => void;
}

const STATUS_META: Record<DiffStatus, { label: string; bg: string; color: string }> = {
  new: { label: '신규', bg: 'var(--ok-orange-50)', color: 'var(--ok-orange)' },
  changed: { label: '변경', bg: 'var(--warning-bg)', color: 'var(--warning)' },
  unchanged: { label: '동일', bg: 'var(--bg-muted)', color: 'var(--fg-muted)' },
  ignored: { label: '무시', bg: 'var(--bg-subtle)', color: 'var(--fg-subtle)' },
  error: { label: '오류', bg: 'var(--danger-bg)', color: 'var(--danger)' },
};

const Chip = ({ label, value, tone }: { label: string; value: number; tone: string }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 12px',
      borderRadius: 'var(--r-pill)',
      background: 'var(--bg-muted)',
      fontSize: 'var(--fs-sm)',
      fontWeight: 700,
    }}
  >
    <span
      aria-hidden
      style={{ width: 8, height: 8, borderRadius: 'var(--r-pill)', background: tone, display: 'inline-block', flexShrink: 0 }}
    />
    {label} <strong className="tnum">{value}</strong>
  </span>
);

const UploadPreviewModal = ({ title, fileName, result, isApplying, counts, onConfirm, onClose }: Props) => {
  const [showUnchanged, setShowUnchanged] = useState(false);
  const { summary } = result;

  const visibleItems = useMemo<DiffItem[]>(
    () => (showUnchanged ? result.items : result.items.filter((i) => i.status !== 'unchanged')),
    [result.items, showUnchanged],
  );

  const applicable = summary.new + summary.changed;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isApplying) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-[820px]"
        style={{ maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}
      >
        <DialogHeader>
          <DialogTitle>{title} · 변경 미리보기</DialogTitle>
          <DialogDescription>
            {fileName} · 예상 변경입니다. 실제 반영은 적용 후 확정됩니다.
          </DialogDescription>
        </DialogHeader>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <Chip label="신규" value={summary.new} tone={STATUS_META.new.color} />
          <Chip label="변경" value={summary.changed} tone={STATUS_META.changed.color} />
          {summary.ignored > 0 && <Chip label="무시" value={summary.ignored} tone={STATUS_META.ignored.color} />}
          <Chip label="동일" value={summary.unchanged} tone={STATUS_META.unchanged.color} />
          {summary.error > 0 && <Chip label="오류" value={summary.error} tone={STATUS_META.error.color} />}
          <label style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)', fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={showUnchanged}
              onChange={() => setShowUnchanged((v) => !v)}
              style={{ accentColor: 'var(--ok-orange)' }}
            />
            동일 항목도 표시
          </label>
        </div>

        {/* 대상자 업로드: 주민번호 뒷자리(초기 비밀번호) 입력 인원 안내 — 행 상태와 별개의 부수효과라 따로 보여준다. */}
        {((summary.rrnBackCount ?? 0) > 0 || (summary.rrnBackInvalidCount ?? 0) > 0) && (
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-sm)',
              background: 'var(--bg-subtle)',
              padding: '10px 14px',
              marginBottom: 12,
              fontSize: 'var(--fs-sm)',
              color: 'var(--fg-muted)',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <span>
              주민번호 뒷자리 입력 <strong className="tnum">{summary.rrnBackCount ?? 0}</strong>명 — 적용 시
              해당 인원의 초기 비밀번호(주민번호 뒷자리)가 설정됩니다. 값은 암호화(해시)되어 저장되며 평문은
              남지 않습니다.
            </span>
            {(summary.rrnBackInvalidCount ?? 0) > 0 && (
              <span style={{ color: 'var(--warning)' }}>
                형식 오류 <strong className="tnum">{summary.rrnBackInvalidCount}</strong>명 — 숫자 7자리가
                아니어서 초기 비밀번호가 설정되지 않습니다(경고로 처리).
              </span>
            )}
            <span>
              컬럼이 빈 인원은 기존 설정이 유지되며(해제 아님), 한 번도 등록된 적 없는 인원의 초기
              비밀번호는 사번입니다.
            </span>
          </div>
        )}

        {/* F2-1: 서버 counts 가 오면 "조용한 탈락" 사유를 전부 노출한다(0건 항목은 숨김). */}
        {counts && (
          <div style={{ marginBottom: 12 }}>
            <MatchingCountsSummary counts={counts} mode="preview" />
          </div>
        )}

        <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-muted)' }}>
              <tr>
                <th style={{ textAlign: 'left', padding: '8px 12px', width: 70 }}>구분</th>
                <th style={{ textAlign: 'left', padding: '8px 12px', width: 110 }}>이름</th>
                <th style={{ textAlign: 'left', padding: '8px 12px', width: 90, fontFamily: 'monospace' }}>사번</th>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>변경 내용</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => {
                const meta = STATUS_META[item.status];
                return (
                  <tr key={item.employeeId} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 'var(--r-pill)', background: meta.bg, color: meta.color, fontWeight: 700 }}>
                        {meta.label}
                      </span>
                    </td>
                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>{item.name}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: 'var(--fg-muted)' }}>{item.employeeId}</td>
                    <td style={{ padding: '8px 12px' }}>
                      {item.message ? (
                        <span style={{ color: meta.color }}>{item.message}</span>
                      ) : item.status === 'new' ? (
                        <span style={{ color: 'var(--fg-muted)' }}>
                          신규 등록{item.changes.find((c) => c.field === '평가자') ? ` · 평가자 ${item.changes.find((c) => c.field === '평가자')!.after}` : ''}
                        </span>
                      ) : item.changes.length ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {item.changes.map((c, idx) => (
                            <span key={idx}>
                              <strong>{c.field}</strong>: <span style={{ color: 'var(--fg-muted)' }}>{c.before}</span> → <span style={{ color: 'var(--fg)' }}>{c.after}</span>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--fg-muted)' }}>변동 없음</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {visibleItems.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: 16, color: 'var(--fg-muted)', textAlign: 'center' }}>
                    표시할 변경 항목이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 16 }}>
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
            적용 시 <strong>{applicable}건</strong>(신규 {summary.new} · 변경 {summary.changed})이 반영되고, 동일 {summary.unchanged}건은 그대로 유지됩니다.
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="sd-btn sd-btn-ghost sd-btn-sm" onClick={onClose} disabled={isApplying}>
              취소
            </button>
            <button
              className="sd-btn sd-btn-primary sd-btn-sm"
              onClick={onConfirm}
              disabled={isApplying || summary.total === 0}
            >
              {isApplying ? '적용 중…' : `적용 (${applicable}건)`}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default UploadPreviewModal;

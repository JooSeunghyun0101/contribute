import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { DiffItem, DiffResult, DiffStatus } from '@/lib/uploadDiff';

interface Props {
  title: string;
  fileName: string;
  result: DiffResult;
  isApplying: boolean;
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

const UploadPreviewModal = ({ title, fileName, result, isApplying, onConfirm, onClose }: Props) => {
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

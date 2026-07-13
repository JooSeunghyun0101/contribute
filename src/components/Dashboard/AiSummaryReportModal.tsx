import { useMemo, useState } from 'react';
import { Download, X, Copy, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Checkbox } from '@/components/ui/checkbox';
import { generateEvaluationSummaryReport } from '@/lib/gptOss';
import { AiOpinionButton } from '@/components/ui/ai-opinion-button';
import type { EmployeeEvaluationRecord } from '@/lib/dashboardData';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 마크다운(소제목 ##) 일부를 Word 용 HTML 로 변환.
const toDocHtml = (text: string, title: string) => {
  const body = text
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (t.startsWith('## ')) return `<h2>${escapeHtml(t.slice(3))}</h2>`;
      if (t.startsWith('# ')) return `<h1>${escapeHtml(t.slice(2))}</h1>`;
      if (!t) return '<br/>';
      return `<p>${escapeHtml(t)}</p>`;
    })
    .join('');
  return `<html><head><meta charset="utf-8"></head><body style="font-family:'Malgun Gothic',sans-serif;line-height:1.7;color:#222">
<h1>${escapeHtml(title)}</h1>${body}</body></html>`;
};

const download = (filename: string, content: string, mime: string) => {
  const blob = new Blob(['﻿' + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const AiSummaryReportModal = ({
  records,
  scopeLabel,
  onClose,
}: {
  records: EmployeeEvaluationRecord[];
  scopeLabel: string;
  onClose: () => void;
}) => {
  const { toast } = useToast();
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [report, setReport] = useState('');
  const [loading, setLoading] = useState(false);

  // 대상 풀 = 전사현황 화면에서 적용된 조직 필터 결과(상위에서 그대로 전달).
  const pool = records;
  const selected = useMemo(
    () => pool.filter((r) => !excluded.has(r.employee.employee_id)),
    [pool, excluded],
  );

  const allSelected = excluded.size === 0;
  const selectAll = () => setExcluded(new Set());
  const deselectAll = () => setExcluded(new Set(pool.map((r) => r.employee.employee_id)));

  const handleGenerate = async () => {
    if (selected.length === 0) {
      toast({ title: '대상자를 1명 이상 선택해 주세요.', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const total = selected.length;
      const completed = selected.filter((r) => r.status === 'completed').length;
      const achieved = selected.filter((r) => r.status === 'completed' && r.achieved).length;
      const fin = selected.filter((r) => r.status === 'completed');
      const averageScore =
        fin.length > 0 ? (fin.reduce((s, r) => s + r.weightedScore, 0) / fin.length).toFixed(1) : '-';
      const levelLines = [1, 2, 3, 4]
        .map((lv) => {
          const n = selected.filter((r) => (r.employee.growth_level ?? 1) === lv).length;
          return n > 0 ? `- Lv.${lv}: ${n}명` : null;
        })
        .filter(Boolean)
        .join('\n');
      const memberLines = selected
        .map(
          (r) =>
            `- ${r.employee.name}(${r.employee.position}, Lv.${r.employee.growth_level ?? '-'}): ` +
            `${r.status === 'completed' ? `점수 ${r.weightedScore.toFixed(1)}, ${r.achieved ? '달성' : '미달성'}` : '평가 전(미완료)'}`,
        )
        .join('\n');

      const text = await generateEvaluationSummaryReport({
        scopeLabel,
        totalMembers: total,
        completed,
        achieved,
        completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
        achievementRate: total > 0 ? Math.round((achieved / total) * 100) : 0,
        averageScore,
        levelLines: levelLines || '- (없음)',
        memberLines,
      });
      if (text.startsWith('⚠')) {
        toast({ title: 'AI 보고서 생성 실패', description: text, variant: 'destructive' });
      } else {
        setReport(text);
        toast({ title: 'AI 요약 보고서를 생성했습니다.', description: `${scopeLabel} · ${total}명` });
      }
    } catch (error) {
      toast({
        title: 'AI 보고서 생성 실패',
        description: error instanceof Error ? error.message : 'AI 호출 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const reportTitle = `기여도 평가 요약 보고서 - ${scopeLabel}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      toast({ title: '보고서를 복사했습니다.' });
    } catch {
      toast({ title: '복사 실패', variant: 'destructive' });
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--overlay)',
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
        style={{ width: 'min(1100px, 100%)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
      >
        <div
          style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={18} color="var(--ai-accent)" />
            <h2 style={{ fontSize: 'var(--fs-h3)', fontWeight: 900 }}>AI 요약 보고서</h2>
          </div>
          <button className="sd-btn sd-btn-ghost sd-btn-sm" onClick={onClose}>
            <X size={16} />
            닫기
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 320px) minmax(0, 1fr)', minHeight: 0, flex: 1 }}>
          {/* 좌: 대상 선택 */}
          <div style={{ borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10, borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 800, color: 'var(--fg-muted)' }}>
                  대상 범위 (전사현황 필터)
                </label>
                <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 800, color: 'var(--fg)' }}>{scopeLabel}</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="sd-btn sd-btn-outline sd-btn-sm"
                  style={{ flex: 1 }}
                  disabled={allSelected}
                  onClick={selectAll}
                >
                  전체 선택
                </button>
                <button
                  type="button"
                  className="sd-btn sd-btn-ghost sd-btn-sm"
                  style={{ flex: 1 }}
                  disabled={selected.length === 0}
                  onClick={deselectAll}
                >
                  전체 해제
                </button>
              </div>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
                대상자 <b style={{ color: 'var(--fg)' }}>{selected.length}</b>/{pool.length}명
              </div>
              <AiOpinionButton label="보고서 생성" loading={loading} onClick={handleGenerate} />
            </div>
            <div style={{ overflow: 'auto', padding: '8px 12px', flex: 1, minHeight: 0 }}>
              {pool.map((r) => {
                const checked = !excluded.has(r.employee.employee_id);
                return (
                  <label
                    key={r.employee.id}
                    className="row-hover"
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', borderRadius: 'var(--r-xs)', fontSize: 'var(--fs-sm)', cursor: 'pointer' }}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() =>
                        setExcluded((prev) => {
                          const next = new Set(prev);
                          if (next.has(r.employee.employee_id)) next.delete(r.employee.employee_id);
                          else next.add(r.employee.employee_id);
                          return next;
                        })
                      }
                    />
                    <span style={{ fontWeight: 700 }}>{r.employee.name}</span>
                    <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-xs)' }}>
                      {r.employee.position} · Lv.{r.employee.growth_level ?? '-'}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* 우: 보고서(편집 가능) */}
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <textarea
              value={report}
              onChange={(e) => setReport(e.target.value)}
              placeholder={loading ? 'AI가 보고서를 작성 중입니다…' : '좌측에서 대상을 고르고 "보고서 생성"을 누르면 여기에 표시됩니다. 생성 후 직접 편집할 수 있습니다.'}
              className="kbd-focus"
              style={{
                flex: 1,
                minHeight: 360,
                resize: 'none',
                border: 'none',
                padding: '18px 22px',
                fontSize: 'var(--fs-body)',
                lineHeight: 1.7,
                fontFamily: 'inherit',
                background: 'transparent',
                color: 'var(--fg)',
              }}
            />
            <div style={{ borderTop: '1px solid var(--border)', padding: '12px 18px', display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button className="sd-btn sd-btn-outline sd-btn-sm" disabled={!report} onClick={handleCopy}>
                <Copy size={14} />
                복사
              </button>
              <button
                className="sd-btn sd-btn-outline sd-btn-sm"
                disabled={!report}
                onClick={() => download(`${reportTitle}.txt`, report, 'text/plain;charset=utf-8')}
              >
                <Download size={14} />
                텍스트(.txt)
              </button>
              <button
                className="sd-btn sd-btn-primary sd-btn-sm"
                disabled={!report}
                onClick={() => download(`${reportTitle}.doc`, toDocHtml(report, reportTitle), 'application/msword')}
              >
                <Download size={14} />
                워드(.doc)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AiSummaryReportModal;

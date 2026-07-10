import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarDays, Save, Loader2 } from 'lucide-react';
import PageHeader from '@/components/Layout/PageHeader';
import { EvaluationMatrix } from '@/components/Settings/EvaluationMatrix';
import { useCompanyDashboardRecords } from '@/hooks/useDashboardRecords';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import { useExpectations } from '@/contexts/ExpectationContext';
import { useToast } from '@/hooks/use-toast';
import {
  cloneDefaultGrowthLevelExpectations,
  cloneDefaultScoreExpectations,
  cloneDefaultScoreGapExpectations,
  cloneDefaultMatrixGuide,
  getScoreColor,
  getScoreTextColor,
  MATRIX_METHODS,
  MATRIX_SCOPES,
  type ContributionScoreLevel,
  type GrowthLevel,
  type GrowthLevelExpectation,
  type ScoreExpectation,
  type ScoreGapBucket,
  type ScoreGapExpectation,
  type MatrixGuide,
} from '@/lib/evaluationMatrix';

const LEVEL_ORDER: GrowthLevel[] = [1, 2, 3, 4];
const GAP_ORDER: ScoreGapBucket[] = ['exceed', 'meet', 'near', 'below'];
const GAP_DESCRIPTION: Record<ScoreGapBucket, { title: string; gapDesc: string }> = {
  exceed: { title: '초과 (점수 > 성장레벨)', gapDesc: '점수가 성장레벨보다 +1 이상 높음' },
  meet: { title: '충족 (점수 = 성장레벨)', gapDesc: '점수가 성장레벨과 동일' },
  near: { title: '근접 (점수 = 성장레벨 - 1)', gapDesc: '점수가 성장레벨보다 1점 낮음' },
  below: { title: '미달 (점수 ≤ 성장레벨 - 2)', gapDesc: '점수가 성장레벨보다 2점 이상 낮음' },
};

const formatDate = (value: string | null | undefined) =>
  value ? value.slice(0, 10).replace(/-/g, '.') : '-';

const HrMatrixPage = () => {
  const navigate = useNavigate();
  const { records } = useCompanyDashboardRecords();
  const { selectedPeriod } = useEvaluationPeriod();
  const inProgressCount = records.filter((r) => r.status !== 'completed').length;
  const {
    growthLevelExpectations,
    scoreGapExpectations,
    matrixGuide,
    saveGrowthLevelExpectations,
    saveScoreGapExpectations,
    saveMatrixGuide,
  } = useExpectations();
  const { toast } = useToast();

  const [growthDraft, setGrowthDraft] = useState(growthLevelExpectations);
  const [gapDraft, setGapDraft] = useState(scoreGapExpectations);
  const [guideDraft, setGuideDraft] = useState<MatrixGuide>(matrixGuide);
  const [savingGrowth, setSavingGrowth] = useState(false);
  const [savingGap, setSavingGap] = useState(false);
  const [savingGuide, setSavingGuide] = useState(false);

  useEffect(() => {
    setGrowthDraft(growthLevelExpectations);
  }, [growthLevelExpectations]);
  useEffect(() => {
    setGapDraft(scoreGapExpectations);
  }, [scoreGapExpectations]);
  useEffect(() => {
    setGuideDraft(matrixGuide);
  }, [matrixGuide]);

  const growthDirty = JSON.stringify(growthDraft) !== JSON.stringify(growthLevelExpectations);
  const gapDirty = JSON.stringify(gapDraft) !== JSON.stringify(scoreGapExpectations);
  const guideDirty = JSON.stringify(guideDraft) !== JSON.stringify(matrixGuide);

  const handleSaveGuide = async () => {
    setSavingGuide(true);
    try {
      await saveMatrixGuide(guideDraft);
      toast({ title: '저장 완료', description: '매트릭스 가이드가 저장되었습니다.' });
    } catch (err) {
      toast({
        title: '저장 실패',
        description: err instanceof Error ? err.message : '알 수 없는 오류',
        variant: 'destructive',
      });
    } finally {
      setSavingGuide(false);
    }
  };
  const handleGuideReset = () => setGuideDraft(cloneDefaultMatrixGuide());

  const handleSaveGrowth = async () => {
    setSavingGrowth(true);
    try {
      await saveGrowthLevelExpectations(growthDraft);
      toast({ title: '저장 완료', description: '성장레벨별 기대수준이 저장되었습니다.' });
    } catch (err) {
      toast({
        title: '저장 실패',
        description: err instanceof Error ? err.message : '알 수 없는 오류',
        variant: 'destructive',
      });
    } finally {
      setSavingGrowth(false);
    }
  };

  const handleGrowthReset = () => setGrowthDraft(cloneDefaultGrowthLevelExpectations());
  const handleGapReset = () => setGapDraft(cloneDefaultScoreGapExpectations());

  const handleSaveGap = async () => {
    setSavingGap(true);
    try {
      await saveScoreGapExpectations(gapDraft);
      toast({ title: '저장 완료', description: '갭 기대수준이 저장되었습니다.' });
    } catch (err) {
      toast({
        title: '저장 실패',
        description: err instanceof Error ? err.message : '알 수 없는 오류',
        variant: 'destructive',
      });
    } finally {
      setSavingGap(false);
    }
  };

  return (
    <>
      <PageHeader
        title="평가 매트릭스 설정"
        subtitle="기여 방식·범위 점수 체계와 점수/성장레벨별 기대수준을 관리합니다"
      />

      <div
        style={{
          padding: '24px 32px 32px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {/* 상단: 매트릭스 + 정보 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.2fr) 280px',
            gap: 20,
          }}
        >
          <div className="sd-card sd-card-lg">
            <EvaluationMatrix />
          </div>

          <div className="flex flex-col gap-4">
            <div className="sd-card sd-card-lg">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  marginBottom: 14,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CalendarDays size={16} color="var(--ok-orange)" />
                  <div className="sd-label-mini" style={{ margin: 0 }}>적용 평가기간</div>
                </div>
                <button
                  className="sd-btn sd-btn-ghost sd-btn-xs"
                  onClick={() => navigate('/hr/periods')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--ok-orange)' }}
                >
                  관리
                  <ArrowRight size={12} />
                </button>
              </div>

              {selectedPeriod ? (
                <div className="flex flex-col gap-3">
                  <InfoRow label="평가기간">
                    <div style={{ fontWeight: 800 }}>{selectedPeriod.name}</div>
                    <div
                      style={{
                        marginTop: 2,
                        fontSize: 'var(--fs-xs)',
                        color: 'var(--fg-muted)',
                        fontFamily: 'monospace',
                      }}
                    >
                      {selectedPeriod.code}
                    </div>
                  </InfoRow>
                  <InfoRow label="적용 기간">
                    <div style={{ fontWeight: 700 }}>
                      {formatDate(selectedPeriod.starts_on)}
                      {' ~ '}
                      {formatDate(selectedPeriod.ends_on)}
                    </div>
                  </InfoRow>
                  <InfoRow label="적용 대상">
                    <div style={{ fontWeight: 700 }}>전사 {records.length}명</div>
                  </InfoRow>
                </div>
              ) : (
                <div
                  style={{
                    padding: 12,
                    borderRadius: 8,
                    background: 'var(--bg-muted)',
                    border: '1px dashed var(--border)',
                    color: 'var(--fg-muted)',
                    fontSize: 'var(--fs-sm)',
                    lineHeight: 1.55,
                  }}
                >
                  선택된 평가기간이 없습니다. 평가기간 관리에서 라운드를 생성·활성화해 주세요.
                </div>
              )}
            </div>

            {inProgressCount > 0 && (
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: 12,
                  background: 'var(--ok-orange-50)',
                  border: '1px solid var(--ok-orange-100)',
                  fontSize: 'var(--fs-sm)',
                  color: 'var(--ok-orange-700)',
                  lineHeight: 1.6,
                }}
              >
                <strong>주의</strong> · 적용 중인 매트릭스나 기대수준을 변경하면 진행 중인 평가 {inProgressCount}건에 영향이 있을 수 있습니다.
              </div>
            )}
          </div>
        </div>

        {/* 기여 방식·범위 가이드 편집 */}
        <section className="sd-card sd-card-lg">
          <SectionHeader
            index={1}
            label="기여 방식·범위 가이드"
            title="기여 방식 · 범위 정의"
            description="평가 화면·점수표의 방식/범위 라벨 hover 시, 그리고 매트릭스 가이드에 표시됩니다."
            onSave={handleSaveGuide}
            onReset={handleGuideReset}
            dirty={guideDirty}
            saving={savingGuide}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 20, marginTop: 14 }}>
            <div>
              <div className="sd-label-mini" style={{ marginBottom: 10 }}>기여 방식</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {MATRIX_METHODS.map((m) => (
                  <GuideFieldRow
                    key={m}
                    term={m}
                    value={guideDraft.methods[m] ?? ''}
                    onChange={(v) =>
                      setGuideDraft((prev) => ({ ...prev, methods: { ...prev.methods, [m]: v } }))
                    }
                  />
                ))}
              </div>
            </div>
            <div>
              <div className="sd-label-mini" style={{ marginBottom: 10 }}>기여 범위</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* 기여 방식(총괄→지원)과 같은 내림차순으로 맞추기 위해 범위는 전략적→의존적으로 표시 */}
                {[...MATRIX_SCOPES].reverse().map((s) => (
                  <GuideFieldRow
                    key={s}
                    term={s}
                    value={guideDraft.scopes[s] ?? ''}
                    onChange={(v) =>
                      setGuideDraft((prev) => ({ ...prev, scopes: { ...prev.scopes, [s]: v } }))
                    }
                  />
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* 성장레벨별 기대수준 편집 */}
        <section className="sd-card sd-card-lg">
          <SectionHeader
            index={2}
            label="성장 레벨별 기대수준"
            title="Lv.1~4 직급별 기준"
            description="평가 화면 헤더의 성장 레벨 hover 툴팁에 표시됩니다."
            onSave={handleSaveGrowth}
            onReset={handleGrowthReset}
            dirty={growthDirty}
            saving={savingGrowth}
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 14,
              marginTop: 14,
            }}
          >
            {LEVEL_ORDER.map((level) => (
              <GrowthEditor
                key={level}
                level={level}
                value={growthDraft[level]}
                onChange={(next) =>
                  setGrowthDraft((prev) => ({ ...prev, [level]: { ...next, level } }))
                }
              />
            ))}
          </div>
        </section>

        {/* 점수-성장레벨 갭별 기대수준 편집 (상대적 메시지) */}
        <section className="sd-card sd-card-lg">
          <SectionHeader
            index={3}
            label="점수-성장레벨 갭별 기대수준"
            title="상대 평가 메시지 (초과/충족/근접/미달)"
            description="평가 화면·매트릭스 셀 hover 시, 피평가자의 성장레벨 대비 점수 갭에 따라 표시되는 상대적 메시지입니다."
            onSave={handleSaveGap}
            onReset={handleGapReset}
            dirty={gapDirty}
            saving={savingGap}
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 14,
              marginTop: 14,
            }}
          >
            {GAP_ORDER.map((bucket) => (
              <GapEditor
                key={bucket}
                bucket={bucket}
                value={gapDraft[bucket]}
                onChange={(next) =>
                  setGapDraft((prev) => ({ ...prev, [bucket]: { ...next, bucket } }))
                }
              />
            ))}
          </div>
        </section>
      </div>
    </>
  );
};

const InfoRow = ({ label, children }: { label: string; children: ReactNode }) => (
  <div>
    <div
      style={{
        fontSize: 'var(--fs-xs)',
        fontWeight: 700,
        color: 'var(--fg-muted)',
        marginBottom: 4,
      }}
    >
      {label}
    </div>
    <div style={{ fontSize: 'var(--fs-sm)' }}>{children}</div>
  </div>
);

type SectionHeaderProps = {
  label: string;
  title: string;
  description: string;
  /** 편집 섹션 단계 번호(있으면 제목 앞 배지로 표시). */
  index?: number;
  onSave: () => void;
  onReset: () => void;
  dirty: boolean;
  saving: boolean;
};

const SectionHeader = ({
  label,
  title,
  description,
  index,
  onSave,
  onReset,
  dirty,
  saving,
}: SectionHeaderProps) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 16,
      flexWrap: 'wrap',
    }}
  >
    <div>
      <div className="sd-label-mini">{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
        {index !== undefined && (
          <span
            style={{
              flexShrink: 0,
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: 'var(--ok-orange)',
              color: '#fff',
              fontSize: 'var(--fs-xs)',
              fontWeight: 900,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {index}
          </span>
        )}
        <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800 }}>{title}</h3>
      </div>
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', marginTop: 4 }}>
        {description}
      </div>
    </div>
    <div style={{ display: 'flex', gap: 8 }}>
      <button
        type="button"
        onClick={onReset}
        disabled={saving}
        className="sd-btn sd-btn-outline sd-btn-sm"
      >
        기본값
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={!dirty || saving}
        className="sd-btn sd-btn-primary sd-btn-sm"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          opacity: dirty && !saving ? 1 : 0.6,
        }}
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
        저장
      </button>
    </div>
  </div>
);

const Field = ({
  label,
  value,
  onChange,
  rows = 2,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) => (
  <div>
    <label
      style={{
        fontSize: 'var(--fs-xs)',
        fontWeight: 700,
        color: 'var(--fg-muted)',
        display: 'block',
        marginBottom: 6,
      }}
    >
      {label}
    </label>
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      className="sd-input"
      style={{
        width: '100%',
        resize: 'vertical',
        fontSize: 'var(--fs-sm)',
        lineHeight: 1.55,
        fontFamily: 'inherit',
      }}
    />
  </div>
);

const GrowthEditor = ({
  level,
  value,
  onChange,
}: {
  level: GrowthLevel;
  value: GrowthLevelExpectation;
  onChange: (next: GrowthLevelExpectation) => void;
}) => (
  <div
    style={{
      padding: 14,
      borderRadius: 10,
      background: 'var(--bg-muted)',
      border: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div
        style={{
          minWidth: 56,
          padding: '6px 12px',
          borderRadius: 8,
          background: 'var(--ok-orange-50)',
          color: 'var(--ok-orange-700)',
          border: '1px solid var(--ok-orange-100)',
          fontSize: 'var(--fs-body)',
          fontWeight: 900,
          textAlign: 'center',
        }}
      >
        Lv.{level}
      </div>
      <input
        value={value.title}
        onChange={(e) => onChange({ ...value, title: e.target.value })}
        className="sd-input"
        placeholder="레벨 직급 이름 (예: Lv.3 차장)"
        style={{ flex: 1, fontSize: 'var(--fs-body)', fontWeight: 800 }}
      />
    </div>
    <Field
      label="레벨별 최소 기대"
      value={value.minimumExpectation}
      onChange={(v) => onChange({ ...value, minimumExpectation: v })}
      rows={3}
    />
    <Field
      label="높은 기여 판단 포인트"
      value={value.stretchExpectation}
      onChange={(v) => onChange({ ...value, stretchExpectation: v })}
      rows={3}
    />
  </div>
);

const GapEditor = ({
  bucket,
  value,
  onChange,
}: {
  bucket: ScoreGapBucket;
  value: ScoreGapExpectation;
  onChange: (next: ScoreGapExpectation) => void;
}) => {
  const meta = GAP_DESCRIPTION[bucket];
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 10,
        background: 'var(--bg-muted)',
        border: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 'var(--fs-xs)',
            fontWeight: 700,
            color: 'var(--fg-muted)',
            letterSpacing: '0.04em',
          }}
        >
          {meta.title}
        </div>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)', marginTop: 2 }}>
          {meta.gapDesc}
        </div>
      </div>
      <input
        value={value.label}
        onChange={(e) => onChange({ ...value, label: e.target.value })}
        className="sd-input"
        placeholder="등급명 (예: 탁월 기여)"
        style={{ fontSize: 'var(--fs-body)', fontWeight: 800 }}
      />
      <Field
        label="요약"
        value={value.summary}
        onChange={(v) => onChange({ ...value, summary: v })}
      />
      <Field
        label="상세 설명"
        value={value.detail}
        onChange={(v) => onChange({ ...value, detail: v })}
        rows={3}
      />
    </div>
  );
};

const GuideFieldRow = ({
  term,
  value,
  onChange,
}: {
  term: string;
  value: string;
  onChange: (v: string) => void;
}) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
    <span
      style={{
        flexShrink: 0,
        minWidth: 52,
        fontSize: 'var(--fs-sm)',
        fontWeight: 800,
        color: 'var(--ok-orange)',
      }}
    >
      {term}
    </span>
    <input
      className="sd-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="설명을 입력하세요"
      style={{ flex: 1, fontSize: 'var(--fs-sm)' }}
    />
  </div>
);

export default HrMatrixPage;

import PageHeader from '@/components/Layout/PageHeader';
import { EvaluationMatrix } from '@/components/Settings/EvaluationMatrix';
import { useCompanyDashboardRecords } from '@/hooks/useDashboardRecords';

const GRADE_ITEMS = [
  { score: 4, bg: '#F55000', label: '탁월', grade: 'S급', desc: '4점 · 매트릭스 기여도' },
  { score: 3, bg: '#D94400', label: '우수', grade: 'A급', desc: '3점 · 매트릭스 기여도' },
  { score: 2, bg: '#FFAA00', label: '양호', grade: 'B급', desc: '2점 · 매트릭스 기여도' },
  { score: 1, bg: '#C2BAB0', label: '기대 미달', grade: 'C급', desc: '1점 · 매트릭스 기여도' },
];

const HrMatrixPage = () => {
  const { records } = useCompanyDashboardRecords();
  const inProgressCount = records.filter((r) => r.status !== 'completed').length;

  return (
    <>
      <PageHeader
        title="평가 매트릭스 설정"
        subtitle="기여 방식(행) × 기여 범위(열) 점수 체계를 정의합니다"
      />

      <div
        style={{
          padding: '24px 32px 32px',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.2fr) 280px',
          gap: 20,
        }}
      >
        {/* Left: matrix grid */}
        <div className="sd-card sd-card-lg">
          <EvaluationMatrix />
        </div>

        {/* Right sidebar */}
        <div className="flex flex-col gap-4">
          {/* 매트릭스 정보 */}
          <div className="sd-card sd-card-lg">
            <div className="sd-label-mini" style={{ marginBottom: 14 }}>매트릭스 정보</div>
            <div className="flex flex-col gap-4">
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-muted)', display: 'block', marginBottom: 6 }}>버전</label>
                <input className="sd-input" defaultValue="v2.1 — 2026 연간" style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-muted)', display: 'block', marginBottom: 6 }}>적용 기간</label>
                <input className="sd-input" defaultValue="2026-01-01 ~ 2026-12-31" style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-muted)', display: 'block', marginBottom: 6 }}>적용 대상</label>
                <select className="sd-input" defaultValue="전사" style={{ width: '100%' }}>
                  <option value="전사">전사 ({records.length}명)</option>
                </select>
              </div>
            </div>
          </div>

          {/* 점수별 등급 */}
          <div className="sd-card sd-card-lg">
            <div className="sd-label-mini" style={{ marginBottom: 14 }}>점수별 등급</div>
            <div className="flex flex-col gap-3">
              {GRADE_ITEMS.map((item) => (
                <div
                  key={item.score}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: 'var(--bg-muted)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      background: item.bg,
                      color: item.score === 2 ? '#4A1A00' : '#fff',
                      fontSize: 14,
                      fontWeight: 900,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {item.score}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>
                      {item.label} · {item.grade}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 1 }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Warning */}
          {inProgressCount > 0 && (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 12,
                background: '#FFF7ED',
                border: '1px solid #FDBA74',
                fontSize: 12,
                color: '#9A3412',
                lineHeight: 1.6,
              }}
            >
              <strong>주의</strong> · 적용 중인 매트릭스를 변경하면 진행 중인 평가 {inProgressCount}건에 영향이 있을 수 있습니다.
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default HrMatrixPage;

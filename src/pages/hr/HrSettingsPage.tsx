import PageHeader from '@/components/Layout/PageHeader';
import { NotificationSettings } from '@/components/Settings/NotificationSettings';
import { useAllEmployees } from '@/hooks/useDashboardRecords';

const ROLE_CARDS = [
  { id: 'hr', label: 'HR', desc: '시스템 설정 전체', borderColor: '#2563EB', color: '#EFF6FF' },
  { id: 'evaluator', label: '평가자', desc: '팀원 평가 · 피드백 작성', borderColor: '#F55000', color: 'var(--ok-orange-50)' },
  { id: 'evaluatee', label: '피평가자', desc: '과업 등록 · 피드백 열람', borderColor: 'var(--border)', color: 'var(--bg-muted)' },
];

const HrSettingsPage = () => {
  const { employees } = useAllEmployees();

  const counts = {
    hr: employees.filter((e) => e.available_roles.includes('hr')).length,
    evaluator: employees.filter((e) => e.available_roles.includes('evaluator')).length,
    evaluatee: employees.filter((e) => e.available_roles.includes('evaluatee')).length,
  };

  return (
    <>
      <PageHeader
        title="시스템 설정"
        subtitle="평가 기간 · 알림 · 권한 · 매트릭스 · 전사 공통 설정"
      />

      <div className="flex flex-col gap-6" style={{ padding: '24px 32px 32px' }}>
        {/* 평가 주기 */}
        <section className="sd-card sd-card-lg">
          <h3 style={{ fontSize: 16, fontWeight: 800, marginBottom: 20 }}>평가 주기</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            <div>
              <label
                style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-muted)', display: 'block', marginBottom: 6 }}
              >
                평가 주기
              </label>
              <select
                className="sd-input"
                defaultValue="연간"
                style={{ width: '100%' }}
              >
                <option value="연간">연간 (연 1회)</option>
                <option value="반기">반기 (연 2회)</option>
                <option value="분기">분기 (연 4회)</option>
              </select>
            </div>
            <div>
              <label
                style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-muted)', display: 'block', marginBottom: 6 }}
              >
                현재 라운드
              </label>
              <input
                className="sd-input"
                defaultValue="2026"
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label
                style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-muted)', display: 'block', marginBottom: 6 }}
              >
                마감일
              </label>
              <input
                className="sd-input"
                type="date"
                defaultValue="2026-12-31"
                style={{ width: '100%' }}
              />
            </div>
          </div>
        </section>

        {/* 알림 설정 */}
        <section className="sd-card sd-card-lg">
          <h3 style={{ fontSize: 16, fontWeight: 800, marginBottom: 20 }}>알림 설정</h3>
          <NotificationSettings onClose={() => {}} />
        </section>

        {/* 권한 & 역할 */}
        <section className="sd-card sd-card-lg">
          <h3 style={{ fontSize: 16, fontWeight: 800, marginBottom: 20 }}>권한 &amp; 역할</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
            {ROLE_CARDS.map((card) => {
              const count = counts[card.id as keyof typeof counts];
              return (
                <div
                  key={card.id}
                  style={{
                    padding: '20px 22px',
                    borderRadius: 14,
                    background: card.color,
                    border: `1.5px solid ${card.borderColor}`,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: '0.06em',
                      color: card.borderColor,
                      marginBottom: 10,
                    }}
                  >
                    {card.label}
                  </div>
                  <div
                    style={{
                      fontSize: 32,
                      fontWeight: 900,
                      color: card.borderColor,
                      lineHeight: 1,
                    }}
                  >
                    {count}
                    <span style={{ fontSize: 16, fontWeight: 600, marginLeft: 4 }}>명</span>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--fg-muted)' }}>{card.desc}</div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
};

export default HrSettingsPage;

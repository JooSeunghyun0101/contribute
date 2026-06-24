// 공용 UI 컴포넌트 & 아이콘 (OK 디자인시스템)

const { useState, useEffect, useRef, useMemo } = React;

// ============================================================
// Icons (inline SVG, 2px stroke, 20x20 기본)
// ============================================================
const I = {
  home:    (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 12l9-9 9 9"/><path d="M5 10v10h14V10"/></svg>,
  users:   (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="9" cy="8" r="3.5"/><path d="M2 21c0-3.8 3.1-6 7-6s7 2.2 7 6"/><circle cx="17" cy="7" r="2.5"/><path d="M22 19c0-2.8-2-4.5-5-4.5"/></svg>,
  target:  (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>,
  chart:   (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 3v18h18"/><rect x="7" y="11" width="3" height="7"/><rect x="13" y="6" width="3" height="12"/><rect x="19" y="14" width="0.5" height="4"/></svg>,
  settings:(p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3h0a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8v0a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>,
  bell:    (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 004 0"/></svg>,
  check:   (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="4 12 10 18 20 6"/></svg>,
  clock:   (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/></svg>,
  msg:     (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>,
  trend:   (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>,
  search:  (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>,
  plus:    (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  chevron: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="9 6 15 12 9 18"/></svg>,
  chevronDown: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="6 9 12 15 18 9"/></svg>,
  arrowRight: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>,
  sparkle: (p) => <svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M12 2l2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2z"/></svg>,
  calendar:(p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></svg>,
  send:    (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  file:    (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="14 3 14 9 20 9"/></svg>,
  x:       (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>,
  user:    (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>,
  grid:    (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  book:    (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 19.5A2.5 2.5 0 016.5 17H20V3H6.5A2.5 2.5 0 004 5.5v14z"/></svg>,
  moon:    (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>,
  sun:     (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>,
  logout:  (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
};

// ============================================================
// OK 로고 마크 (SVG)
// ============================================================
const OkMark = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" style={{ flexShrink: 0 }}>
    {/* yellow arc */}
    <path d="M 8 20 A 12 12 0 0 1 32 20" stroke="var(--ok-yellow)" strokeWidth="4.5" fill="none" strokeLinecap="round"/>
    {/* orange stem */}
    <rect x="17.5" y="14" width="5" height="14" rx="1.5" fill="var(--ok-orange)"/>
    {/* red dot */}
    <circle cx="20" cy="33" r="2.6" fill="var(--ok-orange)"/>
  </svg>
);

const BrandLockup = ({ compact = false }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
    <OkMark size={compact ? 24 : 28} />
    {!compact && (
      <div style={{ lineHeight: 1.1 }}>
        <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: '-0.02em' }}>OK<span style={{ color: 'var(--ok-orange)' }}>!</span>Contribute</div>
        <div style={{ fontSize: 10, color: 'var(--fg-subtle)', fontWeight: 600, letterSpacing: '0.08em' }}>기여도평가시스템</div>
      </div>
    )}
  </div>
);

// ============================================================
// Device frame — 1440x900 데스크탑 뷰
// ============================================================
const AppFrame = ({ children, width = 1440, height = 900 }) => (
  <div style={{
    width, height,
    background: 'var(--bg-app)',
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    border: '1px solid var(--border)',
    boxShadow: 'var(--sh-sm)',
    fontFamily: 'var(--font-sans)',
    color: 'var(--fg)',
  }}>{children}</div>
);

// ============================================================
// 상단 앱바 (역할 전환 포함)
// ============================================================
const TopBar = ({ role, onRole, user, onBell, unread = 3, onLogout, theme, onTheme }) => {
  const roles = [
    { id: 'evaluatee', label: '피평가자' },
    { id: 'evaluator', label: '평가자' },
    { id: 'hr',        label: 'HR 관리자' },
  ];
  return (
    <header style={{
      height: 60, padding: '0 20px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: 'var(--bg-card)',
      borderBottom: '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <BrandLockup />
        <div style={{ height: 22, width: 1, background: 'var(--border)' }} />
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-muted)', padding: 3, borderRadius: 8 }}>
          {roles.map(r => (
            <button key={r.id}
              onClick={() => onRole(r.id)}
              style={{
                padding: '5px 12px', borderRadius: 6,
                fontSize: 13, fontWeight: 600,
                color: role === r.id ? '#fff' : 'var(--fg-muted)',
                background: role === r.id ? 'var(--ok-orange)' : 'transparent',
                transition: 'all 160ms',
              }}>{r.label}</button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', left: 12, top: 10, color: 'var(--fg-subtle)' }}>
            <I.search width={16} height={16} />
          </div>
          <input className="input" placeholder="과업/직원/피드백 검색" style={{ paddingLeft: 36, width: 260, height: 36 }}/>
        </div>
        <button className="btn btn-ghost" onClick={onTheme} title={theme==='dark'?'라이트 모드':'다크 모드'} style={{ padding: 8 }}>
          {theme==='dark' ? <I.sun width={18} height={18}/> : <I.moon width={18} height={18}/>}
        </button>
        <button className="btn btn-ghost" onClick={onBell} style={{ position: 'relative', padding: 8 }}>
          <I.bell width={20} height={20}/>
          {unread > 0 && (
            <span style={{
              position: 'absolute', top: 4, right: 4,
              background: 'var(--ok-orange)', color: '#fff',
              fontSize: 10, fontWeight: 700,
              minWidth: 16, height: 16, borderRadius: 10,
              padding: '0 4px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '2px solid var(--bg-card)',
            }}>{unread}</span>
          )}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 8, borderLeft: '1px solid var(--border)' }}>
          <div className="avatar">{user.name[0]}</div>
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{user.name} <span style={{ color: 'var(--fg-muted)', fontWeight: 500 }}>{user.position}</span></div>
            <div style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>{user.dept} · Lv.{user.level}</div>
          </div>
        </div>
      </div>
    </header>
  );
};

// ============================================================
// Sidebar
// ============================================================
const Sidebar = ({ page, onPage, role }) => {
  const items = {
    evaluatee: [
      { id: 'dashboard', label: '내 대시보드', icon: I.home },
      { id: 'tasks', label: '내 과업', icon: I.target },
      { id: 'schedule', label: '과업 일정', icon: I.calendar },
      { id: 'feedback', label: '피드백 이력', icon: I.msg },
    ],
    evaluator: [
      { id: 'dashboard', label: '평가 보드 (칸반)', icon: I.grid },
      { id: 'scores', label: '직원별 점수', icon: I.chart },
      { id: 'team', label: '담당 팀원', icon: I.users },
      { id: 'schedule', label: '전체 일정', icon: I.calendar },
      { id: 'feedback', label: '피드백 내역', icon: I.msg },
    ],
    hr: [
      { id: 'dashboard', label: '전사 현황', icon: I.home },
      { id: 'departments', label: '부서별 진행', icon: I.chart },
      { id: 'matrix', label: '평가 매트릭스', icon: I.grid },
      { id: 'users', label: '사용자 관리', icon: I.users },
      { id: 'settings', label: '시스템 설정', icon: I.settings },
    ],
  };
  const list = items[role] || items.evaluatee;

  return (
    <aside style={{
      width: 220, flexShrink: 0,
      background: 'var(--bg-card)',
      borderRight: '1px solid var(--border)',
      padding: '16px 12px',
      display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <div className="label-mini" style={{ padding: '6px 10px 10px' }}>MENU</div>
      {list.map(item => {
        const active = page === item.id;
        const Icon = item.icon;
        return (
          <button key={item.id}
            onClick={() => onPage(item.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 11,
              padding: '10px 12px',
              borderRadius: 8,
              fontSize: 14, fontWeight: active ? 700 : 500,
              color: active ? 'var(--ok-orange)' : 'var(--fg)',
              background: active ? 'var(--ok-orange-50)' : 'transparent',
              textAlign: 'left',
              position: 'relative',
              transition: 'background-color 160ms, color 160ms',
            }}>
            {active && <span style={{
              position: 'absolute', left: 0, top: 6, bottom: 6, width: 3,
              background: 'var(--ok-orange)', borderRadius: 2,
            }}/>}
            <Icon width={18} height={18}/>
            <span>{item.label}</span>
          </button>
        );
      })}
      <div style={{ marginTop: 'auto', padding: '14px 10px', borderTop: '1px solid var(--border)' }}>
        <div className="label-mini" style={{ marginBottom: 8 }}>평가 기간</div>
        <div style={{ fontSize: 13, fontWeight: 700 }}>2026 상반기</div>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>~ 4월 30일 (D-7)</div>
        <div className="bar" style={{ marginTop: 10, height: 4 }}>
          <div className="fill" style={{ width: '78%' }}/>
        </div>
      </div>
    </aside>
  );
};

// ============================================================
// Stat card
// ============================================================
const StatCard = ({ icon: Icon, label, value, sub, accent = false, trend }) => (
  <div className="card" style={{
    padding: 18,
    background: accent ? 'linear-gradient(135deg, var(--ok-orange) 0%, var(--ok-orange-600) 100%)' : 'var(--bg-card)',
    color: accent ? '#fff' : 'inherit',
    border: accent ? 'none' : '1px solid var(--border)',
  }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <div className="label-mini" style={{ color: accent ? 'rgba(255,255,255,0.85)' : 'var(--fg-subtle)' }}>{label}</div>
      <div style={{ opacity: accent ? 0.85 : 0.6 }}><Icon width={18} height={18}/></div>
    </div>
    <div className="tnum" style={{ fontSize: 30, fontWeight: 800, marginTop: 8, letterSpacing: '-0.03em' }}>{value}</div>
    {sub && <div style={{ fontSize: 12, color: accent ? 'rgba(255,255,255,0.85)' : 'var(--fg-muted)', marginTop: 4 }}>{sub}</div>}
    {trend != null && (
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: accent ? '#fff' : 'var(--success)', fontWeight: 700 }}>
        <I.trend width={14} height={14}/> +{trend}%
      </div>
    )}
  </div>
);

// Export to window
Object.assign(window, { I, OkMark, BrandLockup, AppFrame, TopBar, Sidebar, StatCard });

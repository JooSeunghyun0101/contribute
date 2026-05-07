import { NavLink } from 'react-router-dom';
import type { ComponentType, SVGProps } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import type { UserRole } from '@/types';
import {
  CountdownCard,
  IconHome,
  IconTarget,
  IconCalendar,
  IconMsg,
  IconGrid,
  IconChart,
  IconUsers,
  IconSettings,
  IconSparkle,
} from '@/components/brand';

type IconComp = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

type MenuItem = {
  to: string;
  label: string;
  icon: IconComp;
  end?: boolean;
};

const menus: Record<UserRole, MenuItem[]> = {
  evaluatee: [
    { to: '/my', label: '내 대시보드', icon: IconHome, end: true },
    { to: '/my/tasks', label: '내 과업', icon: IconTarget },
    { to: '/my/schedule', label: '과업 일정', icon: IconCalendar },
    { to: '/my/feedback', label: '피드백 이력', icon: IconMsg },
  ],
  evaluator: [
    { to: '/team', label: '평가 보드', icon: IconGrid, end: true },
    { to: '/team/scores', label: '직원별 점수', icon: IconChart },
    { to: '/team/members', label: '담당 팀원', icon: IconUsers },
    { to: '/team/schedule', label: '전체 일정', icon: IconCalendar },
    { to: '/team/feedback', label: '피드백 내역', icon: IconMsg },
    { to: '/team/ai', label: 'AI 도움말', icon: IconSparkle },
  ],
  hr: [
    { to: '/hr', label: '전사 현황', icon: IconHome, end: true },
    { to: '/hr/periods', label: '평가기간 관리', icon: IconCalendar },
    { to: '/hr/departments', label: '부서별 진행', icon: IconChart },
    { to: '/hr/matrix', label: '평가 매트릭스', icon: IconGrid },
    { to: '/hr/users', label: '사용자 관리', icon: IconUsers },
    { to: '/hr/prompts', label: 'AI 프롬프트', icon: IconMsg },
    { to: '/hr/settings', label: '시스템 설정', icon: IconSettings },
  ],
};

export const Sidebar = () => {
  const { user } = useAuth();
  if (!user) return null;

  const list = menus[user.role] ?? menus.evaluatee;

  return (
    <aside
      style={{
        width: 'var(--sidebar-w)',
        flexShrink: 0,
        background: 'var(--bg-card)',
        borderRight: '1px solid var(--border)',
        padding: '16px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <div className="sd-label-mini" style={{ padding: '6px 10px 10px' }}>
        MENU
      </div>

      {list.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className="sd-sidebar-link"
          >
            {({ isActive }) => (
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 11,
                  padding: '10px 12px',
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: isActive ? 700 : 500,
                  color: isActive ? 'var(--ok-orange)' : 'var(--fg)',
                  background: isActive ? 'var(--ok-orange-50)' : 'transparent',
                  textAlign: 'left',
                  position: 'relative',
                  transition: 'background-color 160ms, color 160ms',
                }}
              >
                {isActive && (
                  <span
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 6,
                      bottom: 6,
                      width: 3,
                      background: 'var(--ok-orange)',
                      borderRadius: 2,
                    }}
                  />
                )}
                <Icon size={18} />
                <span>{item.label}</span>
              </span>
            )}
          </NavLink>
        );
      })}

      <CountdownCard />
    </aside>
  );
};

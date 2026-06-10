import { NavLink } from 'react-router-dom';
import { Fragment } from 'react';
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
  IconArrowRight,
  IconCheck,
  IconBell,
} from '@/components/brand';

type IconComp = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

type MenuItem = {
  to: string;
  label: string;
  icon: IconComp;
  end?: boolean;
  group?: string;
};

const menus: Record<UserRole, MenuItem[]> = {
  evaluatee: [
    { to: '/my', label: '내 대시보드', icon: IconHome, end: true },
    { to: '/my/tasks', label: '내 과업', icon: IconTarget },
    { to: '/my/schedule', label: '과업 일정', icon: IconCalendar },
    { to: '/my/feedback', label: '피드백 이력', icon: IconMsg },
    { to: '/my/evaluator-request', label: '평가자 변경요청', icon: IconArrowRight },
  ],
  evaluator: [
    { to: '/team', label: '팀 통계', icon: IconChart, end: true },
    { to: '/team/board', label: '평가 보드', icon: IconGrid },
    { to: '/team/members', label: '담당 팀원', icon: IconUsers },
    { to: '/team/schedule', label: '전체 일정', icon: IconCalendar },
    { to: '/team/feedback', label: '피드백 내역', icon: IconMsg },
    { to: '/team/evaluator-request', label: '평가자 변경요청', icon: IconArrowRight },
    { to: '/team/ai', label: 'AI 도움말', icon: IconSparkle },
  ],
  hr: [
    { to: '/hr', label: '전사 현황', icon: IconHome, end: true, group: '현황·분석' },
    { to: '/hr/departments', label: '부서별 진행', icon: IconChart, group: '현황·분석' },
    { to: '/hr/job-role-benchmark', label: '직종 벤치마크', icon: IconChart, group: '현황·분석' },
    { to: '/hr/change-requests', label: '변경요청 승인', icon: IconCheck, group: '운영' },
    { to: '/hr/reminders', label: '독려·리마인드', icon: IconBell, group: '운영' },
    { to: '/hr/notices-faq', label: '공지·FAQ', icon: IconMsg, group: '운영' },
    { to: '/hr/prompts', label: 'AI 품질·검수', icon: IconMsg, group: '품질' },
    { to: '/hr/quality', label: '평가 품질 점검', icon: IconCheck, group: '품질' },
    { to: '/hr/periods', label: '평가기간 관리', icon: IconCalendar, group: '설정' },
    { to: '/hr/matrix', label: '평가 매트릭스', icon: IconGrid, group: '설정' },
    { to: '/hr/users', label: '사용자 관리', icon: IconUsers, group: '설정' },
    { to: '/hr/matching', label: '매칭 정합성 점검', icon: IconCheck, group: '설정' },
    { to: '/hr/settings', label: '시스템 설정', icon: IconSettings, group: '설정' },
  ],
};

export const Sidebar = () => {
  const { user } = useAuth();
  if (!user) return null;

  const list = menus[user.role] ?? menus.evaluatee;
  const hasGroups = list.some((item) => item.group);
  let prevGroup: string | undefined;

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
      {!hasGroups && (
        <div className="sd-label-mini" style={{ padding: '6px 10px 10px' }}>
          MENU
        </div>
      )}

      {list.map((item) => {
        const Icon = item.icon;
        const showHeader = item.group !== undefined && item.group !== prevGroup;
        prevGroup = item.group;
        return (
          <Fragment key={item.to}>
            {showHeader && (
              <div className="sd-label-mini" style={{ padding: '12px 10px 6px' }}>
                {item.group}
              </div>
            )}
            <NavLink to={item.to} end={item.end} className="sd-sidebar-link">
              {({ isActive }) => (
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 11,
                    padding: '10px 12px',
                    borderRadius: 8,
                    fontSize: 'var(--fs-body)',
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
          </Fragment>
        );
      })}

      <CountdownCard />
    </aside>
  );
};

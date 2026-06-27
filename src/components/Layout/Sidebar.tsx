import { NavLink, useLocation } from 'react-router-dom';
import { Fragment, useEffect, useMemo, useState } from 'react';
import type { ComponentType, SVGProps } from 'react';
import { ChevronDown } from 'lucide-react';
import { AccordionMotion } from '@/components/ui/accordion-motion';
import { useAuth } from '@/contexts/AuthContext';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
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
  IconFile,
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
    { to: '/my/ai', label: 'AI 도움말', icon: IconSparkle },
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
    { to: '/hr/insights', label: '평가 인사이트', icon: IconChart, group: '현황·분석' },
    { to: '/hr/people-search', label: 'AI 인물검색', icon: IconSparkle, group: '현황·분석' },
    { to: '/hr/evaluation-viewer', label: '피평가자 평가 열람', icon: IconTarget, group: '현황·분석' },
    { to: '/hr/change-requests', label: '변경요청 승인', icon: IconCheck, group: '운영' },
    { to: '/hr/audit-logs', label: '감사 로그', icon: IconFile, group: '운영' },
    { to: '/hr/reminders', label: '리마인드·AI검수', icon: IconBell, group: '운영' },
    { to: '/hr/notices-faq', label: '공지·FAQ', icon: IconMsg, group: '운영' },
    { to: '/hr/periods', label: '평가기간 관리', icon: IconCalendar, group: '설정' },
    { to: '/hr/matrix', label: '평가 매트릭스', icon: IconGrid, group: '설정' },
    { to: '/hr/users', label: '사용자 관리', icon: IconUsers, group: '설정' },
    { to: '/hr/settings', label: '시스템 설정', icon: IconSettings, group: '설정' },
  ],
};

const COLLAPSED_STORAGE_KEY = 'sidebar-collapsed-groups';

const readCollapsed = (): Set<string> => {
  try {
    const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((g): g is string => typeof g === 'string') : []);
  } catch {
    return new Set();
  }
};

const matchesItem = (pathname: string, item: MenuItem) =>
  item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);

export const Sidebar = () => {
  const { user } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);

  // 좌하단 평가기간 카드 — 하드코딩이 아니라 '현재 선택한 평가기간'을 그대로 반영한다.
  const { selectedPeriod } = useEvaluationPeriod();
  const countdownProps = useMemo(() => {
    if (!selectedPeriod) return { cycle: '평가 기간', remaining: '불러오는 중…', progress: 0 };
    const cycle = `${selectedPeriod.evaluation_year} 연간`;
    const fmtDate = (value: string | null) => {
      if (!value) return null;
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : `${d.getMonth() + 1}월 ${d.getDate()}일`;
    };
    if (selectedPeriod.status === 'closed') return { cycle, remaining: '마감됨', progress: 100 };
    if (selectedPeriod.status === 'locked') return { cycle, remaining: '잠금됨', progress: 100 };
    if (selectedPeriod.status === 'draft') return { cycle, remaining: '작성 전', progress: 0 };
    // active — 시작~종료 기준 진행률.
    const end = fmtDate(selectedPeriod.ends_on);
    const startMs = selectedPeriod.starts_on ? new Date(selectedPeriod.starts_on).getTime() : NaN;
    const endMs = selectedPeriod.ends_on ? new Date(selectedPeriod.ends_on).getTime() : NaN;
    let progress = 0;
    if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs > startMs) {
      progress = Math.max(0, Math.min(100, Math.round(((Date.now() - startMs) / (endMs - startMs)) * 100)));
    }
    return { cycle, remaining: end ? `~ ${end}` : '진행 중', progress };
  }, [selectedPeriod]);

  const list = user ? menus[user.role] ?? menus.evaluatee : [];
  const hasGroups = list.some((item) => item.group);

  // 그룹 순서를 보존하며 묶는다.
  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, MenuItem[]>();
    for (const item of list) {
      const key = item.group ?? '';
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(item);
    }
    return order.map((group) => ({ group, items: map.get(group)! }));
  }, [list]);

  // 현재 경로가 속한 그룹(가장 길게 일치하는 항목 기준).
  const activeGroup = useMemo(() => {
    let best: { len: number; group: string } | null = null;
    for (const item of list) {
      if (matchesItem(location.pathname, item) && (!best || item.to.length > best.len)) {
        best = { len: item.to.length, group: item.group ?? '' };
      }
    }
    return best?.group;
  }, [list, location.pathname]);

  // 활성 항목이 든 그룹은 자동으로 펼친다(접혀 있어도 풀어 현재 위치가 보이게).
  useEffect(() => {
    if (!activeGroup) return;
    setCollapsed((prev) => {
      if (!prev.has(activeGroup)) return prev;
      const next = new Set(prev);
      next.delete(activeGroup);
      return next;
    });
  }, [activeGroup]);

  if (!user) return null;

  const toggleGroup = (group: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      try {
        localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        /* 저장 실패는 무시 */
      }
      return next;
    });
  };

  const renderLink = (item: MenuItem) => {
    const Icon = item.icon;
    return (
      <NavLink key={item.to} to={item.to} end={item.end} className="sd-sidebar-link">
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
            <Icon
              size={18}
              style={{ color: isActive ? 'var(--ok-orange)' : 'var(--fg-muted)', flexShrink: 0 }}
            />
            <span>{item.label}</span>
          </span>
        )}
      </NavLink>
    );
  };

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
        <div
          style={{
            padding: '6px 8px 8px',
            fontSize: 'var(--fs-xs)',
            fontWeight: 700,
            color: 'var(--fg-subtle)',
            letterSpacing: '0.09em',
            textTransform: 'uppercase',
          }}
        >
          메뉴
        </div>
      )}

      {hasGroups
        ? groups.map(({ group, items }, idx) => {
            const isCollapsed = collapsed.has(group);
            return (
              <Fragment key={group}>
                {/* 카테고리 헤딩 — 항목과 명확히 구분되는 섹션 라벨(작고·흐리고·자간 넓게). 그룹 사이 구분선. */}
                <button
                  type="button"
                  onClick={() => toggleGroup(group)}
                  aria-expanded={!isCollapsed}
                  title={isCollapsed ? `${group} 펼치기` : `${group} 접기`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: idx > 0 ? '14px 8px 6px' : '6px 8px 6px',
                    marginTop: idx > 0 ? 8 : 0,
                    background: 'none',
                    border: 'none',
                    borderTop: idx > 0 ? '1px solid var(--border)' : 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span
                    style={{
                      fontSize: 'var(--fs-xs)',
                      fontWeight: 700,
                      color: 'var(--fg-subtle)',
                      letterSpacing: '0.09em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {group}
                  </span>
                  <ChevronDown
                    size={13}
                    style={{
                      color: 'var(--fg-subtle)',
                      opacity: 0.6,
                      transform: isCollapsed ? 'rotate(-90deg)' : 'none',
                      transition: 'transform 160ms',
                      flexShrink: 0,
                    }}
                  />
                </button>
                <AccordionMotion
                  isOpen={!isCollapsed}
                  contentStyle={{ display: 'flex', flexDirection: 'column', gap: 2 }}
                >
                  {items.map(renderLink)}
                </AccordionMotion>
              </Fragment>
            );
          })
        : list.map(renderLink)}

      <CountdownCard {...countdownProps} />
    </aside>
  );
};

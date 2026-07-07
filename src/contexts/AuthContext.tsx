import React, { createContext, useContext, useState, useEffect } from 'react';
import { authService } from '@/lib/services';
import { setUnauthorizedHandler, setActiveRole, SESSION_EXPIRED_STORAGE_KEY } from '@/lib/api';
import { User, Employee, UserRole } from '@/types';

interface LoginResult {
  ok: boolean;
  message?: string;
  mustChangePassword?: boolean;
}

interface AuthContextType {
  user: User | null;
  /** true면 최초(또는 리셋) 로그인 — 비밀번호 변경 전까지 앱 진입이 차단된다(ProtectedRoute). */
  mustChangePassword: boolean;
  login: (employeeId: string, password: string, role?: string) => Promise<LoginResult>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ ok: boolean; message?: string }>;
  logout: () => void;
  switchRole: (role: UserRole) => Promise<void>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// 역할 선호는 UX 설정일 뿐 신원이 아니다 — 신원·세션은 서버 쿠키만 신뢰한다.
const PREFERRED_ROLE_KEY = 'preferredRole';

// 역할은 서버가 준 employee.available_roles 만 신뢰한다(임시 백도어 제거 — S-3).
// 서버 측 권한도 동일 기준(requireHr)이라 클라이언트 조작만으로는 HR 기능을 쓸 수 없다.
const getAvailableRolesFromEmployee = (employee: Employee): UserRole[] => {
  const roles = employee.available_roles as UserRole[];
  return Array.isArray(roles) && roles.length > 0 ? roles : ['evaluatee'];
};

const buildUser = (employee: Employee, preferredRole?: UserRole): User => {
  const availableRoles = getAvailableRolesFromEmployee(employee);
  const role = preferredRole && availableRoles.includes(preferredRole) ? preferredRole : availableRoles[0];
  return {
    id: employee.id,
    employeeId: employee.employee_id,
    name: employee.name,
    department: employee.department,
    position: employee.position,
    // 성장 레벨은 0 또는 undefined일 경우 1로 기본값을 설정
    growthLevel: employee.growth_level && employee.growth_level > 0 ? employee.growth_level : 1,
    evaluatorId: employee.evaluator_id || undefined,
    aiRuleExempt: employee.ai_rule_exempt ?? false,
    availableRoles,
    role,
  };
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  // 부팅 시 서버 세션(/api/auth/me) 복원이 끝날 때까지 로딩 — ProtectedRoute가 스피너를 띄운다.
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // 과거 버전이 localStorage에 저장하던 신원 캐시는 더 이상 신뢰하지 않는다 — 제거만 한다.
    localStorage.removeItem('currentUser');
    (async () => {
      try {
        const session = await authService.me();
        if (cancelled) return;
        const preferred = (localStorage.getItem(PREFERRED_ROLE_KEY) as UserRole | null) ?? undefined;
        const restored = buildUser(session.employee, preferred);
        setUser(restored);
        setActiveRole(restored.role);
        setMustChangePassword(session.must_change_password);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // apiFetch 가 401(세션 만료/무효)을 만나면 사용자 상태를 비운다 → ProtectedRoute 가 /login 으로 보낸다.
  // (서버 재시작·idle TTL 로 인메모리 세션이 사라졌을 때 깨진 토스트 대신 자연스러운 재로그인.)
  useEffect(() => {
    setUnauthorizedHandler(() => {
      // 로그인된 상태에서 맞은 401만 '세션 만료'로 기록 → Login 이 1회성 안내를 띄운다.
      // 직접 로그아웃은 authFetch 경유라 이 핸들러를 타지 않고, logout()이 user 를 먼저
      // 비우므로(동일 배치에서 이 updater 보다 앞서 반영) 잔여 요청의 401에도 플래그가 남지 않는다.
      setUser((current) => {
        if (current) sessionStorage.setItem(SESSION_EXPIRED_STORAGE_KEY, '1');
        return null;
      });
      setActiveRole(null);
      setMustChangePassword(false);
      localStorage.removeItem(PREFERRED_ROLE_KEY);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = async (employeeId: string, password: string, role?: string): Promise<LoginResult> => {
    try {
      const session = await authService.login(employeeId, password);
      const loggedInUser = buildUser(session.employee, role as UserRole | undefined);
      setUser(loggedInUser);
      setActiveRole(loggedInUser.role);
      setMustChangePassword(session.must_change_password);
      localStorage.setItem(PREFERRED_ROLE_KEY, loggedInUser.role);
      return { ok: true, mustChangePassword: session.must_change_password };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '로그인에 실패했습니다.' };
    }
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    try {
      await authService.changePassword(currentPassword, newPassword);
      setMustChangePassword(false);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '비밀번호 변경에 실패했습니다.' };
    }
  };

  const switchRole = async (role: UserRole) => {
    if (!user || !user.availableRoles.includes(role)) return;
    setUser({ ...user, role });
    setActiveRole(role);
    localStorage.setItem(PREFERRED_ROLE_KEY, role);
  };

  const logout = () => {
    // 서버 세션 무효화는 베스트에포트 — 실패해도 클라이언트 상태는 비운다.
    void authService.logout().catch(() => {});
    setUser(null);
    setActiveRole(null);
    setMustChangePassword(false);
    localStorage.removeItem(PREFERRED_ROLE_KEY);
  };

  return (
    <AuthContext.Provider
      value={{ user, mustChangePassword, login, changePassword, logout, switchRole, isLoading }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

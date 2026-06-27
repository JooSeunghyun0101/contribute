
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { FullScreenLoader } from '@/components/ui/loader';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: ('hr' | 'evaluator' | 'evaluatee')[];
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedRoles }) => {
  const { user, isLoading, mustChangePassword } = useAuth();

  if (isLoading) {
    return <FullScreenLoader message="로딩 중..." />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // 최초(또는 리셋) 로그인은 비밀번호를 바꾸기 전까지 앱 진입 차단 — 로그인 화면이 변경 폼을 띄운다.
  if (mustChangePassword) {
    return <Navigate to="/login" replace />;
  }

  // 권한이 맞지 않으면 현재 user.role 의 기본 홈(/)으로 redirect.
  // 루트 `/`는 RoleRedirect 가 user.role 에 맞춰 /hr · /team · /my 로 보내준다.
  // 권한 전환 직후/직접 URL 입력 모두 동일하게 처리되어 빈 권한 페이지 대신
  // 새 권한의 상위 메뉴로 자연스럽게 진입한다.
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;

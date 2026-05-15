
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: ('hr' | 'evaluator' | 'evaluatee')[];
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedRoles }) => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin mx-auto mb-4"></div>
          <p>로딩 중...</p>
        </div>
      </div>
    );
  }

  if (!user) {
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

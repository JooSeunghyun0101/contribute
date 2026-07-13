import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname
    );
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="mx-auto mb-6 w-20 h-20 bg-card rounded-lg flex items-center justify-center border border-border">
          <img src="/느낌표_orange.png" alt="OK 로고" className="w-12 h-12" />
        </div>
        <h1 className="text-4xl font-bold mb-4 text-foreground">404</h1>
        <p className="text-xl text-muted-foreground mb-2">페이지를 찾을 수 없습니다</p>
        <p className="text-sm text-muted-foreground mb-6">
          주소가 잘못되었거나 삭제·이동된 페이지입니다.
        </p>
        <Link to="/" className="sd-btn sd-btn-primary">
          홈으로 이동
        </Link>
      </div>
    </div>
  );
};

export default NotFound;

import PageHeader from '@/components/Layout/PageHeader';
import PasswordResetManager from '@/components/hr/PasswordResetManager';

// 비밀번호 초기화 승인 — 시스템 설정 탭 안에 묻혀 2클릭이던 것을 '운영' 그룹 독립 메뉴로 승격.
// 변경요청 승인과 같은 성격(승인 대기 업무)이라 나란히 두고, 사이드바 배지로 대기 건수를 바로 노출한다.
const HrPasswordResetsPage = () => (
  <div>
    <PageHeader
      title="비밀번호 초기화 승인"
      subtitle="직원의 비밀번호 초기화 요청을 승인·반려하거나, 요청 없이 직접 초기화합니다. 초기화 시 비밀번호는 초기 비밀번호(주민번호 뒷자리, 미등록 시 사번)로 되돌아갑니다."
    />
    <div style={{ padding: '24px 32px 32px' }}>
      <PasswordResetManager />
    </div>
  </div>
);

export default HrPasswordResetsPage;

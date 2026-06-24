import { useEffect } from 'react';

/**
 * F-2: 미저장 변경이 있을 때(isDirty=true) 새로고침·탭닫기 시 브라우저 이탈 경고를 띄운다.
 * 컴포넌트별 dirty 상태에 연결해 사용한다(자체 로컬 편집 상태를 쓰는 에디터용).
 * isDirty 가 false 면 리스너를 붙이지 않아 불필요한 경고가 없다.
 */
export const useUnsavedChangesWarning = (isDirty: boolean): void => {
  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // 일부 브라우저는 returnValue 설정을 요구(메시지 자체는 브라우저 표준 문구로 대체됨).
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);
};

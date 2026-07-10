import type { ReactNode } from 'react';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';

type Props = {
  children: ReactNode;
  /** @deprecated — 페이지 내부 헤더를 사용하세요 (Solar Dusk 패턴) */
  pageTitle?: string;
};

export const AppLayout = ({ children }: Props) => (
  <div
    className="h-screen flex flex-col overflow-hidden"
    style={{ background: 'var(--bg-app)', color: 'var(--fg)' }}
  >
    <TopBar />
    <div className="flex-1 flex overflow-hidden">
      <Sidebar />
      {/* overflow-auto(가로+세로): 창이 --content-min-w 보다 좁아지면 본문만 가로 스크롤된다.
          내부 래퍼의 minWidth 바닥이 고정 그리드의 으스러짐·글자 줄바뀜 깨짐을 일괄 차단한다. */}
      <main className="flex-1 overflow-auto">
        <div style={{ minWidth: 'var(--content-min-w)' }}>{children}</div>
      </main>
    </div>
  </div>
);

export default AppLayout;

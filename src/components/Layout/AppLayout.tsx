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
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  </div>
);

export default AppLayout;

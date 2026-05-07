import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { testSupabaseConnection } from './lib/connectionTest'

// 앱 시작 시 Supabase 연결 테스트
testSupabaseConnection();

// Solar Dusk: 다크 모드 기본 적용
document.documentElement.classList.add('dark');

createRoot(document.getElementById("root")!).render(<App />);

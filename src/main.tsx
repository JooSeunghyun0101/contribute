import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Solar Dusk: 다크 모드 기본 적용
document.documentElement.classList.add('dark');

createRoot(document.getElementById("root")!).render(<App />);

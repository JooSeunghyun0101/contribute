/**
 * 기능 플래그 — 빌드 시점 환경변수(VITE_*)로 화면 노출을 제어한다.
 *
 * ORG_KPI_ENABLED: 조직 KPI 화면(사이드바 메뉴 + /kpi 라우트) 노출 여부.
 *  - 기본 OFF — KPI 기능은 검증 완료 전까지 '대기'(사용자 결정 2026-07-06).
 *    코드·서버 API 는 그대로 유지되고 화면 진입점만 잠근다(직접 URL 진입은 404).
 *  - 로컬 개발/검증: .env(gitignore됨)에 `VITE_ENABLE_ORG_KPI=1` 을 두면 켜진다.
 *  - 정식 공개 시: 배포 환경변수에 1을 설정하거나 이 기본값을 바꾼다.
 */
export const ORG_KPI_ENABLED = import.meta.env.VITE_ENABLE_ORG_KPI === '1';

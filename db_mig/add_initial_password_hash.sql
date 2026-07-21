-- 초기 비밀번호를 사번 → 주민번호 뒷자리(7자리)로 전환 — additive·멱등
-- initial_password_hash: 대상자 업로드의 '주민번호 뒷자리' 컬럼을 서버가 즉시 bcrypt 해시해 저장.
--   평문 주민번호는 DB 어디에도 저장하지 않는다(업로드 이력 raw_data 에서도 제거).
-- 로그인 규칙: password_hash IS NULL(초기 상태)일 때
--   initial_password_hash 가 있으면 주민번호 뒷자리로 검증, 없으면 기존처럼 사번(전환기·admin 호환).
-- 비밀번호 초기화(승인/직접)는 기존처럼 password_hash=NULL 로만 되돌리면
--   자동으로 주민번호 뒷자리가 초기 비밀번호가 된다.

ALTER TABLE employees ADD COLUMN IF NOT EXISTS initial_password_hash TEXT;

COMMENT ON COLUMN employees.initial_password_hash IS '초기 비밀번호(주민번호 뒷자리 7자리)의 bcrypt 해시. NULL=미등록(초기 비밀번호=사번 폴백). 평문 미저장.';

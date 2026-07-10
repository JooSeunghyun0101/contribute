-- 인증(자체 비밀번호, G-1) 기반 컬럼 — additive·멱등 (deploy-readiness S-1a)
-- password_hash: bcrypt 해시. NULL = 초기 상태(초기 비밀번호=사번, 로그인 성공 시 변경 강제).
-- must_change_password: 최초 로그인(또는 HR 리셋) 후 비밀번호 변경을 강제하는 플래그.

ALTER TABLE employees ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN employees.password_hash IS 'bcrypt 해시. NULL=초기 상태(초기 비밀번호=사번, 첫 로그인 시 변경 강제)';
COMMENT ON COLUMN employees.must_change_password IS 'true면 로그인 직후 비밀번호 변경 강제';

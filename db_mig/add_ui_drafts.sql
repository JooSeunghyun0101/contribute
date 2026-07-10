-- S2: 임시저장 draft 서버 보관 — 기기 간 이어서 작성(localStorage 유실 대비).
-- payload = 클라이언트 draft 맵(JSON) 그대로 보관하며 서버는 내용을 해석하지 않는다.
-- 접근은 소유자(owner_id = 세션 사용자) 본인만 — server.js /api/drafts 라우트에서 강제.
CREATE TABLE IF NOT EXISTS ui_drafts (
  owner_id   TEXT        NOT NULL,
  draft_key  TEXT        NOT NULL,
  payload    JSONB       NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, draft_key)
);

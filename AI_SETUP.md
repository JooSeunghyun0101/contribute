# AI 연동 설정

AI 호출은 **서버 프록시(`/api/ai/chat`) 전용**이다. 브라우저(프런트엔드)는 LLM을 직접 호출하지 않으며,
LLM 키/엔드포인트는 **서버 `.env` 에만** 둔다. `VITE_` 접두 변수는 클라이언트 번들에 노출되므로 **AI 키에 사용 금지**.

## 환경변수 (서버 `.env`)

`.env.example` 을 `.env` 로 복사한 뒤 대상 머신에서만 값을 채운다.

```env
# [임시·테스트] 외부 OpenAI 호환 API — 예) Groq
#   AI_BASE_URL=https://api.groq.com/openai/v1
#   AI_MODEL=openai/gpt-oss-120b  /  AI_REASONING_EFFORT=low  /  AI_API_KEY=<키>
#   ⚠ 외부 API로 전송되므로 실제 평가 데이터 검수에 쓰지 말고 테스트/샘플로만 사용.
#   ⚠ 구 GitHub Models 는 2026-07-30 폐지(HTTP 410) — 사용 불가.
# [운영·내부망] GPT-OSS 로 전환 — 아래 세 줄만 설정(AI_API_KEY 불필요)
#   AI_BASE_URL=http://172.17.170.201:8000/v1
#   AI_MODEL=gpt-oss-120b
#   AI_REASONING_EFFORT=low   ← gpt-oss는 추론형이라 필수(미설정 시 응답이 빈 값)
AI_BASE_URL=
AI_API_KEY=
AI_MODEL=
```

> 내부망(GPT-OSS) 전환은 **env 세 줄 교체만**으로 끝난다(코드 수정 불필요). 전환 후에는 AI 입력이
> 사내망을 벗어나지 않으므로 실데이터 검수가 가능해진다. 단, 프롬프트 인젝션·검수 fail-open 방어는
> 모델 위치와 무관하게 별도로 유지해야 한다(`docs/DEPLOY_CHECKLIST_20260619.md` P1-3 참조).

## 규칙

- 실제 API 키·토큰·비밀번호·내부 호스트명을 절대 커밋하지 않는다.
- `.env` 는 로컬 전용이며 Git 에서 무시된다(`.gitignore`).
- `.env.example` 에는 자리표시자(placeholder)만 둔다.
- 과거에 커밋/공유된 키가 있으면 즉시 폐기·교체한다.

## GPT-OSS 전환(내부망)

내부망 이식 후 GPT-OSS 전환은 **env 교체 + 서버 재시작**이 기본이지만, OpenAI 호환성·인증·
속도 등 확인할 항목이 있다. 실행 절차·체크리스트·코드 수정 포인트는 별도 런북 참조:
**`docs/gpt-oss-migration-guide.md`** (내부망 LLM이 읽고 마이그레이션을 수행하도록 작성됨).

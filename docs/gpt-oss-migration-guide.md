# GPT-OSS 마이그레이션 가이드 (내부망 LLM 실행용)

> **이 문서의 용도**: 이 앱은 현재 **임시로 GitHub Models(외부 API)** 를 쓰고 있다.
> 내부망 이식 후 **GPT-OSS(사내 자체 LLM)** 로 전환할 때, **내부망의 LLM(=실행 주체)** 이
> 이 문서를 읽고 마이그레이션을 안전·효율적으로 수행하도록 작성했다.
> 사람이 이 문서를 LLM에게 건네며 "이대로 마이그레이션 해줘"라고 지시하는 시나리오를 전제한다.

---

## 0. 한 줄 요약

AI 호출은 **서버 프록시 `/api/ai/chat` 한 곳**으로만 나간다. 전환은 원칙적으로
**서버 `.env` 4줄(`AI_BASE_URL`/`AI_MODEL`/`AI_API_KEY`/`AI_REASONING_EFFORT`) 교체 + 서버 재시작**이면 끝이다.
다만 "env만으로 끝나는지"는 **GPT-OSS 서버의 OpenAI 호환성·인증·속도**에 달려 있어, 아래
**§4 호환성 체크리스트**를 반드시 확인하고, 필요 시 **§5 코드 수정**을 한다.

---

## 1. 현재 아키텍처 (전환 전 반드시 이해)

```
브라우저(프런트)  ──POST /api/ai/chat──►  서버(server.js, Express)  ──POST {AI_BASE_URL}/chat/completions──►  업스트림 LLM
   gptOss.ts                                  AI 프록시 핸들러                                  (지금: GitHub Models / 나중: GPT-OSS)
```

- **프런트는 LLM을 직접 호출하지 않는다.** 키·주소·모델명은 프런트 번들에 없다.
  모든 AI 호출은 `src/lib/gptOss.ts` → `POST /api/ai/chat` 경유. (`AI_CHAT_URL = '/api/ai/chat'`)
- **서버 프록시**(`server.js`, 핸들러 `app.post('/api/ai/chat', …)`):
  - 업스트림으로 **`${AI_BASE_URL}/chat/completions`** 에 POST (OpenAI Chat Completions 규격).
  - 페이로드: `{ model: AI_MODEL, messages, temperature?, max_tokens?, reasoning_effort? }`.
    (`reasoning_effort` 는 `AI_REASONING_EFFORT` 가 설정된 경우에만 전송.)
  - 헤더: `Content-Type: application/json` + (`AI_API_KEY` 가 있을 때만) `Authorization: Bearer <AI_API_KEY>`.
  - **비스트리밍**(단일 응답). 업스트림 JSON을 그대로 클라이언트로 전달.
  - 업스트림 타임아웃 **60초**(`AbortSignal.timeout(60_000)`).
  - 사용자별 레이트리밋 **분당 20회**(`AI_RATE_LIMIT_PER_MINUTE`). 로그인 세션 필수(401).
- **상태 엔드포인트** `GET /api/ai/status` → `{ configured, external, model }`.
  - `external=true` 면 프런트에 "외부 API 주의" 캡션이 뜬다. 내부 GPT-OSS로 바꾸면 `external=false`.
- **응답 파싱**(프런트 `gptOss.ts`): **`data.choices[0].message.content`** 를 읽는다.
  → **업스트림은 OpenAI Chat Completions 응답 형식이어야 한다.**
- **클라이언트 타임아웃**: `callGptOss` 기본 **20초**(`AbortController`). 보고서 등 `fullLength` 호출은
  `max_tokens` 2048, 그 외 768.

### 설정 키 (서버 `.env` 전용 — `VITE_` 금지)
| 키 | 지금(GitHub Models) | 전환 후(GPT-OSS) |
|---|---|---|
| `AI_BASE_URL` | 비움(기본 `https://models.github.ai/inference`) | **GPT-OSS 베이스 URL** (예: `http://<GPT_OSS_HOST>:<PORT>/v1`) |
| `AI_MODEL` | 비움(기본 `openai/gpt-4.1-mini`) | **GPT-OSS 모델명** (예: `gpt-oss-120b`) |
| `AI_REASONING_EFFORT` | 비움 | **`low`** — gpt-oss는 추론형이라 필수. 미설정 시 reasoning 토큰이 `max_tokens` 를 잠식해 `content` 가 빈 값이 된다(실측: `max_tokens=256` 에서 reasoning 254 소모 → `finish_reason=length`, 화면에 "AI 응답에서 텍스트를 찾을 수 없습니다"). `low` 로 두면 reasoning 13~95 토큰. |
| `AI_API_KEY` | **GitHub Models 토큰(필수)** | 보통 **비움**(키 없으면 Authorization 헤더 미전송) |

> 서버 코드 기본값: `AI_BASE_URL_DEFAULT='https://models.github.ai/inference'`,
> `AI_MODEL_DEFAULT='openai/gpt-4.1-mini'`. `aiConfigured = AI_BASE_URL 있음 || AI_API_KEY 있음`.
> `aiIsExternal = AI_BASE_URL 없음 || base가 models.github.ai 로 시작`.

---

## 2. 목표 상태 (전환 후)

- `AI_BASE_URL` = 사내 GPT-OSS의 OpenAI 호환 베이스 URL.
- `AI_MODEL` = GPT-OSS가 서빙하는 모델명(정확히 일치).
- `AI_API_KEY` = 비움(또는 GPT-OSS가 요구하는 키).
- AI 입력이 **사내망을 벗어나지 않으므로** 실데이터 검수 가능.
- 프런트 "외부 API 주의" 캡션 사라짐(`external=false`).

---

## 3. 기본 절차 (Happy Path)

1. 서버 머신의 `.env`에서 아래 3줄 설정(값은 그 환경에서만 채움):
   ```env
   AI_BASE_URL=http://<GPT_OSS_HOST>:<PORT>/v1
   AI_MODEL=<gpt-oss-모델명>
   AI_API_KEY=
   ```
2. **서버 재시작**(설정은 기동 시 1회 읽음 — `process.env` 캡처). nodemon이면 자동, 운영이면 프로세스 재기동.
   - 재시작 시 인메모리 세션이 비워져 **전원 재로그인** 필요(정상).
3. **§4 체크리스트**로 호환성 확인 → 안 맞으면 **§5 코드 수정**.
4. **§6 검증** 수행.

---

## 4. 반드시 확인할 것 — 호환성 체크리스트 ⭐

전환을 막거나 깨뜨리는 항목. 하나씩 GPT-OSS 서버 사양과 대조하라.

1. **엔드포인트 경로**: 프록시는 `AI_BASE_URL` 뒤에 **`/chat/completions`** 를 붙인다.
   → 최종 호출이 GPT-OSS의 실제 경로와 맞아야 한다.
   - vLLM/llama.cpp OpenAI 서버: 보통 `…/v1/chat/completions` → `AI_BASE_URL=http://host:port/v1`.
   - **Ollama**: OpenAI 호환은 `…/v1/chat/completions` (O), 네이티브 `…/api/chat` (X, 형식 다름).
   - 직접 한 번 `curl` 로 `POST {AI_BASE_URL}/chat/completions` 가 200 + OpenAI 형식 JSON을 주는지 확인.
2. **응답 형식(OpenAI 호환)**: 응답에 **`choices[0].message.content`** 가 있어야 한다(프런트가 그걸 읽음).
   - 형식이 다르면 → §5(b) 응답 파싱/프록시 변환.
3. **모델명 일치**: `AI_MODEL` 이 GPT-OSS가 서빙하는 이름과 **정확히** 같아야 한다(대소문자·태그 포함).
   - vLLM은 `--served-model-name`, Ollama는 `ollama list` 이름.
4. **인증 방식**: 프록시는 `AI_API_KEY` 가 있으면 **`Authorization: Bearer`** 만 보낸다.
   - GPT-OSS가 키 불필요 → `AI_API_KEY` 비우면 됨.
   - GPT-OSS가 **다른 헤더/스킴**(예: `api-key`, mTLS) 요구 → §5(a) 헤더 수정.
5. **추론 속도 / 타임아웃**: 사내 120b급은 **느릴 수 있다**.
   - 서버 프록시 60초, **클라이언트 20초**(`callGptOss` 기본). 응답이 20초를 넘으면 **클라이언트가 먼저 끊는다**.
   - 느리면 → §5(c) 클라이언트 타임아웃 상향(특히 보고서 생성).
6. **`max_tokens` / 컨텍스트**: 클라이언트가 768(기본)·2048(보고서)을 보낸다. GPT-OSS의 출력·컨텍스트 한도가
   이를 수용하는지 확인. 너무 작으면 잘림.
7. **네트워크/TLS**: 내부 호스트 도달성(방화벽·라우팅), `http` vs `https`(자체 서명 인증서면 Node `fetch` 신뢰 설정),
   사내 아웃바운드 프록시 영향 여부, DNS/IP 고정.
8. **스트리밍**: 본 앱은 **비스트리밍**만 쓴다. GPT-OSS가 스트리밍 전용이 아니라 일반(non-stream) 응답을 주는지 확인
   (OpenAI 호환 서버는 보통 둘 다 지원).
9. **출력 형식/프롬프트 적합성**: AI 검수(`reviewEvaluationFeedbacks`)·요약 등은 프롬프트가 특정 형식의 답을 기대한다.
   모델이 바뀌면 **형식 준수도가 달라질 수 있다** → §5(d) 프롬프트 미세조정(필요 시).

---

## 5. env로 안 끝날 때 — 코드 수정 포인트 (정확한 위치)

각 항목은 "이런 경우에만" 손댄다. 안 그러면 **코드 수정 없이 env만으로 끝낸다**(원칙).

- **(a) 인증 헤더가 Bearer가 아닐 때** — `server.js` 의 AI 프록시 핸들러(`app.post('/api/ai/chat' …)`)
  안 `const headers = { 'Content-Type': … }; if (aiApiKey) headers.Authorization = 'Bearer …'`.
  → GPT-OSS 요구 헤더로 교체/추가. (mTLS면 `fetch`에 클라이언트 인증서 옵션.)
- **(b) 응답이 OpenAI 형식이 아닐 때** — 두 군데:
  - 서버 프록시는 업스트림 JSON을 **그대로 전달**한다. 변환이 필요하면 핸들러에서 `text`를 파싱해
    `{ choices:[{ message:{ content } }] }` 형태로 재구성해 보내거나,
  - 프런트 `src/lib/gptOss.ts` 의 `const content = data.choices?.[0]?.message.content` 파싱을 GPT-OSS 형식에 맞춰 수정.
  - **권장**: 프록시에서 OpenAI 형식으로 정규화(프런트·검수 래퍼들이 형식을 공유하므로 한 곳에서 처리).
- **(c) 추론이 느려 타임아웃** — `src/lib/gptOss.ts` `callGptOss(options.timeoutMs ?? 20000)` 기본값 상향,
  그리고 서버 프록시 `AbortSignal.timeout(60_000)` 도 함께 상향. 보고서(`fullLength`) 호출은 더 길게.
- **(d) 프롬프트/형식 미세조정** — 프롬프트와 응답 파싱 로직 모두 `src/lib/gptOss.ts` 안에 있다
  (`reviewEvaluationFeedbacks` 등). 형식 미준수가 잦으면 system 프롬프트에 형식 지시를 강화하거나
  파싱을 관대하게.
- **(e) 외부/내부 판별 캡션** — `aiIsExternal` 로직이 `models.github.ai` 문자열에 의존한다. GPT-OSS URL이면
  자동으로 `external=false`. 만약 캡션이 잘못 뜨면 `server.js` 의 `aiIsExternal` 판별을 확인.
- **(f) 레이트리밋** — 내부 모델이면 분당 20회가 빡빡할 수 있다. `server.js` `AI_RATE_LIMIT_PER_MINUTE` 조정.

---

## 6. 검증 절차 (전환 후 반드시)

1. **상태 확인**: 로그인 후 `GET /api/ai/status` → `{ configured:true, external:false, model:"<gpt-oss>" }`.
2. **프록시 직접 호출**(서버 머신에서, 세션 쿠키 필요):
   `POST /api/ai/chat` body `{"messages":[{"role":"user","content":"안녕"}]}` → 200 + `choices[0].message.content` 존재.
   - 503 = 미설정(env 확인), 502 = 업스트림 에러(서버 로그의 `AI upstream error` 확인), 504 = 타임아웃(§5c).
3. **업스트림 직접 확인**(프록시 우회): `curl {AI_BASE_URL}/chat/completions` 로 OpenAI 형식 200 확인.
4. **실기능**: 평가 화면에서 **AI 검수** 실행 → 결과가 정상 생성·저장되는지(ai_* 컬럼 롤업). 형식 깨지면 §5(d).
5. **UI**: "외부 API 주의" 캡션이 **사라졌는지** 확인.
6. **부하/속도**: 실제 응답 시간 측정 → 클라이언트 20초 안에 들어오는지(§5c).

---

## 7. 보안·운영 주의 (모델 위치와 무관하게 유지)

- 실제 키·내부 호스트명·토큰을 **절대 커밋하지 않는다**. `.env` 는 `.gitignore`. `.env.example` 엔 자리표시자만.
- 과거 외부(GitHub Models)로 보냈던 입력은 외부 캐시될 수 있으니, **민감 데이터 검수는 내부 전환 후에만**.
- 내부 전환해도 **프롬프트 인젝션·검수 fail-open 방어는 별도로 유지**
  (`docs/DEPLOY_CHECKLIST_20260619.md` P1-3 참조).
- 전환은 **운영 영향 작업**: 재시작=전원 재로그인. 사용자 공지 후 진행 권장.

---

## 8. 롤백

- `.env` 의 `AI_BASE_URL`/`AI_MODEL` 비우고 `AI_API_KEY`(GitHub Models 토큰) 복원 → 재시작.
  (코드를 §5에서 수정했다면 그 커밋도 함께 되돌린다.)

---

## 9. 파일 레퍼런스 맵 (실행 LLM이 바로 찾도록)

| 대상 | 위치 |
|---|---|
| AI 프록시 핸들러·env·레이트리밋·타임아웃 | `server.js` → `app.post('/api/ai/chat', …)` + 그 위 `AI_BASE_URL_DEFAULT`/`aiConfigured`/`aiIsExternal` |
| AI 상태 | `server.js` → `GET /api/ai/status` |
| 프런트 AI 클라이언트·프롬프트·응답파싱·타임아웃 | `src/lib/gptOss.ts` (`callGptOss`, `reviewEvaluationFeedbacks`, `AI_CHAT_URL`) |
| AI 검수 호출부 | `src/hooks/useEvaluationDataDB.ts` (`reviewEvaluationFeedbacks` 사용) |
| 설정 문서 | `AI_SETUP.md` |
| 보안 항목(프롬프트 인젝션·fail-open) | `docs/DEPLOY_CHECKLIST_20260619.md` P1-3 |

---

## 10. 실행 LLM을 위한 체크리스트 (요약)

- [ ] GPT-OSS의 `POST {BASE}/chat/completions` 가 OpenAI 형식 200을 주는지 `curl` 확인 (§4-1,2)
- [ ] `AI_MODEL` 이 서빙 모델명과 정확히 일치 (§4-3)
- [ ] 인증: 키 불필요면 `AI_API_KEY` 비움 / 다르면 §5(a)
- [ ] `.env` 3줄 설정 + **서버 재시작** (§3)
- [ ] `/api/ai/status` 가 `external:false, configured:true` (§6-1)
- [ ] 프록시·실기능(AI 검수) 동작 + 형식 정상 (§6-2,4)
- [ ] 응답 시간이 클라이언트 20초 내 / 아니면 타임아웃 상향 (§4-5, §5c)
- [ ] "외부 API" 캡션 사라짐 (§6-5)
- [ ] env 외 코드 수정했으면 커밋, 안 했으면 코드 무수정(원칙)

# Claude Design Reference — 2026-04-23

Claude Design으로 생성한 기여도평가시스템 프론트 프로토타입의 **박제본**이다.
실제 앱(`src/`)에는 이 코드를 바로 넣지 않는다. **UI·UX 의사결정의 비교 기준**으로만 참조한다.

## 파일

| 파일 | 역할 |
|---|---|
| `prototype.html` | 10개 페이지 + 로그인 · 역할 스위처 실행 가능한 프로토타입 진입점 |
| `tokens.css` | OK 브랜드 디자인 토큰 (color · spacing · shadow 등 CSS 변수) |
| `mock.js` | 목업 데이터 (`window.OK_MOCK`) |
| `components.jsx` | 공통 컴포넌트 (`Pill`, `ScoreBadge`, `I.*` 아이콘 등) |
| `pages.jsx` | 10개 페이지 정의 (피평가자 3 · 평가자 4 · HR 3) |

## 실행 방법

`file://` 직접 열기는 동작하지 않는다 (CORS + Babel fetch 제약). 로컬 HTTP 서버로 연다.

### 한 줄 실행

```powershell
.\serve.ps1
```

그 뒤 브라우저: http://localhost:8123/prototype.html

종료: PowerShell 창에서 `Ctrl+C`.

## 페이지 목록

| 역할 | 페이지 | pages.jsx 라인 |
|---|---|---|
| 피평가자 | `MyTasksPage` | 26 |
| 피평가자 | `MySchedulePage` | 312 |
| 피평가자 | `MyFeedbackPage` | 364 |
| 평가자 | `TeamMembersPage` | 436 |
| 평가자 | `ScoreTablePage` | 483 |
| 평가자 | `EvaluatorSchedulePage` | 578 |
| 평가자 | `EvaluatorFeedbackPage` | 622 |
| HR | `HrDepartmentsPage` | 666 |
| HR | `HrUsersPage` | 708 |
| HR | `HrSettingsPage` | 769 |
| 공통 | `Login` | prototype.html 내부 |

## 기술 스택

- React 18 UMD (CDN) + Babel Standalone
- Plain CSS 변수 (`tokens.css`)
- 목업 데이터만 사용, 실제 API 연결 없음
- 빌드 도구 없음 (브라우저에서 바로 Babel 트랜스파일)

## 실제 `src/`와의 관계

실제 앱은 Vite + TypeScript + Tailwind + shadcn/ui 구조다. 따라서:

- 이 프로토타입의 **디자인 토큰**(`tokens.css`)은 `src/index.css` 또는 `tailwind.config.ts`로 변환되어 반영된다.
- 이 프로토타입의 **페이지 구조**는 `src/pages/` 하위 TSX로 재작성된다.
- 이 프로토타입의 **공통 컴포넌트**는 `src/components/` 하위 TSX + shadcn/ui 패턴으로 재구현된다.
- `mock.js`의 더미 데이터는 실제 `server.js`/DB와 연결되며 참고용으로만 남긴다.

## 수정 원칙

이 폴더는 **읽기 전용 박제**다.

- 디자인을 더 손대고 싶으면 Claude Design에서 재생성 → 새 날짜 폴더(`docs/design-reference/YYYY-MM-DD/`)로 박제
- 실제 코드 수정은 `src/`에서 진행
- 변경 이력은 상위 `daily/` 로그와 이 앱의 Git 커밋으로 관리

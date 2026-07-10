# 조직 KPI 정렬 기능 — 상세 구현계획

> 작성일 2026-06-30. 평가자/HR가 조직 KPI를 등록하고, 피평가자 과업에 목표를 배분·실적을 추적하며,
> 평가 화면에서 "참고 지표"로 강조하는 정량 정렬 레이어. **기존 정성 점수 체계(매트릭스)는 무변경.**

## 확정 결정 (사용자 합의)

| 항목 | 결정 | 의미 |
|---|---|---|
| ① KPI ↔ 평가 점수 | **부분 반영** | 자동 점수화 안 함. 평가 화면에서 과업 옆 **강조 참고 표시**, 점수는 사람이 매트릭스로 판단 |
| ② 진척 측정 | **실적값 입력** | 과업별 실제 실적값(억/건) 입력 → `진척 = Σ실적 / 목표` |
| ③ 등록 주체·레벨 | **HR + 팀장** | HR=법인/본부/부 상위 KPI, 팀장(평가자)=팀 KPI + 자기 팀 과업 배분·실적 |

## 선행 사안 (KPI와 분리, 보류)

- **2025·2026 평가기간 둘 다 `active`** (확인 완료). KPI는 `evaluation_period_id` 단위이고 컨텍스트가
  `active && is_default`(=2026)을 기본 선택하므로 **KPI의 선행 조건 아님**.
- 단, 2025를 `closed`로 닫으면 **미완료 176건(draft 123·evaluating 52·in-progress 1)이 읽기전용 잠김**.
  → "미완료 176건을 마무리할지/버릴지"는 **HR 운영 판단**. KPI 작업과 무관하게 별도 처리.

---

## 데이터 모델 (신규 테이블 2개 · 기존 스키마 무변경)

### `org_kpis` — KPI 정의
```sql
CREATE TABLE public.org_kpis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_period_id uuid NOT NULL REFERENCES evaluation_periods(id) ON DELETE CASCADE,
  parent_kpi_id uuid REFERENCES org_kpis(id) ON DELETE CASCADE,  -- NULL=최상위. 본부(부모)←팀(자식)
  org_level text NOT NULL CHECK (org_level IN ('corporation','division','department','team')),
  org_key  text NOT NULL,            -- 그 레벨 조직명 (evaluations.evaluatee_org_* 와 매칭)
  name     text NOT NULL,            -- 예: '기업여신 총금액'
  unit     text NOT NULL,            -- '억' | '%' | '건' | (자유입력 + 추천목록)
  target_value numeric NOT NULL CHECK (target_value > 0),
  direction text NOT NULL DEFAULT 'higher' CHECK (direction IN ('higher','lower')),
  description text,
  owner_id  text,                    -- 책임자 employee_id (optional)
  status    text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_org_kpis_period_org ON public.org_kpis(evaluation_period_id, org_level, org_key);
CREATE INDEX idx_org_kpis_parent ON public.org_kpis(parent_kpi_id);
```

**부모-자식 검증 (앱 레이어, parent_kpi_id 지정 시):**
- 같은 `evaluation_period_id`
- 자식 `org_level`이 부모보다 **하위 깊이** (corporation > division > department > team)
- 자식 `unit` == 부모 `unit` (억=억이라야 합산 의미)
- 순환 금지(자기 조상으로 부모 지정 불가)
- `ON DELETE CASCADE`: 부모 삭제 시 서브트리 삭제(삭제보다 archive 권장)

### `task_kpi_allocations` — 과업 ↔ KPI 배분/실적
```sql
CREATE TABLE public.task_kpi_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kpi_id uuid NOT NULL REFERENCES org_kpis(id) ON DELETE CASCADE,
  task_uuid uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,  -- tasks.id (PK)
  task_id  text NOT NULL,            -- tasks.task_id (조회 편의)
  evaluation_id uuid NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  allocated_target numeric NOT NULL DEFAULT 0 CHECK (allocated_target >= 0),  -- 이 과업 배분 목표 (예: 500억)
  achieved_value   numeric,          -- 실적 (NULL=미입력, 예: 420억)
  note  text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kpi_id, task_uuid)
);
CREATE INDEX idx_task_kpi_alloc_kpi  ON public.task_kpi_allocations(kpi_id);
CREATE INDEX idx_task_kpi_alloc_task ON public.task_kpi_allocations(task_uuid);
```

### 진척·정렬 규칙 (트리 자동 롤업)
- **노드 자체 진척** = `own_achieved / target_value`, `own_achieved = Σ(자기 노드 배분의 achieved_value)`.
- **롤업 진척 (재귀)**: 각 과업 실적은 **배분된 KPI 노드에 1회만 귀속** → 조상으로 합산되어 **이중계산 없음**.
  ```
  rolled_achieved(node)  = own_achieved(node)  + Σ rolled_achieved(child)
  rolled_allocated(node) = own_allocated(node) + Σ rolled_allocated(child)
  진척률(node) = rolled_achieved(node) / target_value(node)
  ```
  예) 본부 KPI 5,000억 ← 팀A 1,200억·팀B 900억(각각 과업 배분). 팀 실적이 본부로 자동 합산.
- **배분 점검**: `rolled_allocated` vs `target_value` 비교로 **과배분/미배분** 경고 표시.
- **계산 위치**: GET 시 해당 기간 KPI를 평면 조회(+배분 SUM 1회) 후 서버 핸들러에서 트리 구성·후위순회 합산
  (KPI 건수 적어 N+1 없이 1~2 쿼리). 응답에 `own_*`·`rolled_*`·`progress` 동봉.
- **정렬 유효성**: 과업 피평가자 `evaluations.evaluatee_org_<level>` 값이 KPI `org_key`와 일치할 때만 배분 허용.
  부모(본부) 노드에도 직접 배분 가능(그 본부 소속이면) — 자식 없이도 동작.

---

## 백엔드 (server.js) — 라우트 + 권한

권한 헬퍼 신규: `requireHrOrEvaluator` (HR이거나 `available_roles`에 evaluator 포함).
배분/실적 쓰기는 기존 `requesterIsEvalLineAncestorOf(req, evaluateeId)` 재사용(HR 우회 허용).
모든 쓰기는 `admin_audit_logs` 기록(F-1 패턴).

| 메서드 | 경로 | 가드 | 설명 |
|---|---|---|---|
| GET | `/api/org-kpis?periodId=&level=&orgKey=` | 인증 | KPI 목록(평면) + `own_*`/`rolled_*`/progress |
| GET | `/api/org-kpis/tree?periodId=` | 인증 | 트리 구조(children 중첩) + 롤업 진척 |
| GET | `/api/org-kpis/:id` | 인증 | 단건 + 배분 내역 + 자식 목록 |
| POST | `/api/org-kpis` | requireHrOrEvaluator | 등록 (parent_kpi_id 옵션; 팀장은 org_level='team' + 자기 팀) |
| PUT | `/api/org-kpis/:id` | requireHrOrEvaluator | 수정 (소유 범위 검증) |
| DELETE | `/api/org-kpis/:id` | requireHr | 삭제(또는 archive) |
| GET | `/api/tasks/:taskId/kpi-allocations` | 행 가드 | 과업의 정렬 KPI 목록 |
| PUT | `/api/org-kpis/:id/allocations` | HR or evalLineAncestor | 과업 배분/실적 upsert(배치) |
| DELETE | `/api/org-kpis/:id/allocations/:allocId` | HR or evalLineAncestor | 배분 해제 |

진척 집계는 SQL `LEFT JOIN ... SUM(achieved_value)`로 KPI당 1회 산출(N+1 회피).

---

## 프런트엔드

### 신규/수정 파일
- `src/types/kpi.ts` — `OrgKpi`, `TaskKpiAllocation`, `KpiProgress` 타입
- `src/lib/services/kpiService.ts` — apiFetch CRUD (기존 서비스 패턴)
- `src/pages/hr/HrKpiPage.tsx` (또는 공용 `src/pages/kpi/KpiManagePage.tsx`) — 등록/배분 관리
- `src/components/Kpi/KpiProgressBar.tsx`, `KpiAlignBadge.tsx` — 재사용 표시 컴포넌트
- `src/pages/team/Home.tsx` — 상단 "조직 KPI 현황" 접이식 밴드 추가
- `src/pages/Evaluation.tsx` — 과업별 정렬 KPI **강조 패널**(부분 반영) + 실적 입력
- `src/components/Layout/Sidebar.tsx` — KPI 메뉴 항목(HR/평가자 노출)

### 표시 위치
| 위치 | 역할 | 내용 |
|---|---|---|
| KPI 관리 페이지 | HR·팀장 | 등록/수정, 레벨·단위·목표, 과업 배분 목록 |
| 과업 작성/평가 화면 | 피평가자·팀장 | 과업↔KPI 정렬 선택, 목표 배분·실적값 입력 |
| 평가자 보드 상단(`TeamHome`) | 팀장 | 우리 팀/본부 KPI 진척바 (접이식) |
| 평가 화면(`Evaluation.tsx`) | 팀장 | 과업별 정렬 KPI·진척 강조 패널 — **부분 반영의 핵심** |

### "부분 반영" UI 스펙
평가자가 과업 점수를 매기는 카드에, 그 과업이 정렬된 KPI를 뱃지+미니 진척바로 노출:
> `[본부 KPI · 기업여신] 목표 500억 / 실적 420억 (84%)`

점수 입력은 그대로 매트릭스. KPI는 시각적 강조·툴팁만 — `weightedScore` 산식 불변.

---

## 단계별 실행 (각 단계 검증 가능)

1. **Phase 1 — 스키마+백엔드**: 마이그레이션 2개(`db_mig/add_org_kpis.sql`) 추가+즉시 적용,
   `requireHrOrEvaluator` + 라우트 8종, `kpiService.ts`+타입. `npm run typecheck`/`build` 통과.
2. **Phase 2 — KPI 관리 페이지**: HR·팀장 등록/수정 UI(역할 가드, org 범위 제한).
3. **Phase 3 — 정렬·실적 입력**: 과업↔KPI 연결, `achieved_value` 입력, 정렬 유효성 검증.
4. **Phase 4 — 가시화**: `TeamHome` 상단 밴드 + `Evaluation.tsx` 강조 패널.

각 Phase 종료 시 `npm run typecheck` → `npm run build`, 실데이터(2026) 라이브 확인.

## 검증 체크리스트 (전체 완료 시)
- [ ] 마이그레이션 멱등 적용·롤백 안전
- [ ] HR/팀장 권한 경계(타 팀 KPI 차단) 스모크
- [ ] 진척 집계 정확(Σ실적/목표), 단위(억/%/건) 표시
- [ ] 트리 롤업 정확(팀 실적 → 본부 합산, 이중계산 없음), 순환/단위/레벨 검증
- [ ] 정렬 org 일치 검증(불일치 배분 거부)
- [ ] 평가 점수 산식 불변(부분 반영=표시만) 회귀 확인
- [ ] 감사로그 기록(등록/수정/배분/삭제)

-- Migration: create_prompt_templates
-- Lightweight table for storing prompt templates, no foreign keys.

CREATE TABLE IF NOT EXISTS prompt_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger to auto‑update updated_at on row changes
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_timestamp_on_prompt_templates ON prompt_templates;
CREATE TRIGGER set_timestamp_on_prompt_templates
BEFORE UPDATE ON prompt_templates
FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

-- Insert the initial evaluation guide prompt
INSERT INTO prompt_templates (key, content, description) VALUES (
  'evaluation_guide',
  '**수시 성과관리체계 가이드라인:**

**평가 철학:**
- 지속적 모니터링: 과업 진행 상황을 실시간으로 추적하고 관리
- 정기적 피드백: 수시 성과보고를 통한 양방향 소통과 개선점 도출
- 적응적 목표 조정: 변화하는 환경에 맞춰 과업과 목표를 유연하게 조정
- 성장 중심 평가: 결과뿐만 아니라 과정과 학습을 중시하는 발전적 평가

**점수 의미:**
- 평가점수는 성장레벨별 요구수준을 의미
- 성장레벨보다 평가점수가 같거나 높으면 달성
- 1점: 미흡, 2점: 보통, 3점: 양호, 4점: 우수

**기여방식:**
- 총괄: 업무 전체를 책임지고 관리, 프로젝트 전체적인 방향 설정
- 리딩: 특정 영역을 주도적으로 담당, 해당 영역의 성과에 직접 책임
- 실무: 핵심 업무 직접 수행, 업무의 질적 완성도에 기여
- 지원: 다른 구성원을 보조하고 지원, 주 담당자를 보조

**기여범위:**
- 전략적: 조직 전체에 영향, 부서를 넘어 조직 전체의 방향성이나 성과에 영향
- 상호적: 팀 단위 협업, 팀 내 다른 구성원들과 긴밀히 협력하여 공동 목표 달성
- 독립적: 자율적 업무 수행, 개인의 판단과 책임 하에 독립적으로 업무 기획하고 실행
- 의존적: 지시받은 업무 수행, 상급자나 동료의 지시나 가이드라인에 따라 업무 수행

**점수 매트릭스:**
- 총괄: 의존적(2점), 독립적(3점), 상호적(4점), 전략적(4점)
- 리딩: 의존적(2점), 독립적(3점), 상호적(3점), 전략적(4점)
- 실무: 의존적(1점), 독립적(2점), 상호적(3점), 전략적(3점)
- 지원: 의존적(1점), 독립적(1점), 상호적(2점), 전략적(2점)

**평가 절차:**
1. 피평가자: 과업 등록 (주요 과업과 가중치 설정)
2. 평가자: 과업 검토 (과업 목록과 가중치 확인)
3. 평가자: 기여방식 평가 (총괄/리딩/실무/지원 선택)
4. 평가자: 기여범위 평가 (전략적/상호적/독립적/의존적 선택)
5. 평가자: 피드백 작성 (구체적이고 건설적인 피드백)
6. 피평가자: 피드백 확인 및 과업 개선',
  '수시 성과관리체계 평가 가이드'
);

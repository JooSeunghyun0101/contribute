import { apiFetch } from '@/lib/api';

// HR 자연어 인물검색 — 클라이언트가 질의를 AI(parsePeopleSearchQuery)로 키워드 파싱한 뒤,
// 키워드 + 평가기간(다중)으로 서버 SQL 검색(/api/people-search)을 호출한다. 서버는 LLM을 부르지 않는다.
export type PeopleSearchCandidate = {
  employee_id: string;
  name: string;
  department: string | null;
  org_corporation: string | null;
  org_division: string | null;
  org_department: string | null;
  org_team: string | null;
  kw_hits: number;
  fb_hits: number;
  terms: string[];
  snippets: string[];
  avg_score: number | null;
  ai_keywords: string | null;
};

export const peopleSearchService = {
  async search(keywords: string[], periodIds: string[]): Promise<PeopleSearchCandidate[]> {
    if (keywords.length === 0 || periodIds.length === 0) return [];
    try {
      return (
        (await apiFetch<PeopleSearchCandidate[]>('/api/people-search', {
          method: 'POST',
          body: JSON.stringify({ keywords, periodIds }),
          headers: { 'Content-Type': 'application/json' },
        })) ?? []
      );
    } catch {
      return [];
    }
  },
};

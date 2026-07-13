import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/components/Layout/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state-views';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import { parsePeopleSearchQuery, rankPeopleSearchResults } from '@/lib/gptOss';
import { peopleSearchService, type PeopleSearchCandidate } from '@/lib/services';
import { AiKeywordChips } from '@/components/ui/AiKeywordChips';

// HR 자연어 인물검색 — 질의를 AI로 키워드 파싱 → 서버 SQL 검색(피드백+AI키워드) →
// AI가 '방향성(잘함/부족함)'까지 판단해 실제 부합 인물만 추천. 나머지는 '주제 매칭(참고)'로 분리.
const HrPeopleSearchPage = () => {
  const navigate = useNavigate();
  const { periods, selectedPeriodId } = useEvaluationPeriod();
  const [query, setQuery] = useState('');
  const [periodIds, setPeriodIds] = useState<Set<string>>(
    () => new Set(selectedPeriodId ? [selectedPeriodId] : []),
  );
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PeopleSearchCandidate[] | null>(null);
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [usedKeywords, setUsedKeywords] = useState<string[]>([]);
  const [error, setError] = useState('');

  const togglePeriod = (id: string) =>
    setPeriodIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const canSearch = query.trim().length >= 2 && periodIds.size > 0 && !loading;

  const runSearch = async () => {
    if (!canSearch) return;
    setLoading(true);
    setResults(null);
    setReasons({});
    setError('');
    try {
      const criteria = await parsePeopleSearchQuery(query.trim());
      if (criteria.keywords.length === 0) {
        setError('검색어를 해석하지 못했습니다. 다른 표현으로 다시 시도해 주세요.');
        setResults([]);
        return;
      }
      setUsedKeywords(criteria.keywords);
      const rows = await peopleSearchService.search(criteria.keywords, [...periodIds]);
      setResults(rows);
      if (rows.length > 0) {
        const ranked = await rankPeopleSearchResults(
          query.trim(),
          rows.slice(0, 15).map((r) => ({
            name: r.name,
            aiKeywords: r.ai_keywords,
            snippets: r.snippets,
            avgScore: r.avg_score,
          })),
        );
        const map: Record<number, string> = {};
        for (const r of ranked) map[r.index] = r.reason;
        setReasons(map);
      }
    } catch {
      setError('검색 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  };

  const renderCard = (cand: PeopleSearchCandidate, reason?: string, dim?: boolean) => (
    <div
      key={cand.employee_id}
      className={`sd-card ${reason ? 'ai-shine-border' : ''}`}
      style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, opacity: dim ? 0.62 : 1 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          {reason && (
            <span
              style={{
                flexShrink: 0,
                padding: '2px 8px',
                borderRadius: 'var(--r-pill)',
                fontSize: 'var(--fs-2xs)',
                fontWeight: 800,
                color: 'var(--ai-accent)',
                background: 'var(--ai-accent-bg)',
              }}
            >
              AI 추천
            </span>
          )}
          <span style={{ fontWeight: 800, fontSize: 'var(--fs-body)' }}>{cand.name}</span>
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
            {[cand.org_team, cand.org_department, cand.department].filter(Boolean)[0] ?? ''}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>
            {cand.avg_score != null ? `평균 ${cand.avg_score}점 · ` : ''}매칭 {cand.kw_hits}개
          </span>
          <button
            type="button"
            onClick={() => navigate(`/hr/evaluation-viewer?evaluatee=${encodeURIComponent(cand.employee_id)}`)}
            title={`${cand.name}님의 평가 열람`}
            className="sd-btn sd-btn-outline sd-btn-xs"
          >
            평가 보기
          </button>
        </div>
      </div>
      {reason && (
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ai-accent)', fontWeight: 600, lineHeight: 1.5 }}>
          {reason}
        </div>
      )}
      {cand.ai_keywords && <AiKeywordChips text={cand.ai_keywords} />}
      {cand.snippets && cand.snippets.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {cand.snippets.map((s, i) => (
            <div key={i} style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', lineHeight: 1.5 }}>
              “{s}”
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderResults = () => {
    if (results === null) return null;
    if (results.length === 0) {
      return (
        <EmptyState
          message={
            usedKeywords.length > 0
              ? `'${usedKeywords.join(', ')}' 로 검색했지만 해당하는 인물을 찾지 못했습니다.`
              : '검색 결과가 없습니다.'
          }
        />
      );
    }
    const idx = results.map((_, i) => i);
    const confirmed = idx.filter((i) => reasons[i]);
    const others = idx.filter((i) => !reasons[i]);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
          검색 키워드: {usedKeywords.join(', ')} · 총 {results.length}명 중 AI 추천 {confirmed.length}명
        </div>
        {confirmed.length === 0 && (
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
            AI가 조건에 정확히 부합하는 인물을 찾지 못했습니다. 아래는 주제만 매칭된 참고 목록입니다.
          </div>
        )}
        {confirmed.map((i) => renderCard(results[i], reasons[i]))}
        {confirmed.length > 0 && others.length > 0 && (
          <div className="sd-label-mini" style={{ marginTop: 6 }}>기타 주제 매칭 (AI 미추천 · 참고)</div>
        )}
        {others.map((i) => renderCard(results[i], undefined, confirmed.length > 0))}
      </div>
    );
  };

  return (
    <>
      <PageHeader
        title="AI 인물 검색"
        subtitle="자연어로 강점·약점·업무능력을 검색해 대상자를 찾습니다"
      />
      <div style={{ padding: '24px 32px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 평가기간 다중 선택 */}
        <div className="sd-card" style={{ padding: 16 }}>
          <div className="sd-label-mini" style={{ marginBottom: 10 }}>평가기간 (다중 선택 가능)</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {periods.length === 0 ? (
              <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-sm)' }}>평가기간이 없습니다.</span>
            ) : (
              periods.map((p) => {
                const on = periodIds.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => togglePeriod(p.id)}
                    className={`sd-filter-chip${on ? ' is-active' : ''}`}
                  >
                    {p.name}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* 검색창 */}
        <div className="sd-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') runSearch();
            }}
            placeholder="예: 협업과 소통이 뛰어난 사람 / 부서 내 AI 전파를 많이 하는 사람 / 문서화가 부족한 사람"
            rows={2}
            className="sd-textarea"
            style={{ minHeight: 0, lineHeight: 1.5 }}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>
              AI가 질의를 키워드로 변환해 검색하고, 피드백 근거의 방향성(잘함/부족함)까지 판단해 추천합니다. (Ctrl/⌘+Enter)
            </span>
            <button
              type="button"
              onClick={runSearch}
              disabled={!canSearch}
              className="sd-btn sd-btn-primary"
              style={{ padding: '8px 20px' }}
            >
              {loading ? 'AI 검색 중…' : 'AI 검색'}
            </button>
          </div>
        </div>

        {error && <ErrorState message={error} />}

        {loading && <LoadingState message="AI 검색 중…" />}

        {renderResults()}
      </div>
    </>
  );
};

export default HrPeopleSearchPage;

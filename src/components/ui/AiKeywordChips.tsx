import type { CSSProperties } from 'react';

// AI 키워드를 극성별 태그 칩으로 렌더한다. AI 키워드 카드(피드백 이력) + 인물검색 결과 공용.
// '강점:'/'보완:' 라벨이 있으면 강점=파랑·보완=빨강으로 구분, 라벨이 없으면(레거시) 전체를 중립(파랑)으로.
export type PolarKeywords = { positive: string[]; negative: string[] };

const splitItems = (s: string): string[] =>
  (s ?? '')
    .split(/[,\n·•|/]+/)
    .map((x) => x.replace(/^[\s\-–—•*\d.)]+/, '').trim())
    .filter(Boolean)
    .filter((x) => x !== '없음');

export const parsePolarKeywords = (text: string): PolarKeywords => {
  const raw = text ?? '';
  const posM = raw.match(/강점\s*[:：]\s*([^\n]*)/);
  const negM = raw.match(/보완\s*[:：]\s*([^\n]*)/);
  if (posM || negM) {
    return {
      positive: splitItems(posM?.[1] ?? '').slice(0, 10),
      negative: splitItems(negM?.[1] ?? '').slice(0, 10),
    };
  }
  // 라벨 없는 플랫/레거시 → 전체 중립(파랑).
  return { positive: splitItems(raw.replace(/^[\s\S]*?키워드\s*[:：]/, '')).slice(0, 12), negative: [] };
};

const chipStyle = (tone: 'pos' | 'neg'): CSSProperties => ({
  display: 'inline-block',
  padding: '3px 9px',
  borderRadius: 999,
  fontSize: 'var(--fs-xs)',
  fontWeight: 600,
  color: tone === 'neg' ? 'var(--danger)' : 'var(--ai-accent)',
  background: tone === 'neg' ? 'var(--danger-bg)' : 'var(--ai-accent-bg)',
});

type Props = { text: string; style?: CSSProperties };

export const AiKeywordChips = ({ text, style }: Props) => {
  const { positive, negative } = parsePolarKeywords(text);
  if (positive.length === 0 && negative.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, ...style }}>
      {positive.map((kw, i) => (
        <span key={`p-${kw}-${i}`} style={chipStyle('pos')}>
          {kw}
        </span>
      ))}
      {negative.map((kw, i) => (
        <span key={`n-${kw}-${i}`} style={chipStyle('neg')}>
          {kw}
        </span>
      ))}
    </div>
  );
};

export default AiKeywordChips;

import type { CSSProperties } from 'react';

// AI 생성 텍스트를 '글자만 쭉 나열'이 아니라 구조적으로 렌더한다.
//  - 줄머리 불릿(-, •, ·, *, 1.) 라인이 2개 이상 → 마커가 붙은 리스트
//  - "라벨: 내용" 형태(짧은 라벨) 라인이 2개 이상 → 라벨 강조 섹션
//  - 그 외 → 빈 줄 기준 문단(문단 간 간격)
// 어떤 형식이 와도 안전하게 폴백한다(파싱 실패해도 원문은 보존).

type Props = {
  text: string;
  /** 리스트 마커/라벨 강조 색 (기본 OK 오렌지). */
  accent?: string;
  /** 본문 글자 크기 (기본 --fs-sm). 카드별로 키울 수 있다. */
  fontSize?: string;
  style?: CSSProperties;
};

const BULLET_RE = /^\s*[-•·*▪◦‣]\s+/;
const NUM_RE = /^\s*\d+[.)]\s+/;
// 라벨: 한글/영문 1~12자 + 콜론 + 내용. (URL 의 'http:' 등은 12자 제한·한글영문 시작으로 대부분 배제)
const LABEL_RE = /^([가-힣A-Za-z][가-힣A-Za-z0-9 /·]{0,11}):\s*(.+)$/;

const stripMarker = (line: string) => line.replace(BULLET_RE, '').replace(NUM_RE, '').trim();

export const AiContentText = ({ text, accent = 'var(--ok-orange)', fontSize = 'var(--fs-sm)', style }: Props) => {
  const raw = (text ?? '').trim();
  if (!raw) return null;

  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const bulletCount = lines.filter((l) => BULLET_RE.test(l) || NUM_RE.test(l)).length;
  const labeledCount = lines.filter((l) => LABEL_RE.test(stripMarker(l))).length;

  // 1) 불릿 리스트
  if (bulletCount >= 2) {
    return (
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 9,
          ...style,
        }}
      >
        {lines.map((line, i) => {
          const content = stripMarker(line);
          const m = content.match(LABEL_RE);
          return (
            <li
              key={i}
              style={{ display: 'flex', gap: 9, fontSize, lineHeight: 1.7, color: 'var(--fg)' }}
            >
              <span style={{ color: accent, fontWeight: 900, flexShrink: 0, marginTop: 1 }} aria-hidden="true">
                •
              </span>
              <span style={{ minWidth: 0 }}>
                {m ? (
                  <>
                    <strong style={{ color: 'var(--ok-brown)' }}>{m[1]}</strong> {m[2]}
                  </>
                ) : (
                  content
                )}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  // 2) 라벨 섹션 ("강점: …", "보완: …")
  if (labeledCount >= 2) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11, ...style }}>
        {lines.map((line, i) => {
          const m = line.match(LABEL_RE);
          if (m) {
            return (
              <div key={i}>
                <div className="sd-label-mini" style={{ color: accent, marginBottom: 3 }}>
                  {m[1]}
                </div>
                <div style={{ fontSize, lineHeight: 1.7, color: 'var(--fg)' }}>{m[2]}</div>
              </div>
            );
          }
          return (
            <div key={i} style={{ fontSize, lineHeight: 1.7, color: 'var(--fg)' }}>
              {line}
            </div>
          );
        })}
      </div>
    );
  }

  // 3) 문단 (빈 줄 기준)
  const paras = raw
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9, ...style }}>
      {(paras.length ? paras : [raw]).map((p, i) => (
        <p key={i} style={{ margin: 0, fontSize, lineHeight: 1.75, color: 'var(--fg)' }}>
          {p}
        </p>
      ))}
    </div>
  );
};

export default AiContentText;

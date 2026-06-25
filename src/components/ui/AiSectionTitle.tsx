import type { CSSProperties, ReactNode } from 'react';

// AI 출력 영역의 '통일된 제목' — 글자색은 어두운 파랑(--ai-accent), 크기는 주변 제목과 동일, 아이콘 없음.
//   - variant="heading" : 카드 섹션 제목(과업 비율·기여 분포 등, h3=var(--fs-h4)) 과 동일 크기
//   - variant="label"   : 작은 라벨(sd-label-mini, 사이드바 카드 제목 등) 과 동일 크기 (기본값)
type Props = {
  title: string;
  /** 우측 보조 캡션(생성일·상태 등). */
  right?: ReactNode;
  variant?: 'heading' | 'label';
  style?: CSSProperties;
};

export const AiSectionTitle = ({ title, right, variant = 'label', style }: Props) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      marginBottom: 10,
      ...style,
    }}
  >
    {variant === 'heading' ? (
      // 과업 비율 등 카드 섹션 제목(h3)과 동일 크기 — 색은 어두운 파랑.
      <span
        style={{
          fontSize: 'var(--fs-h4)',
          fontWeight: 800,
          color: 'var(--ai-accent)',
          letterSpacing: '-0.02em',
        }}
      >
        {title}
      </span>
    ) : (
      // sd-label-mini(작은 라벨) 크기 — 색은 어두운 파랑(인라인이 클래스 색을 덮음).
      <span className="sd-label-mini" style={{ color: 'var(--ai-accent)' }}>
        {title}
      </span>
    )}
    {right != null && (
      <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--fg-subtle)', flexShrink: 0 }}>{right}</span>
    )}
  </div>
);

export default AiSectionTitle;

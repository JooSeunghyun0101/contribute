type Props = {
  compact?: boolean;
  /** 'light' = 어두운 배경용 흰 글씨, 'dark' = 일반 화면용 fg */
  tone?: 'light' | 'dark';
};

export const BrandLockup = ({ compact = false, tone = 'dark' }: Props) => {
  const size = compact ? 38 : 48;
  const topFontSize = compact ? 15 : 19;
  const bottomFontSize = compact ? 9 : 11;
  const textColor = tone === 'light' ? '#F4EDE3' : 'var(--fg)';
  const subColor = tone === 'light' ? '#D6C9BC' : 'var(--fg-muted)';

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0,
        lineHeight: 1,
      }}
    >
      <img
        src="/느낌표_orange.png"
        alt="!"
        style={{
          width: size,
          height: size,
          objectFit: 'contain',
          display: 'block',
        }}
      />
      <div
        style={{
          display: 'inline-flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          marginLeft: -2,
        }}
      >
        <span
          style={{
            fontWeight: 800,
            fontSize: topFontSize,
            color: textColor,
            letterSpacing: '-0.02em',
            lineHeight: 1,
            whiteSpace: 'nowrap',
          }}
        >
          OK금융그룹
        </span>
        <span
          style={{
            fontWeight: 500,
            fontSize: bottomFontSize,
            color: subColor,
            letterSpacing: '0.18em',
            lineHeight: 1,
            whiteSpace: 'nowrap',
            paddingLeft: '0.18em',
          }}
        >
          기여도평가
        </span>
      </div>
    </div>
  );
};

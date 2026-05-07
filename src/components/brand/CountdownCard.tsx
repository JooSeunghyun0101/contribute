type Props = {
  label?: string;
  cycle?: string;
  remaining?: string;
  progress?: number;
};

export const CountdownCard = ({
  label = '평가 기간',
  cycle = '2026 연간',
  remaining = '~ 12월 31일',
  progress = 33,
}: Props) => (
  <div
    style={{
      marginTop: 'auto',
      padding: '14px 10px',
      borderTop: '1px solid var(--border)',
    }}
  >
    <div className="sd-label-mini" style={{ marginBottom: 8 }}>
      {label}
    </div>
    <div style={{ fontSize: 13, fontWeight: 700 }}>{cycle}</div>
    <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>{remaining}</div>
    <div className="sd-bar" style={{ marginTop: 10, height: 4 }}>
      <div className="sd-bar-fill" style={{ width: `${progress}%` }} />
    </div>
  </div>
);

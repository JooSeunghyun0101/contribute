import { OkMark } from './OkMark';

type Props = { compact?: boolean };

export const BrandLockup = ({ compact = false }: Props) => (
  <div className="flex items-center gap-2.5">
    <OkMark size={compact ? 24 : 28} />
    {!compact && (
      <div className="leading-tight">
        <div className="text-[15px] font-extrabold tracking-tight">
          OK<span className="text-ok-orange">!</span>Contribute
        </div>
        <div className="text-[10px] font-semibold tracking-[0.08em] text-[var(--fg-subtle)]">
          기여도평가시스템
        </div>
      </div>
    )}
  </div>
);

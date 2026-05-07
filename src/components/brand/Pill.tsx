import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type PillTone = 'neutral' | 'orange' | 'success' | 'warning' | 'danger' | 'info';

type Props = {
  tone?: PillTone;
  className?: string;
  children: ReactNode;
};

const toneClass: Record<PillTone, string> = {
  neutral: 'sd-chip',
  orange: 'sd-chip sd-chip-orange',
  success: 'sd-chip sd-chip-success',
  warning: 'sd-chip sd-chip-warning',
  danger: 'sd-chip sd-chip-danger',
  info: 'sd-chip sd-chip-info',
};

export const Pill = ({ tone = 'neutral', className, children }: Props) => (
  <span className={cn(toneClass[tone], className)}>{children}</span>
);

import * as React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * 명령형(imperative) 확인·사유 입력 다이얼로그.
 *
 * window.confirm / window.prompt 를 대체한다. 콜사이트는 `await confirm({...})`
 * 한 줄로 끝나고, 사용자가 확인하면 true(또는 입력값), 취소하면 false(또는 null)를 받는다.
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ title: '삭제할까요?', variant: 'danger' })) { ... }
 *
 *   const askReason = useReason();
 *   const reason = await askReason({ title: '반려 사유', required: true });
 *   if (reason === null) return; // 취소
 */

export interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'danger';
  /** 이 문구를 정확히 입력해야만 확인이 활성화된다(예: "RESET"). 위험 작업용. */
  requireTypedConfirmation?: string;
}

export interface ReasonOptions {
  title: string;
  description?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  placeholder?: string;
  /** true면 공백이 아닌 사유를 입력해야 확인이 활성화된다. */
  required?: boolean;
  variant?: 'default' | 'danger';
}

type Pending =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { kind: 'reason'; options: ReasonOptions; resolve: (value: string | null) => void };

interface DialogContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  reason: (options: ReasonOptions) => Promise<string | null>;
}

const DialogContext = React.createContext<DialogContextValue | undefined>(undefined);

const dangerActionClass =
  'bg-[var(--danger)] text-white hover:bg-[var(--danger)] hover:brightness-95 focus-visible:ring-[var(--danger)]';

export const ConfirmDialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [typed, setTyped] = React.useState('');
  const [reasonText, setReasonText] = React.useState('');

  const close = React.useCallback(() => {
    setPending(null);
    setTyped('');
    setReasonText('');
  }, []);

  const confirm = React.useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setTyped('');
        setPending({ kind: 'confirm', options, resolve });
      }),
    [],
  );

  const reason = React.useCallback(
    (options: ReasonOptions) =>
      new Promise<string | null>((resolve) => {
        setReasonText('');
        setPending({ kind: 'reason', options, resolve });
      }),
    [],
  );

  const value = React.useMemo(() => ({ confirm, reason }), [confirm, reason]);

  // 취소(ESC·바깥 클릭·취소 버튼) → 거짓값으로 resolve
  const handleCancel = () => {
    if (!pending) return;
    if (pending.kind === 'confirm') pending.resolve(false);
    else pending.resolve(null);
    close();
  };

  const handleConfirm = () => {
    if (!pending) return;
    if (pending.kind === 'confirm') pending.resolve(true);
    else pending.resolve(reasonText.trim());
    close();
  };

  const isDanger = pending?.options.variant === 'danger';
  const typedOk =
    pending?.kind !== 'confirm' ||
    !pending.options.requireTypedConfirmation ||
    typed === pending.options.requireTypedConfirmation;
  const reasonOk =
    pending?.kind !== 'reason' || !pending.options.required || reasonText.trim().length > 0;
  const confirmDisabled = !typedOk || !reasonOk;

  return (
    <DialogContext.Provider value={value}>
      {children}
      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && handleCancel()}>
        {pending && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{pending.options.title}</AlertDialogTitle>
              {pending.options.description && (
                <AlertDialogDescription asChild>
                  <div>{pending.options.description}</div>
                </AlertDialogDescription>
              )}
            </AlertDialogHeader>

            {pending.kind === 'confirm' && pending.options.requireTypedConfirmation && (
              <Input
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={pending.options.requireTypedConfirmation}
                aria-label="확인 문구 입력"
              />
            )}

            {pending.kind === 'reason' && (
              <Textarea
                autoFocus
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                placeholder={pending.options.placeholder ?? '내용을 입력해 주세요.'}
                rows={4}
              />
            )}

            <AlertDialogFooter>
              <AlertDialogCancel onClick={handleCancel}>
                {pending.options.cancelText ?? '취소'}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  // disabled 상태에서 닫히지 않도록 기본 동작(close)을 막는다.
                  if (confirmDisabled) {
                    e.preventDefault();
                    return;
                  }
                  handleConfirm();
                }}
                disabled={confirmDisabled}
                className={cn(isDanger && dangerActionClass, confirmDisabled && 'opacity-50')}
              >
                {pending.options.confirmText ?? '확인'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </DialogContext.Provider>
  );
};

const useDialogContext = () => {
  const ctx = React.useContext(DialogContext);
  if (!ctx) throw new Error('useConfirm/useReason must be used within ConfirmDialogProvider');
  return ctx;
};

export const useConfirm = () => useDialogContext().confirm;
export const useReason = () => useDialogContext().reason;

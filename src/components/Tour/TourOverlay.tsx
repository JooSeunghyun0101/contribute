import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MousePointerClick, X } from 'lucide-react';
import type { TourDefinition } from './tourTypes';

/**
 * 스포트라이트 오버레이 — 대상(data-tour)만 밝게 남기고 나머지를 딤 처리한다.
 * - SVG evenodd 컷아웃: 딤 영역은 클릭을 흡수하고, 구멍은 이벤트를 통과시킨다.
 *   (interactive 스텝이 아니면 구멍 위에 투명 차단막을 덮어 오조작을 막는다)
 * - 키보드 우회 차단: 차단막은 포인터만 막으므로, capture 단계에서 딤 뒤 요소의
 *   Enter/Space 활성화(및 select 화살표 변경)를 함께 막는다.
 * - rAF 루프로 매 프레임 대상 rect 를 재측정 — 아코디언 스프링 애니메이션·중첩 스크롤·
 *   리사이즈를 전부 추적하고, lerp 로 스포트라이트가 부드럽게 따라간다.
 * - 대상이 waitForMs 안에 마운트되지 않으면 스텝을 건너뛴다(조건부 렌더 화면 대응).
 *   대기 중에는 딤이 포인터를 통과시켜 화면이 잠기지 않고, 직전 스텝이 건너뛰어진
 *   상태라면 대기 시간을 800ms 로 줄여 연쇄 스킵이 빠르게 끝나게 한다.
 */

// 딤(z 48)은 Radix 포털(z-50)·토스트(z-100)보다 아래 — 다이얼로그·툴팁·토스트가 안내 위에 뜬다.
const Z_TOUR = 48;
const CARD_WIDTH = 340;
const HOLE_RADIUS = 12;
// 직전 스텝이 대상 미발견으로 건너뛰어진 경우의 축소 대기 시간
const CASCADE_WAIT_MS = 800;

type HoleRect = { x: number; y: number; w: number; h: number };

const lerp = (from: number, to: number, k: number) => from + (to - from) * k;

const lerpRect = (from: HoleRect, to: HoleRect, k: number): HoleRect => ({
  x: lerp(from.x, to.x, k),
  y: lerp(from.y, to.y, k),
  w: lerp(from.w, to.w, k),
  h: lerp(from.h, to.h, k),
});

/** evenodd 컷아웃용 라운드 사각형 경로 */
const roundedRectPath = ({ x, y, w, h }: HoleRect, radius: number) => {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  return (
    `M${x + r},${y} h${w - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${h - 2 * r} ` +
    `a${r},${r} 0 0 1 -${r},${r} h${-(w - 2 * r)} a${r},${r} 0 0 1 -${r},-${r} ` +
    `v${-(h - 2 * r)} a${r},${r} 0 0 1 ${r},-${r} z`
  );
};

const findTarget = (target: string) =>
  document.querySelector<HTMLElement>(`[data-tour="${target}"]`);

const isDisabledElement = (el: HTMLElement) =>
  ((el instanceof HTMLButtonElement ||
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement) &&
    el.disabled) ||
  el.getAttribute('aria-disabled') === 'true';

const isEditableElement = (node: EventTarget | null) => {
  if (!(node instanceof HTMLElement)) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
};

interface TourOverlayProps {
  tour: TourDefinition;
  onClose: () => void;
}

const TourOverlay = ({ tour, onClose }: TourOverlayProps) => {
  const steps = tour.steps;
  const [stepIndex, setStepIndex] = useState(0);
  const [targetFound, setTargetFound] = useState(false);
  const [targetDisabled, setTargetDisabled] = useState(false);

  const dimPathRef = useRef<SVGPathElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);
  const blockerRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const holeRef = useRef<HoleRect | null>(null);
  // 직전 스텝이 '대상 미발견 타임아웃'으로 건너뛰어졌는지 — 연쇄 스킵 가속용
  const lastAutoSkipRef = useRef(false);

  const step = stepIndex >= 0 && stepIndex < steps.length ? steps[stepIndex] : null;
  const isLast = stepIndex === steps.length - 1;
  const interactive = !!step && (step.advanceOn === 'click' || step.interactive === true);

  // 마지막 스텝을 지나면 종료
  useEffect(() => {
    if (stepIndex >= steps.length) onClose();
  }, [stepIndex, steps.length, onClose]);

  // 특정 스텝에서 출발할 때만 전진 — 클릭 감지·타임아웃 건너뛰기·'다음' 버튼이
  // 겹쳐 두 번 전진하는 것을 막는다.
  const goNextFrom = useCallback((from: number) => {
    setStepIndex((prev) => (prev === from ? prev + 1 : prev));
  }, []);

  const handleNext = useCallback(() => {
    if (!step) return;
    // 클릭 진행 스텝에서 '다음'을 누르면 대상 클릭을 대신 실행해 같은 결과가 되게 한다.
    // 단 마지막 스텝의 '완료'는 종료 의사이므로 실제 클릭(예: 화면 이동)을 대신 실행하지 않는다.
    if (step.advanceOn === 'click' && !isLast) {
      const el = findTarget(step.target);
      if (el && !isDisabledElement(el)) {
        try {
          el.click();
        } catch {
          /* 클릭 실패는 무시하고 진행 */
        }
      }
    }
    goNextFrom(stepIndex);
  }, [step, stepIndex, isLast, goNextFrom]);

  const handlePrev = useCallback(() => {
    setStepIndex((prev) => Math.max(0, prev - 1));
  }, []);

  // 스텝이 바뀌면 안내 카드로 포커스 이동 — Tab 시작점을 카드 안으로 끌어와
  // 딤 뒤 요소로 포커스가 떠돌지 않게 한다.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      cardRef.current?.focus({ preventScroll: true });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [stepIndex]);

  // 대상 추적 rAF 루프 — 측정·딤 경로·링·차단막·카드 위치를 프레임마다 직접 갱신(리렌더 없음)
  useEffect(() => {
    if (!step) return;
    let raf = 0;
    let disposed = false;
    let scrolled = false;
    let missingSince: number | null = null;
    const fromIndex = stepIndex;
    const pad = step.spotlightPadding ?? 8;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const paint = (hole: HoleRect | null) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const dim = dimPathRef.current;
      if (dim) {
        dim.setAttribute(
          'd',
          hole
            ? `M0,0 H${vw} V${vh} H0 Z ${roundedRectPath(hole, HOLE_RADIUS)}`
            : `M0,0 H${vw} V${vh} H0 Z`,
        );
        // 대상 대기 중(구멍 없음)에는 딤이 클릭을 흡수하지 않게 — 화면 잠금 방지
        dim.style.pointerEvents = hole ? 'auto' : 'none';
        dim.style.fillOpacity = hole ? '1' : '0.55';
      }

      const ring = ringRef.current;
      if (ring) {
        if (hole) {
          ring.style.opacity = '1';
          ring.style.transform = `translate(${hole.x}px, ${hole.y}px)`;
          ring.style.width = `${hole.w}px`;
          ring.style.height = `${hole.h}px`;
        } else {
          ring.style.opacity = '0';
        }
      }

      const blocker = blockerRef.current;
      if (blocker) {
        if (hole && !interactive) {
          blocker.style.display = 'block';
          blocker.style.transform = `translate(${hole.x}px, ${hole.y}px)`;
          blocker.style.width = `${hole.w}px`;
          blocker.style.height = `${hole.h}px`;
        } else {
          blocker.style.display = 'none';
        }
      }

      const card = cardRef.current;
      if (card) {
        const cardW = card.offsetWidth;
        const cardH = card.offsetHeight;
        const gap = 14;
        const margin = 12;
        let top: number;
        let left: number;
        if (!hole) {
          // 대상 대기 중 — 화면 중앙에 안내 카드만
          top = vh / 2 - cardH / 2;
          left = vw / 2 - cardW / 2;
        } else {
          const fitsBelow = hole.y + hole.h + gap + cardH <= vh - margin;
          const fitsAbove = hole.y - gap - cardH >= margin;
          if (fitsBelow || fitsAbove) {
            top = fitsBelow ? hole.y + hole.h + gap : hole.y - gap - cardH;
            left = Math.max(margin, Math.min(vw - cardW - margin, hole.x + hole.w / 2 - cardW / 2));
          } else {
            // 대상이 세로로 큰 경우 — 좌우 배치
            top = Math.max(margin, Math.min(vh - cardH - margin, hole.y + hole.h / 2 - cardH / 2));
            const fitsRight = hole.x + hole.w + gap + cardW <= vw - margin;
            left = fitsRight ? hole.x + hole.w + gap : Math.max(margin, hole.x - gap - cardW);
          }
        }
        card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
      }
    };

    const tick = (now: number) => {
      if (disposed) return;
      const el = findTarget(step.target);
      const rect = el?.getBoundingClientRect();
      if (!el || !rect || rect.width < 2 || rect.height < 2) {
        if (missingSince == null) missingSince = now;
        const waitMs = lastAutoSkipRef.current
          ? Math.min(step.waitForMs ?? 3000, CASCADE_WAIT_MS)
          : (step.waitForMs ?? 3000);
        if (now - missingSince > waitMs) {
          // 대상이 끝내 나타나지 않는 화면 상태 — 이 스텝은 건너뛴다
          lastAutoSkipRef.current = true;
          goNextFrom(fromIndex);
          return;
        }
        holeRef.current = null;
        setTargetFound(false);
        paint(null);
        raf = requestAnimationFrame(tick);
        return;
      }
      missingSince = null;
      lastAutoSkipRef.current = false;
      if (!scrolled) {
        scrolled = true;
        // 중첩 스크롤 컨테이너(<main>·아코디언 내부 패널)에서도 대상을 화면 중앙으로
        try {
          el.scrollIntoView({
            block: 'center',
            inline: 'nearest',
            behavior: reduced ? 'auto' : 'smooth',
          });
        } catch {
          /* noop */
        }
      }
      setTargetFound(true);
      setTargetDisabled(isDisabledElement(el));
      const target: HoleRect = {
        x: rect.left - pad,
        y: rect.top - pad,
        w: rect.width + pad * 2,
        h: rect.height + pad * 2,
      };
      const current = holeRef.current;
      const next = current && !reduced ? lerpRect(current, target, 0.3) : target;
      holeRef.current = next;
      paint(next);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
    };
  }, [step, stepIndex, interactive, goNextFrom]);

  // advanceOn='click' — 대상(또는 그 내부)을 실제로 클릭하면 다음 요소가 마운트될 시간을 두고 전진.
  // 스텝이 바뀌면 대기 중인 전진 타이머를 취소 — '이전'으로 되돌아온 직후 되감기가 풀리는 것 방지.
  useEffect(() => {
    if (!step || step.advanceOn !== 'click') return;
    const fromIndex = stepIndex;
    let timer: number | null = null;
    const onClickCapture = (event: MouseEvent) => {
      const el = findTarget(step.target);
      if (el && event.target instanceof Node && el.contains(event.target)) {
        if (timer != null) window.clearTimeout(timer);
        timer = window.setTimeout(() => goNextFrom(fromIndex), 350);
      }
    };
    document.addEventListener('click', onClickCapture, true);
    return () => {
      document.removeEventListener('click', onClickCapture, true);
      if (timer != null) window.clearTimeout(timer);
    };
  }, [step, stepIndex, goNextFrom]);

  // 딤 뒤 요소의 키보드 활성화 차단 — 차단막·딤은 포인터만 막으므로 Tab 포커스 후
  // Enter/Space(또는 select 화살표 변경) 우회를 capture 단계에서 막는다.
  // 투어 카드·Radix 포털(달력·다이얼로그)은 #root 밖(body 포털)이라 영향받지 않는다.
  useEffect(() => {
    if (!step) return;
    const onGuardKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const appRoot = document.getElementById('root');
      if (!appRoot || !appRoot.contains(target)) return;
      const el = findTarget(step.target);
      if (interactive && el && el.contains(target)) return; // 스포트라이트 대상 내부는 허용
      const isActivation = event.key === 'Enter' || event.key === ' ';
      const isSelectArrow = target instanceof HTMLSelectElement && event.key.startsWith('Arrow');
      if (isActivation || isSelectArrow) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('keydown', onGuardKeyDown, true);
    return () => window.removeEventListener('keydown', onGuardKeyDown, true);
  }, [step, interactive]);

  // 키보드: Esc 종료, ←/→ 이동(입력 요소에 포커스가 있으면 화살표는 무시)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return; // 다이얼로그 등 다른 레이어가 이미 처리
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (isEditableElement(event.target)) return;
      if (event.key === 'ArrowRight') handleNext();
      else if (event.key === 'ArrowLeft') handlePrev();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, handleNext, handlePrev]);

  if (!step) return null;

  const clickHint =
    step.advanceOn === 'click'
      ? !targetFound
        ? '안내할 화면 요소를 찾는 중입니다…'
        : targetDisabled
          ? "지금은 누를 수 없는 상태입니다. '다음'을 눌러 계속하세요."
          : '강조된 버튼을 직접 눌러 진행해 보세요.'
      : null;

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: Z_TOUR, pointerEvents: 'none' }}>
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
        {/* evenodd — 바깥(딤)만 페인트되어 클릭을 흡수하고, 구멍은 이벤트가 통과한다 */}
        <path
          ref={dimPathRef}
          fillRule="evenodd"
          d=""
          style={{ fill: 'var(--overlay)', pointerEvents: 'auto', cursor: 'default' }}
        />
      </svg>

      {/* 스포트라이트 테두리 링 — 클릭 진행 스텝은 은은히 깜빡여 행동을 유도(비활성 대상 제외) */}
      <div
        ref={ringRef}
        aria-hidden="true"
        className={step.advanceOn === 'click' && !targetDisabled ? 'animate-pulse' : undefined}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          opacity: 0,
          border: '2px solid var(--ok-orange-brand)',
          borderRadius: HOLE_RADIUS,
          boxShadow: 'var(--sh-focus)',
          pointerEvents: 'none',
        }}
      />

      {/* interactive 가 아닌 스텝에서 구멍을 덮는 투명 차단막 — 안내 중 오조작 방지 */}
      <div
        ref={blockerRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          display: 'none',
          pointerEvents: 'auto',
          cursor: 'default',
        }}
      />

      <div
        ref={cardRef}
        role="dialog"
        aria-label={`화면 안내 — ${step.title}`}
        tabIndex={-1}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: CARD_WIDTH,
          maxWidth: 'calc(100vw - 24px)',
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--sh-lg)',
          padding: '16px 18px',
          pointerEvents: 'auto',
          outline: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1, fontSize: 'var(--fs-h4)', fontWeight: 800, lineHeight: 1.3 }}>
            {step.title}
          </div>
          <button
            type="button"
            className="sd-btn sd-btn-ghost sd-btn-xs"
            onClick={onClose}
            aria-label="안내 닫기"
            style={{ flexShrink: 0 }}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        <p
          style={{
            margin: '8px 0 0',
            fontSize: 'var(--fs-body)',
            lineHeight: 1.7,
            color: 'var(--fg-muted)',
            whiteSpace: 'pre-line',
          }}
        >
          {step.body}
        </p>

        {clickHint && (
          <div
            style={{
              marginTop: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              color: 'var(--ok-orange)',
              fontSize: 'var(--fs-sm)',
              fontWeight: 700,
            }}
          >
            <MousePointerClick size={14} aria-hidden="true" />
            {clickHint}
          </div>
        )}

        {step.advanceOn !== 'click' && !targetFound && (
          <div
            style={{
              marginTop: 10,
              fontSize: 'var(--fs-sm)',
              fontWeight: 700,
              color: 'var(--fg-subtle)',
            }}
          >
            안내할 화면 요소를 찾는 중입니다. 지금 화면에 없으면 곧 다음 단계로 넘어갑니다…
          </div>
        )}

        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            className="tnum"
            style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--fg-subtle)' }}
          >
            {stepIndex + 1} / {steps.length}
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" className="sd-btn sd-btn-ghost sd-btn-xs" onClick={onClose}>
            건너뛰기
          </button>
          {stepIndex > 0 && (
            <button type="button" className="sd-btn sd-btn-outline sd-btn-xs" onClick={handlePrev}>
              이전
            </button>
          )}
          <button type="button" className="sd-btn sd-btn-primary sd-btn-xs" onClick={handleNext}>
            {isLast ? '완료' : '다음'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default TourOverlay;

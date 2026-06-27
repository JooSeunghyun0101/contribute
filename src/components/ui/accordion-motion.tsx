import { AnimatePresence, motion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";

// FaqPro 와 동일한 펼침 감성(스프링 높이 + 페이드). 다른 아코디언에 재사용한다.
const PANEL_EASE = [0.16, 1, 0.3, 1] as const;
const EXPAND_SPRING = {
  type: "spring" as const,
  stiffness: 150,
  damping: 26,
  mass: 1.05,
};

type AccordionMotionProps = {
  /** 펼침 여부 */
  isOpen: boolean;
  children: ReactNode;
  /** 높이 애니메이션을 담당하는 바깥 래퍼 스타일/클래스 */
  className?: string;
  style?: CSSProperties;
  /** 실제 콘텐츠를 감싸는 안쪽 래퍼 스타일/클래스(예: flex·gap 보존용) */
  contentClassName?: string;
  contentStyle?: CSSProperties;
};

/**
 * 높이 0↔auto 를 스프링으로 부드럽게 펼치고/접는 래퍼.
 * 닫히면 콘텐츠를 언마운트(AnimatePresence)해, 무거운 패널을 가진 목록에서도 닫힌 항목의 DOM 비용이 없다.
 * 사용법: 기존 `{isOpen && <Content/>}` 를 `<AccordionMotion isOpen={isOpen}><Content/></AccordionMotion>` 로 교체.
 */
export function AccordionMotion({
  isOpen,
  children,
  className,
  style,
  contentClassName,
  contentStyle,
}: AccordionMotionProps) {
  return (
    <AnimatePresence initial={false}>
      {isOpen ? (
        <motion.div
          key="accordion-content"
          animate={{ height: "auto", opacity: 1 }}
          className={className}
          exit={{ height: 0, opacity: 0 }}
          initial={{ height: 0, opacity: 0 }}
          style={{ overflow: "hidden", ...style }}
          transition={{
            height: EXPAND_SPRING,
            opacity: { duration: 0.28, ease: PANEL_EASE, delay: 0.04 },
          }}
        >
          {contentClassName || contentStyle ? (
            <div className={contentClassName} style={contentStyle}>
              {children}
            </div>
          ) : (
            children
          )}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * 펼침 상태에 따라 회전하는 셰브론 표시용 클래스 헬퍼.
 * lucide ChevronDown 등에 `className={cn(chevronRotateClass(isOpen))}` 로 적용.
 */
export function chevronRotateClass(isOpen: boolean) {
  return `transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]${
    isOpen ? " rotate-180" : ""
  }`;
}

// 인라인 style 로 회전이 필요할 때(클래스 적용이 어려운 곳).
export function chevronRotateStyle(isOpen: boolean): CSSProperties {
  return {
    transition: "transform 0.3s cubic-bezier(0.16,1,0.3,1)",
    transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
  };
}

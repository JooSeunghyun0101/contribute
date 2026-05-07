import React from 'react';

export function useScroll(threshold: number, containerRef?: React.RefObject<HTMLElement | null>) {
    const [scrolled, setScrolled] = React.useState(false);

    React.useEffect(() => {
        if (containerRef) {
            // 컨테이너 스크롤: document capture로 잡고 e.target.scrollTop 직접 읽기
            const check = (e: Event) => {
                setScrolled((e.target as HTMLElement).scrollTop > threshold);
            };
            document.addEventListener('scroll', check, true);
            return () => document.removeEventListener('scroll', check, true);
        } else {
            // 윈도우 스크롤 (기존 동작 유지)
            const check = () => setScrolled(window.scrollY > threshold);
            window.addEventListener('scroll', check);
            check();
            return () => window.removeEventListener('scroll', check);
        }
    }, [threshold, containerRef]);

    return scrolled;
}

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';
import { FaqPro } from '@/components/ui/faq-pro';
import { settingService } from '@/lib/services';

interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

interface FaqSectionProps {
  /** 카드 컨테이너 추가/덮어쓰기 스타일. 기본은 상단 여백 24px(목록 하단 배치용). */
  style?: CSSProperties;
  /** FAQ가 없을 때 대신 보여줄 내용. 미지정 시 아무것도 렌더하지 않는다(기존 동작 유지). */
  emptyFallback?: ReactNode;
}

// HR이 '공지·FAQ' 화면에서 등록한 FAQ(settings: system/faq_catalog)를 직원에게 노출한다.
// settings 읽기는 system 공유라 모든 로그인 사용자가 조회 가능(서버 requireSettingsRead).
// FAQ가 없으면 기본적으로 렌더하지 않는다(emptyFallback 지정 시 그 내용을 대신 표시).
export const FaqSection = ({ style, emptyFallback }: FaqSectionProps = {}) => {
  const [faqs, setFaqs] = useState<FaqItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    settingService
      .getUserSetting('system', 'faq_catalog')
      .then((setting) => {
        if (cancelled) return;
        const data = setting?.setting_data as { faqs?: FaqItem[] } | undefined;
        const list = Array.isArray(data?.faqs) ? data.faqs : [];
        setFaqs(list.filter((f) => f.question?.trim() && f.answer?.trim()));
      })
      .catch(() => {
        // 조회 실패 시 조용히 숨김 — FAQ는 보조 정보라 오류 배너까지는 띄우지 않는다.
        if (!cancelled) setFaqs([]);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) return emptyFallback != null ? <>{emptyFallback}</> : null;
  if (faqs.length === 0) return emptyFallback != null ? <>{emptyFallback}</> : null;

  return (
    <section className="sd-card sd-card-lg" style={{ marginTop: 24, ...style }}>
      <h2
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 'var(--fs-h4)',
          fontWeight: 800,
          marginBottom: 4,
        }}
      >
        <HelpCircle size={18} style={{ color: 'var(--ok-orange)' }} aria-hidden />
        자주 묻는 질문
      </h2>
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', marginBottom: 14 }}>
        평가 진행 중 궁금한 점을 확인해 보세요.
      </p>
      <FaqPro
        className="mx-0 max-w-none"
        defaultOpenFirst
        items={faqs}
        searchPlaceholder="질문 검색…"
      />
    </section>
  );
};

export default FaqSection;

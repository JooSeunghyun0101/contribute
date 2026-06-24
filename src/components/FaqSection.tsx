import { useEffect, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { settingService } from '@/lib/services';

interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

// HR이 '공지·FAQ' 화면에서 등록한 FAQ(settings: system/faq_catalog)를 직원에게 노출한다.
// settings 읽기는 system 공유라 모든 로그인 사용자가 조회 가능(서버 requireSettingsRead).
// FAQ가 없으면 섹션 자체를 렌더하지 않아 화면을 어지럽히지 않는다.
export const FaqSection = () => {
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

  if (!loaded || faqs.length === 0) return null;

  return (
    <section className="sd-card sd-card-lg" style={{ marginTop: 24 }}>
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
      <Accordion type="single" collapsible>
        {faqs.map((faq) => (
          <AccordionItem key={faq.id} value={faq.id}>
            <AccordionTrigger style={{ textAlign: 'left' }}>{faq.question}</AccordionTrigger>
            <AccordionContent>
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, color: 'var(--fg)' }}>
                {faq.answer}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
};

export default FaqSection;

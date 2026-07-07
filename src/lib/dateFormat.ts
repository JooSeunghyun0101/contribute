/**
 * P3-10: 날짜 표기 공용 컨벤션 — 화면마다 제각각이던 포맷(YY.MM.DD / YYYY.MM.DD /
 * M월 D일 / ISO 등)을 한 곳으로 모은다. 신규 화면은 이 모듈을 쓰고, 기존 화면은
 * 만질 때 이관한다.
 *
 *  - formatDate     : 2026.07.06        (목록·이력의 날짜 표기 표준)
 *  - formatDateTime : 2026.07.06 14:30  (요청·감사 등 시각까지 필요한 곳)
 *  - formatMonthDay : 7월 6일           (같은 해가 자명한 축약 표기)
 *
 * 용어 컨벤션(같은 항목에서 정리): '최종제출' = 피평가자의 제출 행동(버튼·상태),
 * '성과보고' = 제출하는 산출물/행위 개념. 안내 문구에서 처음 등장할 때는
 * '성과보고(최종제출)'처럼 병기한다.
 */

export const formatDate = (value?: string | null): string => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(
    d.getDate(),
  ).padStart(2, '0')}`;
};

export const formatDateTime = (value?: string | null): string => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return `${formatDate(value)} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
};

export const formatMonthDay = (value?: string | null): string => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
};

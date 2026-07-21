/**
 * 화면 안내(코치마크) 투어 타입.
 * target 은 DOM 의 data-tour 속성값 — 해당 앵커가 마운트되어 있을 때만 스텝이 표시되고,
 * waitForMs 안에 나타나지 않으면 그 스텝은 건너뛴다(조건부 렌더 화면 대응).
 */
export interface TourStep {
  /** data-tour 속성값 */
  target: string;
  title: string;
  body: string;
  /** 'click' 이면 하이라이트된 요소를 실제로 눌러야 진행('다음' 버튼은 대상 클릭을 대신 실행) */
  advanceOn?: 'click';
  /** 스포트라이트 구멍으로 대상 요소를 직접 조작(입력·클릭) 허용. advanceOn='click' 은 항상 허용 */
  interactive?: boolean;
  /** 대상 마운트 대기 시간(ms). 초과 시 스텝 건너뜀. 기본 3000 */
  waitForMs?: number;
  /** 스포트라이트 여백(px). 기본 8 */
  spotlightPadding?: number;
}

export interface TourDefinition {
  id: string;
  steps: TourStep[];
}

/**
 * 투어 시작 시 window 에 dispatch 되는 커스텀 이벤트 이름.
 * 앵커가 접힌 아코디언 안에 있는 화면은 이 이벤트를 듣고 컨테이너를 펼쳐서
 * 스텝이 '대상 없음'으로 건너뛰어지는 것을 막는다. detail: { tourId }.
 */
export const TOUR_START_EVENT = 'elevate:coach-tour-start';

export interface TourStartEventDetail {
  tourId: string;
}

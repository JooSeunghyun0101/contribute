import { describe, it, expect, vi, afterEach } from 'vitest';
import { feedbackService } from './feedbackService';
import { taskService } from './taskService';

// updateTaskEvaluation 은 camelCase 평가 필드를 snake_case 로 매핑해
// taskService.updateTask 로 전달한다(정의된 필드만 포함).
describe('feedbackService.updateTaskEvaluation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('camelCase → snake_case 로 매핑해 taskService.updateTask 에 전달한다', async () => {
    const spy = vi.spyOn(taskService, 'updateTask').mockResolvedValue({} as never);
    await feedbackService.updateTaskEvaluation('123', {
      contributionMethod: 'Method A',
      contributionScope: 'Scope B',
      score: 85,
      feedback: 'Great work',
      feedbackDate: '2025-11-24',
      evaluatorName: '홍길동',
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('123', {
      contribution_method: 'Method A',
      contribution_scope: 'Scope B',
      score: 85,
      feedback: 'Great work',
      feedback_date: '2025-11-24',
      evaluator_name: '홍길동',
    });
  });

  it('정의되지 않은 필드는 payload 에서 제외한다', async () => {
    const spy = vi.spyOn(taskService, 'updateTask').mockResolvedValue({} as never);
    await feedbackService.updateTaskEvaluation('123', { score: 70 });
    expect(spy).toHaveBeenCalledWith('123', { score: 70 });
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { taskService } from './taskService';
import { taskApiService } from './taskApiService';

// taskService 는 taskApiService 를 apiErrorHandler 로 감싸는 얇은 래퍼.
// softDelete 위임이 올바른 인자로 1회 이뤄지는지 검증한다.
describe('taskService.softDeleteTask', () => {
  afterEach(() => vi.restoreAllMocks());

  it('taskApiService.softDeleteTask 로 동일 id 를 1회 위임한다', async () => {
    const spy = vi.spyOn(taskApiService, 'softDeleteTask').mockResolvedValue(undefined);
    await taskService.softDeleteTask('test-task-123');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('test-task-123', undefined);
  });

  it('past 옵션을 그대로 전달한다', async () => {
    const spy = vi.spyOn(taskApiService, 'softDeleteTask').mockResolvedValue(undefined);
    await taskService.softDeleteTask('t1', { past: true });
    expect(spy).toHaveBeenCalledWith('t1', { past: true });
  });
});

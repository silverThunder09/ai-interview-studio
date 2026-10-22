import { describe, expect, it } from 'vitest';
import { emptyLoopState, parseLoopState } from '../../scripts/review/loop-coordinator.mjs';

const config = { schema: 1, repository: 'silverThunder09/ai-interview-studio', enabled: true, tasks: [{ id: 'recovery', pr: 75, goal: '검증된 큐 확장의 응답 유실·경합 복구', approval: '현재 채팅에서 승인된 자동화 계속 실행', allowed_paths: ['tests/unit/loop-queue-recovery.test.ts'] }] };

describe('queue recovery without replay', () => {
  it('keeps a persisted checkpoint intact when it is read again', () => {
    const persisted = emptyLoopState(config); persisted.revision = 9;
    persisted.tasks[0]!.phase = 'completed'; persisted.tasks[0]!.cycles = 2;
    const received = JSON.parse(JSON.stringify(persisted));
    expect(parseLoopState(received, config)).toEqual(persisted);
  });
});

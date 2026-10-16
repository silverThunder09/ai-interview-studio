import { randomUUID } from 'node:crypto';
import type { StartInterviewRequest } from '../../src/shared/interview';

export function startFixture(): StartInterviewRequest {
  return { requestId: randomUUID(), reviewedText: '합성 프로젝트에서 Java API를 개발했습니다.', sourceSections: [{ location: '단락 1', text: '합성 프로젝트에서 Java API를 개발했습니다.' }], storageConsent: true };
}

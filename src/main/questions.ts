import type { EvidenceQuote, InterviewSession, InterviewQuestion, StartInterviewRequest } from '../shared/interview';
import { INTERVIEW_LIMITS } from '../shared/interview';

export type QuestionDraft = Omit<InterviewQuestion, 'id' | 'number'>;
// Local, deterministic provider. No network, model, scoring or inference.
export interface QuestionProvider {
  next(resume: Pick<StartInterviewRequest, 'reviewedText' | 'sourceSections'>, previous: InterviewSession['turns']): QuestionDraft | null;
}
const technical = [
  'Java에서 equals와 hashCode의 관계를 설명하고, 컬렉션을 사용할 때 주의할 점을 예로 들어 주세요.',
  'Spring의 트랜잭션 경계와 프록시 동작을 설명해 주세요. 직접 사용한 경험이 없다면 이해한 원리로 답해도 됩니다.',
  '데이터베이스 인덱스가 조회에 도움이 되는 경우와 쓰기 비용이 증가하는 이유를 설명해 주세요.',
  '같은 API 요청이 중복 도착할 때 데이터 정합성을 지키는 방법을 설명해 주세요.',
  '백엔드 응답이 느릴 때 병목을 찾고 개선 효과를 검증하는 순서를 설명해 주세요.',
];
export class LocalQuestionProvider implements QuestionProvider {
  next(resume: Pick<StartInterviewRequest, 'reviewedText' | 'sourceSections'>, previous: InterviewSession['turns']): QuestionDraft | null {
    const number = previous.length;
    if (number >= INTERVIEW_LIMITS.turns) return null;
    if (number === 0) {
      const section = resume.sourceSections.find((part) => resume.reviewedText.includes(part.text.slice(0, 180).trim()));
      const evidence: EvidenceQuote = section
        ? { origin: 'source', location: section.location, text: section.text.slice(0, 180).trim() }
        : { origin: 'reviewed', location: '사용자 수정본', text: resume.reviewedText.slice(0, 180).trim() };
      return { kind: 'experience', evidence, text: '아래 구절과 관련된 실제 경험을 골라 본인의 역할, 문제 해결 과정, 결과를 설명해 주세요. 직접 맡지 않은 일은 구분해 주세요.' };
    }
    if (number % 2 === 1) {
      const answer = previous.at(-1)?.answer;
      if (!answer) throw new Error('Answer required for follow-up');
      return { kind: 'follow-up', evidence: { origin: 'answer', location: `${number}번 답변`, text: answer.slice(0, 180) }, text: '방금 답변의 아래 부분을 더 구체적으로 설명해 주세요. 선택한 방법의 이유와 검토한 대안은 무엇이었나요? 근거가 부족하다면 그 한계도 알려 주세요.' };
    }
    const question = technical[number / 2 - 1];
    if (!question) return null;
    return { kind: 'technical', evidence: null, text: question };
  }
}

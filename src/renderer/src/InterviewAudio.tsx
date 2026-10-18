import { useState } from 'react';
import { SpeechOutput } from './SpeechOutput';
import { VoiceInput } from './VoiceInput';

type Mode = 'speech' | 'voice' | 'text';
export function InterviewAudio({ sessionId, questionId, question, answer, answerLimit, onBusy, onApply, onReviewAnswer }: {
  sessionId: string; questionId: string; question: string; answer: string; answerLimit: number;
  onBusy: (busy: boolean) => void; onApply: (text: string) => void; onReviewAnswer: () => void;
}) {
  const [mode, setMode] = useState<Mode>();
  function select(next: Mode) { setMode(next); if (next === 'text') onReviewAnswer(); }
  return <section className="audio-flow" aria-label="음성 연습 도우미">
    <h3>질문을 듣고, 내 답변을 검토하세요</h3>
    <p>원하는 단계를 선택하세요. 단계 이동만으로 녹음·전송·재생·저장을 시작하지 않습니다. 음성과 미적용 전사는 단계를 바꾸면 폐기하며 입력한 답변은 유지합니다.</p>
    <div className="audio-flow-steps" role="group" aria-label="음성 연습 단계 선택">
      <button className="secondary" aria-pressed={mode === 'speech'} onClick={() => select('speech')}>1. 질문 듣기</button>
      <button className="secondary" aria-pressed={mode === 'voice'} onClick={() => select('voice')}>2. 답변 녹음·전사</button>
      <button className="secondary" aria-pressed={mode === 'text'} onClick={() => select('text')}>3. 답변 검토·제출</button>
    </div>
    {mode === 'speech' && <><SpeechOutput sessionId={sessionId} questionId={questionId} question={question} onBusy={onBusy} />
      <button className="secondary" onClick={() => select('voice')}>답변 녹음 단계로 이동</button></>}
    {mode === 'voice' && <VoiceInput sessionId={sessionId} questionId={questionId} answer={answer} answerLimit={answerLimit} onBusy={onBusy}
      onApply={text => { onApply(text); select('text'); }} />}
    {mode === 'text' && <p className="audio-flow-review" role="status">{answer.trim() ? '아래 답변을 검토하고 제출 버튼을 직접 누르세요. 아직 저장하거나 다음 질문을 생성하지 않았습니다.' : '아래에 답변을 직접 입력할 수 있습니다. 음성 없이 텍스트만으로도 계속할 수 있습니다.'}</p>}
    {!mode && <p className="hint">질문 읽기와 전사는 각각 OpenAI 모델·키·전송 동의가 필요합니다. 텍스트 입력도 바로 사용할 수 있습니다.</p>}
  </section>;
}

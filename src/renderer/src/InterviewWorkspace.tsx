import { useEffect, useRef, useState } from 'react';
import type { InterviewSession } from '../../shared/interview';
import { INTERVIEW_LIMITS } from '../../shared/interview';

export function InterviewWorkspace({ session, onUpdate, onHistory }: {
  session: InterviewSession; onUpdate: (session: InterviewSession) => void; onHistory: () => void;
}) {
  const [answer, setAnswer] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const lock = useRef(false);
  const pendingId = useRef<string | undefined>(undefined);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => {
    live.current = false;
    if (pendingId.current) void window.studio?.cancelInterviewOperation(pendingId.current).catch(() => {});
  }; }, []);
  const current = session.turns.find((turn) => turn.answer === null);
  const answered = session.turns.filter((turn) => turn.answer !== null).length;
  async function submit() {
    if (!current || lock.current || !answer.trim()) return;
    lock.current = true; pendingId.current = current.question.id; setSaving(true); setError('');
    try {
      const result = await window.studio!.submitInterviewAnswer({ sessionId: session.id, questionId: current.question.id, answer });
      // A save that completed just before navigation still updates the parent
      // snapshot, so returning to the session cannot show the old question.
      if (result.ok) { onUpdate(result.value); if (live.current) setAnswer(''); }
      else if (live.current) setError(result.error.message);
    } catch { if (live.current) setError('답변을 저장하지 못했습니다. 입력한 내용은 유지됩니다. 다시 시도해 주세요.'); }
    finally { lock.current = false; pendingId.current = undefined; if (live.current) { setSaving(false); setCancelling(false); } }
  }
  async function cancel() {
    const id = pendingId.current;
    if (!id || cancelling) return;
    setCancelling(true);
    try { const result = await window.studio!.cancelInterviewOperation(id); if (live.current && !result.ok) setError(result.error.message); }
    catch { if (live.current) setError('취소 요청을 전달하지 못했습니다. 처리 결과를 확인해 주세요.'); }
    finally { if (live.current) setCancelling(false); }
  }
  return <section className="interview-workspace" aria-labelledby="interview-title">
    <p className="eyebrow">LOCAL PRACTICE</p><h1 id="interview-title">백엔드 텍스트 연습</h1>
    <p className="muted">준비된 질문과 답변 인용으로 진행합니다. AI 분석·평가가 아니며 외부 전송이나 비용은 없습니다.</p>
    <div className="session-progress"><span>{answered} / {INTERVIEW_LIMITS.turns}개 답변 저장</span><button className="secondary" disabled={saving} onClick={onHistory}>저장된 기록 보기</button></div>
    {error && <p className="error" role="alert">{error}</p>}
    {current ? <article className="question-card" aria-labelledby="current-question-title">
      <span className="tag">{current.question.kind === 'technical' ? '일반 기술 질문' : current.question.kind === 'follow-up' ? '내 답변에 대한 후속 질문' : current.question.evidence ? '이력서 관련 질문' : '일반 경험 질문'}</span>
      <h2 id="current-question-title">질문 {current.question.number}</h2><p className="question-copy">{current.question.text}</p>
      {current.question.evidence && <blockquote><cite>{current.question.evidence.origin === 'source' ? '추출 원문' : current.question.evidence.origin === 'reviewed' ? '원문과 다를 수 있는 수정 내용' : '내가 입력한 답변'} · {current.question.evidence.location}</cite><p>{current.question.evidence.text}</p></blockquote>}
      <label htmlFor="interview-answer">내 답변</label><textarea id="interview-answer" value={answer} maxLength={INTERVIEW_LIMITS.answerChars} disabled={saving} onChange={(event) => setAnswer(event.target.value)} />
      <div className="answer-actions"><span className="hint">{answer.length.toLocaleString()} / 10,000자</span><button className="primary" disabled={saving || !answer.trim()} onClick={() => void submit()}>{saving ? '저장 중…' : current.question.number === INTERVIEW_LIMITS.turns ? '답변 저장하고 완료' : '답변 저장하고 다음 질문'}</button></div>
      {saving && <><button className="secondary" disabled={cancelling} onClick={() => void cancel()}>{cancelling ? '취소 요청 중…' : '질문 생성 취소'}</button><p className="hint">이미 완료된 저장은 취소되지 않습니다.</p></>}
      <p className="hint">저장한 답변은 기록에 남습니다. 아직 제출하지 않은 입력은 화면을 벗어나면 사라집니다.</p>
    </article> : <div className="settings-card" role="status"><h2>이번 연습을 완료했습니다</h2><p>질문과 답변은 이 PC에 저장되어 다시 읽을 수 있습니다. AI 점수나 평가는 생성하지 않았습니다.</p></div>}
    <details className="transcript"><summary>저장된 질문·답변 ({answered}개)</summary>{session.turns.filter((turn) => turn.answer !== null).map((turn) => <article key={turn.question.id}><h3>{turn.question.number}. {turn.question.text}</h3>{turn.question.evidence && <blockquote><cite>{turn.question.evidence.location}</cite><p>{turn.question.evidence.text}</p></blockquote>}<p className="saved-answer">{turn.answer}</p></article>)}</details>
    <details className="transcript"><summary>이 세션에 저장된 이력서 검토 내용</summary><p className="saved-answer">{session.reviewedText}</p></details>
  </section>;
}

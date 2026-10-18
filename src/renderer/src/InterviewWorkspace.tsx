import { useEffect, useRef, useState } from 'react';
import type { InterviewSession } from '../../shared/interview';
import { INTERVIEW_LIMITS } from '../../shared/interview';
import { AI_NAMES } from '../../shared/ai';
import { AIKeySettings } from './AIOptions';
import { InterviewAudio } from './InterviewAudio';

export function InterviewWorkspace({ session, onUpdate, onHistory }: {
  session: InterviewSession; onUpdate: (session: InterviewSession) => void; onHistory: () => void;
}) {
  const [answer, setAnswer] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [transmissionConsent, setTransmissionConsent] = useState(false);
  const [needsKey, setNeedsKey] = useState(false);
  const [notice, setNotice] = useState('');
  const [audioBusy, setAudioBusy] = useState(false);
  const answerInput = useRef<HTMLTextAreaElement>(null);
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
    if (!current || lock.current || audioBusy || !answer.trim() || (session.ai && !transmissionConsent)) return;
    lock.current = true; pendingId.current = current.question.id; setSaving(true); setError(''); setNotice('');
    try {
      const result = await window.studio!.submitInterviewAnswer({ sessionId: session.id, questionId: current.question.id, answer, ...(session.ai ? { transmissionConsent: true } : {}) });
      // A save that completed just before navigation still updates the parent
      // snapshot, so returning to the session cannot show the old question.
      if (result.ok) { onUpdate(result.value); if (live.current) { setAnswer(''); setTransmissionConsent(false); } }
      else if (live.current) { setError(result.error.message); setNeedsKey(result.error.code === 'AUTHENTICATION'); }
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
    <p className="eyebrow">{session.ai ? 'EXTERNAL AI INTERVIEW' : 'LOCAL PRACTICE'}</p><h1 id="interview-title">백엔드 면접 연습</h1>
    <p className="muted">{session.ai ? `${AI_NAMES[session.ai.provider]} · ${session.ai.model}에서 생성한 질문입니다. AI 문장은 사실 검증·채용 평가가 아닙니다. 답변 제출 때 전송 범위와 비용을 확인하세요. 재시작 후 키가 없거나 인증에 실패하면 이 화면에서 키를 다시 등록할 수 있습니다.` : '기본 질문은 준비된 질문과 답변 인용이며 AI 분석·평가가 아닙니다. 별도로 선택하는 음성 입력·읽기는 OpenAI 전송과 비용이 발생할 수 있습니다.'}</p>
    <div className="session-progress"><span>{answered} / {INTERVIEW_LIMITS.turns}개 답변 저장</span><button className="secondary" disabled={saving} onClick={onHistory}>저장된 기록 보기</button></div>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {needsKey && session.ai && <section aria-label="답변을 유지하며 API 키 재등록"><p>이 세션의 서비스는 {AI_NAMES[session.ai.provider]}입니다. 키를 다시 등록해도 답변을 자동 전송하지 않습니다.</p><AIKeySettings disabled={saving} fixedProvider={session.ai.provider} onConfigured={() => { setNeedsKey(false); setError(''); setNotice('키를 등록했습니다. 입력한 답변과 전송 범위를 확인하고 직접 다시 제출해 주세요.'); }} /></section>}
    {current ? <article className="question-card" aria-labelledby="current-question-title">
      <span className="tag">{current.question.kind === 'technical' ? '일반 기술 질문' : current.question.kind === 'follow-up' ? '내 답변에 대한 후속 질문' : current.question.evidence ? '이력서 관련 질문' : '일반 경험 질문'}</span>
      <h2 id="current-question-title">질문 {current.question.number}</h2><p className="question-copy">{current.question.text}</p>
      {current.question.evidence && <blockquote><cite>{current.question.evidence.origin === 'source' ? '추출 원문' : current.question.evidence.origin === 'reviewed' ? '원문과 다를 수 있는 수정 내용' : '내가 입력한 답변'} · {current.question.evidence.location}</cite><p>{current.question.evidence.text}</p></blockquote>}
      {!saving && <InterviewAudio key={current.question.id} sessionId={session.id} questionId={current.question.id} question={current.question.text} answer={answer} answerLimit={session.ai ? 2_000 : INTERVIEW_LIMITS.answerChars}
        onBusy={setAudioBusy} onApply={text => { setAnswer(text); setTransmissionConsent(false); }} onReviewAnswer={() => answerInput.current?.focus()} />}
      <label htmlFor="interview-answer">내 답변</label><textarea ref={answerInput} id="interview-answer" value={answer} maxLength={session.ai ? 2_000 : INTERVIEW_LIMITS.answerChars} disabled={saving} onChange={(event) => { setAnswer(event.target.value); setTransmissionConsent(false); }} />
      {session.ai && <div className="transmission-preview"><h3>다음 요청 전송 미리보기</h3><p>{AI_NAMES[session.ai.provider]} · {session.ai.model}</p><pre>{current.question.number === 12 ? '외부 요청 없음. 마지막 답변을 이 PC에만 저장합니다.' : current.question.number % 2 === 1 ? answer || '직전 답변을 입력하세요.' : '개인 문맥 없이 질문 번호와 일반 기술 질문 생성 지시만 전송합니다.'}</pre><p>후속 질문에는 위 답변·처음 180자의 근거 인용·질문 번호·생성 지시만 보냅니다. 이력서 전체와 이전 대화는 보내지 않습니다. 요청당 최대 600토큰·30초, 자동 재시도 없음. 취소 전에 발생한 요금·전송은 되돌리지 못하며 서비스 보존 정책이 적용됩니다.</p><label className="consent"><input type="checkbox" checked={transmissionConsent} disabled={saving} onChange={e => setTransmissionConsent(e.target.checked)} /> 위 전송 범위·비용 가능성을 확인했습니다. (마지막 답변은 로컬 저장만)</label></div>}
      <div className="answer-actions"><span className="hint">{answer.length.toLocaleString()} / {session.ai ? '2,000' : '10,000'}자</span><button className="primary" disabled={saving || audioBusy || !answer.trim() || (!!session.ai && !transmissionConsent)} onClick={() => void submit()}>{saving ? '저장 중…' : current.question.number === INTERVIEW_LIMITS.turns ? '답변 저장하고 완료' : '답변 저장하고 다음 질문'}</button></div>
      {saving && <><button className="secondary" disabled={cancelling} onClick={() => void cancel()}>{cancelling ? '취소 요청 중…' : '질문 생성 취소'}</button><p className="hint">이미 완료된 저장은 취소되지 않습니다.</p></>}
      <p className="hint">저장한 답변은 기록에 남습니다. 아직 제출하지 않은 입력은 화면을 벗어나면 사라집니다.</p>
    </article> : <div className="settings-card" role="status"><h2>이번 연습을 완료했습니다</h2><p>질문과 답변은 이 PC에 저장되어 다시 읽을 수 있습니다. AI 점수나 평가는 생성하지 않았습니다.</p></div>}
    <details className="transcript"><summary>저장된 질문·답변 ({answered}개)</summary>{session.turns.filter((turn) => turn.answer !== null).map((turn) => <article key={turn.question.id}><h3>{turn.question.number}. {turn.question.text}</h3>{turn.question.evidence && <blockquote><cite>{turn.question.evidence.location}</cite><p>{turn.question.evidence.text}</p></blockquote>}<p className="saved-answer">{turn.answer}</p></article>)}</details>
    <details className="transcript"><summary>이 세션에 저장된 이력서 검토 내용</summary><p className="saved-answer">{session.reviewedText}</p></details>
  </section>;
}

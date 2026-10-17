import { useEffect, useRef, useState } from 'react';
import { RESUME_LIMITS, ResumeError, type ExtractedResume } from '../../shared/resume';
import { parseResume } from './resume/parse';
import type { InterviewSession } from '../../shared/interview';

export function ResumeReview({ onStart }: { onStart: (session: InterviewSession) => void }) {
  const [resume, setResume] = useState<ExtractedResume>();
  const [name, setName] = useState('');
  const [draft, setDraft] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [storageConsent, setStorageConsent] = useState(false);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const startId = useRef<string | undefined>(undefined);
  const startLock = useRef(false);
  const live = useRef(true);
  const active = useRef<AbortController | null>(null);
  useEffect(() => { live.current = true; return () => {
    live.current = false; active.current?.abort();
    if (startLock.current && startId.current) void window.studio?.cancelInterviewOperation(startId.current).catch(() => {});
  }; }, []);

  async function select() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setError(''); setNotice('');
    try {
      if (!window.studio) throw new Error('Desktop unavailable');
      const result = await window.studio.selectResume();
      if (controller.signal.aborted) return;
      if (!result.ok) { setError(result.error.message); return; }
      if (!result.value) { setNotice('파일 선택을 취소했습니다.'); return; }
      const fileName = result.value.name;
      const extracted = await parseResume(result.value, controller.signal);
      if (controller.signal.aborted) return;
      setResume(extracted); setName(fileName);
      setDraft(extracted.sections.map((section) => section.text).join('\n\n'));
      setConfirmed(false);
      setStorageConsent(false); startId.current = undefined;
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof ResumeError ? cause.message : '문서를 처리하지 못했습니다. 다시 선택해 주세요.');
    } finally {
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }
  function clear() {
    active.current?.abort(); active.current = null;
    setBusy(false); setResume(undefined); setDraft(''); setName(''); setConfirmed(false); setError(''); setNotice('불러온 내용을 비웠습니다. 원본 파일은 변경되지 않습니다.');
    setStorageConsent(false); startId.current = undefined;
  }
  async function startPractice() {
    if (!resume || !confirmed || !storageConsent || startLock.current) return;
    startLock.current = true; setStarting(true); setError('');
    try {
      const result = await window.studio!.startInterview({ requestId: startId.current ??= crypto.randomUUID(), reviewedText: draft, sourceSections: resume.sections, storageConsent: true });
      if (!live.current) return;
      if (result.ok) onStart(result.value);
      else setError(result.error.message);
    } catch { if (live.current) setError('연습을 시작하지 못했습니다. 검토 내용은 유지됩니다. 다시 시도해 주세요.'); }
    finally { startLock.current = false; if (live.current) { setStarting(false); setCancelling(false); } }
  }
  async function cancelStart() {
    if (!startLock.current || !startId.current || cancelling) return;
    setCancelling(true);
    try { const result = await window.studio!.cancelInterviewOperation(startId.current); if (live.current && !result.ok) setError(result.error.message); }
    catch { if (live.current) setError('취소 요청을 전달하지 못했습니다. 처리 결과를 확인해 주세요.'); }
    finally { if (live.current) setCancelling(false); }
  }

  return <section className="resume-review" aria-labelledby="resume-title">
    <p className="eyebrow">YOUR EXPERIENCE</p><h1 id="resume-title">이력서 검토</h1>
    <p className="muted">PDF 또는 DOCX에서 텍스트를 불러오고 원문과 비교해 확인하세요.<br />검토 중에는 저장하지 않습니다. 연습을 시작하면 동의한 내용이 이 PC에 저장됩니다. 외부 전송은 없습니다.</p>
    <div className="resume-actions"><button className="primary" disabled={busy || starting} onClick={() => void select()}>{busy ? '문서를 읽는 중…' : resume ? '다른 문서 선택' : '이력서 불러오기'}</button>{(resume || busy) && <button className="secondary" disabled={starting} onClick={clear}>{busy ? '처리 취소·비우기' : '내용 비우기'}</button>}</div>
    <p className="hint">파일 10MB · PDF 50페이지 · 텍스트 10만 자 · DOCX 압축 해제 30MB · 처리 15초. 스캔 PDF는 OCR이 필요합니다.</p>
    {busy && <p role="status">파일 선택 또는 텍스트 추출 중입니다. 취소할 수 있습니다.</p>}
    {error && <p className="error" role="alert">{error}{resume && ' 기존 검토 내용은 유지됩니다.'}</p>}
    {notice && <p role="status">{notice}</p>}
    {!resume && !busy && <div className="settings-card"><h2>아직 불러온 이력서가 없습니다</h2><p className="muted">사용자가 선택한 문서만 읽습니다. 앱 종료나 이 화면을 벗어나면 검토 내용이 사라집니다.</p></div>}
    {resume && <>
      <h2 className="resume-name">{name}</h2>
      <div className="resume-warnings">{resume.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>
      <div className="resume-columns">
        <section className="source-panel" aria-labelledby="source-title"><h2 id="source-title">추출 원문과 근거 위치</h2><p className="hint">위치는 원본 문서 기준입니다. 오른쪽 수정본의 내용을 증명하지는 않습니다.</p><div className="source-text">{resume.sections.map((section) => <article key={section.location}><h3>{section.location}</h3><p>{section.text}</p></article>)}</div></section>
        <section className="edit-panel" aria-labelledby="edit-title"><h2 id="edit-title">내가 확인한 내용</h2><label htmlFor="resume-draft">누락·읽기 순서를 원본과 비교하고 수정하세요.</label><textarea id="resume-draft" value={draft} maxLength={RESUME_LIMITS.textChars} disabled={starting} onChange={(event) => { setDraft(event.target.value); setConfirmed(false); setStorageConsent(false); startId.current = undefined; }} /><p className="hint">{draft.length.toLocaleString()} / 100,000자 · 수정 시 확인 상태가 해제됩니다.</p><button className="primary" disabled={!draft.trim() || busy || confirmed || starting} onClick={() => setConfirmed(true)}>검토 완료</button>{confirmed && <p role="status">검토를 완료했습니다. 이 내용은 저장·전송되지 않았습니다.</p>}</section>
      </div>
    </>}
    {resume && confirmed && <div className="practice-start"><h2>로컬 텍스트 연습 시작</h2><p>이력서 추출 원문·수정본과 이후 질문·답변을 암호화되지 않은 로컬 SQLite 파일에 저장합니다. 앱을 꺼도 유지되며 면접 기록에서 삭제할 수 있습니다. AI 분석·외부 전송·과금은 없습니다.</p><label className="consent"><input type="checkbox" checked={storageConsent} disabled={starting} onChange={(event) => setStorageConsent(event.target.checked)} /> 이력서 검토 내용과 면접 기록의 로컬 저장에 동의합니다.</label><button className="primary" disabled={starting || !storageConsent || busy} onClick={() => void startPractice()}>{starting ? '연습 준비 중…' : '이 내용으로 연습 시작'}</button></div>}
    {starting && <><button className="secondary" disabled={cancelling} onClick={() => void cancelStart()}>{cancelling ? '취소 요청 중…' : '연습 준비 취소'}</button><p className="hint">이미 완료된 저장은 취소되지 않습니다.</p></>}
    <p className="privacy-note">이력서 원본을 변경하지 않습니다. 문서의 지시문·링크는 실행하지 않습니다. 실제 AI 연결은 별도 동의 후 제공될 예정입니다.</p>
  </section>;
}

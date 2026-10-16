import { useEffect, useRef, useState } from 'react';
import { RESUME_LIMITS, ResumeError, type ExtractedResume } from '../../shared/resume';
import { parseResume } from './resume/parse';

export function ResumeReview() {
  const [resume, setResume] = useState<ExtractedResume>();
  const [name, setName] = useState('');
  const [draft, setDraft] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); }, []);

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
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof ResumeError ? cause.message : '문서를 처리하지 못했습니다. 다시 선택해 주세요.');
    } finally {
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }
  function clear() {
    active.current?.abort(); active.current = null;
    setBusy(false); setResume(undefined); setDraft(''); setName(''); setConfirmed(false); setError(''); setNotice('불러온 내용을 비웠습니다. 원본 파일은 변경되지 않습니다.');
  }

  return <section className="resume-review" aria-labelledby="resume-title">
    <p className="eyebrow">YOUR EXPERIENCE</p><h1 id="resume-title">이력서 검토</h1>
    <p className="muted">PDF 또는 DOCX에서 텍스트를 불러오고 원문과 비교해 확인하세요.<br />외부 전송·자동 저장 없이 이 화면에서만 검토합니다.</p>
    <div className="resume-actions"><button className="primary" disabled={busy} onClick={() => void select()}>{busy ? '문서를 읽는 중…' : resume ? '다른 문서 선택' : '이력서 불러오기'}</button>{(resume || busy) && <button className="secondary" onClick={clear}>{busy ? '처리 취소·비우기' : '내용 비우기'}</button>}</div>
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
        <section className="edit-panel" aria-labelledby="edit-title"><h2 id="edit-title">내가 확인한 내용</h2><label htmlFor="resume-draft">누락·읽기 순서를 원본과 비교하고 수정하세요.</label><textarea id="resume-draft" value={draft} maxLength={RESUME_LIMITS.textChars} onChange={(event) => { setDraft(event.target.value); setConfirmed(false); }} /><p className="hint">{draft.length.toLocaleString()} / 100,000자 · 수정 시 확인 상태가 해제됩니다.</p><button className="primary" disabled={!draft.trim() || busy || confirmed} onClick={() => setConfirmed(true)}>검토 완료</button>{confirmed && <p role="status">검토를 완료했습니다. 이 내용은 저장·전송되지 않았습니다.</p>}</section>
      </div>
    </>}
    <p className="privacy-note">이력서 원본을 변경하지 않습니다. 문서의 지시문·링크는 실행하지 않습니다. 텍스트 면접과 기록 저장은 다음 단계에서 제공됩니다.</p>
  </section>;
}

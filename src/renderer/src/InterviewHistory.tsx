import { useEffect, useRef, useState } from 'react';
import type { InterviewHistory as History, InterviewSession } from '../../shared/interview';

export function InterviewHistory({ onOpen, onDeleted }: { onOpen: (session: InterviewSession) => void; onDeleted: (sessionIds: string[]) => void }) {
  const [history, setHistory] = useState<History>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deleting, setDeleting] = useState<string | 'all'>();
  const lock = useRef(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; void refresh(); return () => { live.current = false; }; }, []);
  async function refresh() {
    setBusy(true); setError('');
    try {
      const result = await window.studio!.getInterviewHistory();
      if (live.current) { if (result.ok) setHistory(result.value); else setError(result.error.message); }
    } catch { if (live.current) setError('기록을 불러오지 못했습니다. 다시 시도해 주세요.'); }
    finally { if (live.current) setBusy(false); }
  }
  async function open(id: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await window.studio!.getInterview(id);
      if (live.current) { if (result.ok) onOpen(result.value); else setError(result.error.message); }
    } catch { if (live.current) setError('선택한 기록을 열지 못했습니다. 다시 시도해 주세요.'); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  }
  async function remove() {
    if (!deleting || lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    const target = deleting;
    try {
      const result = target === 'all'
        ? await window.studio!.deleteAllInterviews({ confirm: 'DELETE_ALL_INTERVIEWS' })
        : await window.studio!.deleteInterview({ sessionId: target, confirm: true });
      if (!result.ok) { if (live.current) setError(result.error.message); return; }
      onDeleted(target === 'all' ? history?.sessions.map((session) => session.id) ?? [] : [target]);
      if (live.current) { setDeleting(undefined); setNotice(target === 'all' ? '모든 면접 기록을 삭제했습니다.' : '선택한 면접 기록을 삭제했습니다.'); await refresh(); }
    } catch { if (live.current) setError('삭제하지 못했습니다. 다시 시도해 주세요.'); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  }
  return <section className="interview-history" aria-labelledby="history-title">
    <p className="eyebrow">MY PRACTICE</p><h1 id="history-title">면접 기록</h1>
    <p className="muted">중단한 연습을 이어가거나 저장한 답변을 다시 읽을 수 있습니다. 이력서 검토 내용과 답변은 이 PC의 암호화되지 않은 로컬 파일에 저장됩니다.</p>
    <div className="history-actions"><button className="secondary" disabled={busy} onClick={() => void refresh()}>새로 고침</button><button className="secondary danger" disabled={busy || !history?.sessions.length} onClick={() => setDeleting('all')}>전체 기록 삭제</button></div>
    {busy && <p role="status">기록을 처리하는 중입니다.</p>}
    {error && <div className="error" role="alert">{error} <button disabled={busy} onClick={() => void refresh()}>다시 시도</button></div>}
    {notice && <p role="status">{notice}</p>}
    {deleting && <div className="delete-confirm" role="group" aria-label="기록 삭제 확인"><h2>{deleting === 'all' ? '모든 면접 기록을 삭제할까요?' : '선택한 면접 기록을 삭제할까요?'}</h2><p>저장한 이력서 검토 내용과 질문·답변을 함께 지우며 앱에서 되돌릴 수 없습니다. 원본 문서는 삭제하지 않습니다.</p><button className="secondary" disabled={busy} onClick={() => setDeleting(undefined)}>취소</button><button className="secondary danger" disabled={busy} onClick={() => void remove()}>삭제 확인</button></div>}
    {history && !history.sessions.length && !busy && <div className="settings-card"><h2>저장된 면접 기록이 없습니다</h2><p className="muted">이력서를 검토한 뒤 로컬 저장에 동의하고 연습을 시작해 보세요.</p></div>}
    <div className="history-list">{history?.sessions.map((session) => <article key={session.id}><div><span className="tag">{session.status === 'active' ? '진행 중' : '완료'}</span><h2>{new Date(session.createdAt).toLocaleString('ko-KR')} 연습</h2><p className="hint">{session.mode === 'external-ai' ? '외부 AI' : '로컬 연습'} · 답변 {session.answered}개</p></div><div className="history-row-actions"><button className="primary" disabled={busy} onClick={() => void open(session.id)}>{session.status === 'active' ? '이어하기' : '기록 열기'}</button><button className="secondary" disabled={busy} onClick={() => setDeleting(session.id)}>이 기록 삭제</button></div></article>)}</div>
    {history && <details className="storage-location"><summary>저장 위치와 보존·삭제 안내</summary><p>최대 {history.limit}개 세션을 보관하며 자동 업로드·자동 삭제하지 않습니다. 공유 PC에서는 다른 계정/사용자의 파일 접근에 주의하세요.</p><code>{history.storagePath}</code><p>앱에서 삭제해도 사용자가 만든 백업이나 OS의 복사본까지 지우는 것은 아닙니다.</p></details>}
  </section>;
}

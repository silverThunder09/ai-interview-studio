import { useCallback, useEffect, useRef, useState } from 'react';
import { THEMES, type Snapshot, type Theme } from '../../shared/contracts';
import { ResumeReview } from './ResumeReview';
import { InterviewWorkspace } from './InterviewWorkspace';
import { InterviewHistory } from './InterviewHistory';
import type { AIProvider } from '../../shared/ai';
import type { InterviewSession } from '../../shared/interview';
import { APISettings, ConnectionContext } from './AIOptions';

const themeNames: Record<Theme, string> = { system: '시스템', light: '라이트', dark: '다크' };


export function App() {
  const [page, setPage] = useState<'home' | 'resume' | 'interview' | 'history'>('home');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsProvider, setSettingsProvider] = useState<AIProvider>();
  const [revision, setRevision] = useState(0);
  const openSettings = useCallback((provider?: AIProvider) => { setSettingsProvider(provider); setSettingsOpen(true); }, []);
  const changed = useCallback(() => setRevision(value => value + 1), []);
  const [activeSession, setActiveSession] = useState<InterviewSession>();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError('');
    try {
      if (!window.studio) throw new Error('desktop unavailable');
      const result = await window.studio.getSnapshot();
      if (result.ok) setSnapshot(result.value);
      else setError(result.error.message);
    } catch { setError('앱 정보를 불러오지 못했습니다. 다시 시도해 주세요.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = snapshot?.settings.theme ?? 'system';
  }, [snapshot?.settings.theme]);

  async function changeTheme(theme: Theme) {
    if (!snapshot || !window.studio) return;
    setSaving(true);
    setError('');
    try {
      const result = await window.studio.updateSettings({ ...snapshot.settings, theme });
      if (result.ok) setSnapshot({ ...snapshot, settings: result.value });
      else setError(result.error.message);
    } catch { setError('설정을 변경하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setSaving(false); }
  }
  function openSession(session: InterviewSession) { setActiveSession(session); setPage('interview'); }

  return <ConnectionContext.Provider value={{ revision, settingsOpen, open: openSettings, changed }}><div className="app">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={(e) => { e.preventDefault(); setPage('home'); }}>
        <span className="brand-mark"><NavIcon name="practice" /></span>
        <span>Interview<br /><strong>Studio</strong></span>
      </a>
      <p className="nav-caption">나의 워크스페이스</p>
      <nav aria-label="주 메뉴">
        <button className={page === 'home' ? 'nav active' : 'nav'} aria-current={page === 'home' ? 'page' : undefined} onClick={() => setPage('home')}><NavIcon name="home" /> 시작하기</button>
        <button className={page === 'resume' ? 'nav active' : 'nav'} aria-current={page === 'resume' ? 'page' : undefined} onClick={() => setPage('resume')}><NavIcon name="document" /> 이력서</button>
        {activeSession && <button className={page === 'interview' ? 'nav active' : 'nav'} aria-current={page === 'interview' ? 'page' : undefined} onClick={() => setPage('interview')}><NavIcon name="practice" /> 현재 연습</button>}
        <button className={page === 'history' ? 'nav active' : 'nav'} aria-current={page === 'history' ? 'page' : undefined} onClick={() => setPage('history')}><NavIcon name="history" /> 면접 기록</button>
        <button id="workspace-settings" className={settingsOpen ? 'nav active' : 'nav'} onClick={() => openSettings()}><NavIcon name="settings" /> 설정</button>
      </nav>
      <div className="sidebar-footer"><span className="sidebar-note">나의 경험을,<br />나의 언어로.</span><p>개인 워크스페이스</p><p>MVP 1 · {snapshot ? `v${snapshot.version}` : '준비 중'}</p></div>
    </aside>
    <main>
      <header><span>워크스페이스 <span aria-hidden="true">/</span> <strong>{page === 'home' ? '대시보드' : page === 'resume' ? '이력서' : page === 'history' ? '면접 기록' : '면접 연습'}</strong></span><button className="secondary header-settings" onClick={() => openSettings()}><NavIcon name="settings" /> API 설정</button></header>
      {loading && <p role="status">앱 정보를 불러오는 중입니다.</p>}
      {error && <div className="error" role="alert">{error} <button onClick={() => void load()}>다시 시도</button></div>}
      {page === 'resume' ? <ResumeReview onStart={openSession} /> : page === 'history' ? <InterviewHistory onOpen={openSession} onDeleted={(ids) => setActiveSession((session) => session && !ids.includes(session.id) ? session : undefined)} /> : page === 'interview' && activeSession ? <InterviewWorkspace key={activeSession.id} session={activeSession} onUpdate={(updated) => setActiveSession((session) => session?.id === updated.id ? updated : session)} onHistory={() => setPage('history')} /> : page === 'home' ? <>
        <section className="intro"><p className="eyebrow">나를 위한 면접 연습실</p><h1>좋은 면접은,<br /><span>나의 경험</span>에서 시작됩니다.</h1><p className="muted">경험을 정리하고, 나만의 답변을 만들어 보세요.<br />작은 연습이 다음 기회를 준비합니다.</p></section>
        <section className="hero-card" aria-labelledby="start-title"><div className="hero-copy"><span className="tag">백엔드 개발자 · 텍스트 면접</span><h2 id="start-title">오늘의 연습을 시작할까요?</h2><p>Java · Spring · 데이터베이스 · API · 아키텍처</p><button className="primary" onClick={() => setPage('resume')}>면접 시작하기 <span aria-hidden="true">↗</span></button><p className="hint">기본 연습은 API 키 없이 시작할 수 있습니다.<br />외부 AI는 키 등록·전송 동의 후 선택합니다.</p></div><div className="practice-visual" aria-hidden="true"><div className="visual-caption">PRACTICE, AT YOUR PACE <span>↗</span></div><div className="visual-sheet"><span className="visual-index">01 / PREPARE</span><p>경험에서 꺼낸 이야기,<br /><strong>나만의 답변으로.</strong></p><div className="visual-lines"><i /><i /><i /></div><div className="visual-cycle"><span>질문</span><b>→</b><span>생각</span><b>→</b><span>내 답변</span></div></div></div></section>
        <div className="section-heading"><h2>나의 면접 루틴</h2><span>준비부터 돌아보기까지</span></div>
        <section className="workspace-grid" aria-label="면접 준비 순서">
          <article className="workspace-card"><span className="step">01 · 준비</span><h3>경험을 정리하세요</h3><p>PDF·DOCX를 불러와 면접에 쓸 내용을 확인합니다.</p><button className="text-button" onClick={() => setPage('resume')}>이력서 검토 →</button></article>
          <article className="workspace-card"><span className="step">02 · 연결</span><h3>나의 AI를 선택하세요</h3><p>서비스·모델과 API 키를 설정에서 한 번에 관리합니다.</p><button className="text-button" onClick={() => openSettings()}>AI 연결 관리 →</button></article>
          <article className="workspace-card"><span className="step">03 · 돌아보기</span><h3>이전 답변을 이어가세요</h3><p>이 PC에 저장한 연습 기록을 확인하고 다시 시작합니다.</p><button className="text-button" onClick={() => setPage('history')}>면접 기록 보기 →</button></article>
        </section>
        <p className="privacy-note"><NavIcon name="shield" /> <span>동의 후 연습을 시작하면 이력서 검토 내용과 답변이 이 PC에 저장됩니다. 외부 AI는 선택한 내용만 동의 후 전송합니다. 음성 입력은 별도 마이크·전송 동의 후 사용할 수 있습니다.</span></p>
      </> : null}
      <footer>AI Interview Studio <span>작은 연습이 만드는, 다음 기회.</span></footer>
    </main>
  </div>
    {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)}>
      <p className="eyebrow">SETTINGS</p><h1>설정</h1><p className="muted">테마·서비스·모델은 이 PC에 보관하고 다음 실행에서 복원합니다.</p>
      <APISettings {...(settingsProvider ? { fixedProvider: settingsProvider } : {})} />
      <section className="settings-card"><h2>화면 테마</h2><div className="theme-options" role="group" aria-label="화면 테마">{THEMES.map(theme => <button key={theme} aria-pressed={snapshot?.settings.theme === theme} disabled={!snapshot || saving} onClick={() => void changeTheme(theme)}>{themeNames[theme]}</button>)}</div><p className="hint">한국어 · 백엔드 개발자 · 로컬 연습 및 외부 AI 면접</p>{error && <p className="error" role="alert">{error}</p>}</section>
    </SettingsDialog>}
  </ConnectionContext.Provider>;
}

function NavIcon({ name }: { name: 'home' | 'document' | 'practice' | 'history' | 'settings' | 'shield' }) {
  const paths = {
    home: 'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
    document: 'M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8M8 16h6',
    practice: 'M4 4h16v12H9l-5 4V4Zm4 4h8M8 12h5',
    history: 'M3 11a9 9 0 1 1 2 7M3 4v7h7m2-4v5l3 2',
    settings: 'M9 3h6l1 4 4 1v8l-4 1-1 4H9l-1-4-4-1V8l4-1 1-4Zm6 9a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z',
    shield: 'm12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6l8-3Zm-4 9 3 3 5-6',
  };
  return <svg className="nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}

function SettingsDialog({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = dialog.current!, previous = document.activeElement; node.showModal(); return () => { node.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); else document.getElementById('workspace-settings')?.focus(); }; }, []);
  return <dialog ref={dialog} className="settings-dialog" aria-label="앱 설정" onCancel={onClose}>
    <div className="dialog-toolbar"><span>개인 워크스페이스</span><button className="secondary" autoFocus onClick={onClose}>설정 닫기</button></div>
    <div className="settings-content">{children}</div>
  </dialog>;
}

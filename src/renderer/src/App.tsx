import { useEffect, useState } from 'react';
import { THEMES, type Snapshot, type Theme } from '../../shared/contracts';
import { ResumeReview } from './ResumeReview';
import { InterviewWorkspace } from './InterviewWorkspace';
import { InterviewHistory } from './InterviewHistory';
import type { InterviewSession } from '../../shared/interview';

const themeNames: Record<Theme, string> = { system: '시스템', light: '라이트', dark: '다크' };
const roadmap = [
  ['01', '이력서와 텍스트 면접', '이력서 근거로 시작하는 백엔드 기술 면접'],
  ['02', '실시간 음성 면접', '말하고, 듣고, 이어지는 대화'],
  ['03', '카메라와 아바타', '선택해서 사용하는 면접 환경'],
  ['04', '피드백과 기록', '답변을 돌아보고 다음 면접 준비하기'],
];

export function App() {
  const [page, setPage] = useState<'home' | 'settings' | 'resume' | 'interview' | 'history'>('home');
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

  return <div className="app">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={(e) => { e.preventDefault(); setPage('home'); }}>
        <span className="brand-mark" aria-hidden="true">ai</span>
        <span>Interview<br /><strong>Studio</strong></span>
      </a>
      <p className="nav-caption">MY WORKSPACE</p>
      <nav aria-label="주 메뉴">
        <button className={page === 'home' ? 'nav active' : 'nav'} aria-current={page === 'home' ? 'page' : undefined} onClick={() => setPage('home')}><span aria-hidden="true">⌂</span> 시작하기</button>
        <button className={page === 'resume' ? 'nav active' : 'nav'} aria-current={page === 'resume' ? 'page' : undefined} onClick={() => setPage('resume')}><span aria-hidden="true">▤</span> 이력서</button>
        {activeSession && <button className={page === 'interview' ? 'nav active' : 'nav'} aria-current={page === 'interview' ? 'page' : undefined} onClick={() => setPage('interview')}><span aria-hidden="true">◉</span> 현재 연습</button>}
        <button className={page === 'history' ? 'nav active' : 'nav'} aria-current={page === 'history' ? 'page' : undefined} onClick={() => setPage('history')}><span aria-hidden="true">◷</span> 면접 기록</button>
        <button className={page === 'settings' ? 'nav active' : 'nav'} aria-current={page === 'settings' ? 'page' : undefined} onClick={() => setPage('settings')}><span aria-hidden="true">⚙</span> 설정</button>
      </nav>
      <div className="sidebar-footer"><span className="status-dot" /> 개인 워크스페이스<p>MVP 1 · {snapshot ? `v${snapshot.version}` : '준비 중'}</p></div>
    </aside>
    <main>
      <header><span>나의 면접 준비 공간</span><span className="badge">개발 프리뷰</span></header>
      {loading && <p role="status">앱 정보를 불러오는 중입니다.</p>}
      {error && <div className="error" role="alert">{error} <button onClick={() => void load()}>다시 시도</button></div>}
      {page === 'resume' ? <ResumeReview onStart={openSession} /> : page === 'history' ? <InterviewHistory onOpen={openSession} onDeleted={(ids) => setActiveSession((session) => session && !ids.includes(session.id) ? session : undefined)} /> : page === 'interview' && activeSession ? <InterviewWorkspace key={activeSession.id} session={activeSession} onUpdate={setActiveSession} onHistory={() => setPage('history')} /> : page === 'home' ? <>
        <section className="intro"><p className="eyebrow">YOUR NEXT CHAPTER</p><h1>좋은 면접은,<br />나의 경험에서 시작됩니다.</h1><p className="muted">이력서 속 경험을 정리하고, 질문에 답하며 성장하는 시간.<br />나만의 AI 면접 스튜디오를 준비하고 있어요.</p></section>
        <section className="hero-card" aria-labelledby="start-title"><div><span className="tag">BACKEND INTERVIEW</span><h2 id="start-title">차근차근, 면접 준비</h2><p>Java · Spring · 데이터베이스 · API · 아키텍처</p><button className="primary" onClick={() => setPage('resume')}>면접 시작하기 <span aria-hidden="true">↗</span></button><p className="hint">이력서를 검토하고 로컬 텍스트 연습을 시작하세요. 실제 AI는 아직 연결되지 않았습니다.</p></div><div className="interview-art" aria-hidden="true"><div className="orb">ai<span>INTERVIEW STUDIO</span></div><div className="art-label">나의 경험을, 나의 언어로.</div></div></section>
        <section className="roadmap" aria-labelledby="roadmap-title"><div className="section-heading"><h2 id="roadmap-title">앞으로 함께할 기능</h2><span>개발 예정</span></div><div className="roadmap-grid">{roadmap.map(([number, title, copy]) => <article className="roadmap-card" key={number}><span className="step">MVP {number}</span><h3>{title}</h3><p>{copy}</p></article>)}</div></section>
        <button className="primary" onClick={() => setPage('resume')}>이력서 먼저 검토하기</button>
        <p className="privacy-note"><span aria-hidden="true">◇</span> 동의 후 연습을 시작하면 이력서 검토 내용과 답변이 이 PC에 저장됩니다. 외부 AI 전송·마이크·카메라 기능은 아직 제공되지 않습니다.</p>
      </> : <section className="settings"><p className="eyebrow">PREFERENCES</p><h1>나에게 맞는 환경</h1><p className="muted">현재 설정은 앱을 종료하면 기본값으로 돌아갑니다.</p><div className="settings-card"><h2>화면 테마</h2><div className="theme-options" role="group" aria-label="화면 테마">{THEMES.map((theme) => <button key={theme} aria-pressed={snapshot?.settings.theme === theme} disabled={!snapshot || saving} onClick={() => void changeTheme(theme)}>{themeNames[theme]}</button>)}</div><dl><div><dt>언어</dt><dd>한국어</dd></div><div><dt>면접 직무</dt><dd>백엔드 개발자</dd></div><div><dt>개발 단계</dt><dd>MVP 1 · 로컬 텍스트 연습·기록</dd></div></dl></div><p className="privacy-note">외부 AI 서비스 연결과 API 키 입력은 다음 개발 단계에서 안내합니다.</p></section>}
      <footer>AI Interview Studio <span>작은 연습이 만드는, 다음 기회.</span></footer>
    </main>
  </div>;
}

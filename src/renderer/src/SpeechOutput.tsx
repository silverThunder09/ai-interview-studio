import { useEffect, useRef, useState } from 'react';
import { SPEECH_ENDPOINT, SPEECH_LIMITS, SPEECH_VOICES, type SpeechVoice } from '../../shared/speech';
import { AIKeySettings } from './AIOptions';
import { SpeechPlayer } from './speech-player';

export function SpeechOutput({ sessionId, questionId, question, onBusy }: { sessionId: string; questionId: string; question: string; onBusy: (busy: boolean) => void }) {
  const [model, setModel] = useState(''), [voice, setVoice] = useState<SpeechVoice>('alloy');
  const [consent, setConsent] = useState(false), [phase, setPhase] = useState<'idle'|'generating'|'ready'|'playing'>('idle');
  const [remaining, setRemaining] = useState<number>(), [error, setError] = useState('');
  const player = useRef<SpeechPlayer | undefined>(undefined), operation = useRef<string | undefined>(undefined);
  const live = useRef(true), cached = useRef(false), locked = useRef(false);
  const busy = phase === 'generating' || phase === 'playing';
  useEffect(() => { onBusy(busy); }, [busy, onBusy]);
  async function refresh() { try { const r = await window.studio!.getSpeechStatus(); if (live.current && r.ok) setRemaining(r.value.remainingRequests); } catch { /* Generation reports connection errors. */ } }
  useEffect(() => {
    live.current = true;
    player.current = new SpeechPlayer(active => { if (live.current && cached.current) setPhase(active ? 'playing' : 'ready'); }, message => { if (live.current) setError(message); });
    void refresh();
    return () => { live.current = false; cached.current = false; player.current?.dispose(); const id = operation.current; operation.current = undefined; if (id) void window.studio!.cancelSpeech(id).catch(() => {}); onBusy(false); };
  }, [onBusy]);
  function discard() {
    const id = operation.current; operation.current = undefined; cached.current = false; player.current?.dispose();
    if (id) void window.studio!.cancelSpeech(id).catch(() => {});
    locked.current = false; setPhase('idle'); setConsent(false); void refresh();
  }
  async function generate() {
    if (locked.current || !consent || cached.current) return;
    locked.current = true; setPhase('generating'); setError(''); const id = crypto.randomUUID(); operation.current = id;
    try {
      const result = await window.studio!.generateSpeech({ operationId: id, sessionId, questionId, preview: question, model, voice, transmissionConsent: true });
      if (!live.current || operation.current !== id) return;
      if (result.ok) { player.current!.load(result.value); cached.current = true; setPhase('ready'); setConsent(false); }
      else { setError(result.error.message); setPhase('idle'); }
    } catch { if (live.current && operation.current === id) { setError('질문 음성을 생성하지 못했습니다. 질문과 답변은 유지됩니다.'); setPhase('idle'); } }
    finally { if (live.current && operation.current === id) { locked.current = false; void refresh(); } }
  }
  const valid = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(model) && question.length <= SPEECH_LIMITS.textChars;
  return <section className="settings-card voice-input speech-output" aria-label="질문 음성 읽기">
    <h3>질문 음성 읽기</h3><p>OpenAI가 만드는 AI 합성 음성입니다. 질문 생성·음성 전사와 별도 서비스 요청이며, 만들기와 재생은 직접 선택합니다.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {!cached.current && phase !== 'generating' && <AIKeySettings fixedProvider="openai" onConfigured={() => void refresh()} />}
    <label htmlFor="speech-model">음성 읽기 모델 ID (OpenAI 콘솔에서 확인)</label><input id="speech-model" maxLength={100} value={model} disabled={busy} onChange={e => { discard(); setModel(e.target.value); }} />
    <label htmlFor="speech-voice">읽기 음성</label><select id="speech-voice" value={voice} disabled={busy} onChange={e => { discard(); setVoice(e.target.value as SpeechVoice); }}>{SPEECH_VOICES.map(v => <option key={v} value={v}>{v}</option>)}</select>
    <div className="transmission-preview"><h4>질문 전송 미리보기</h4><p>OpenAI · {model || '모델 미선택'} · {voice} · {SPEECH_ENDPOINT}</p><pre>{question}</pre>
      <p>이 질문 본문·모델·음성·MP3 설정만 보냅니다. 질문 안에 포함된 개인 내용도 전송될 수 있습니다. 이력서 전체·별도 근거·답변은 추가하지 않습니다. 서비스 요금·보존 정책이 적용되며 취소 전 전송·요금은 되돌릴 수 없습니다.</p>
      <label className="consent"><input type="checkbox" checked={consent} disabled={!valid || busy || cached.current} onChange={e => setConsent(e.target.checked)} /> 위 질문의 OpenAI 전송과 과금·보존 가능성을 확인했고 음성 생성에 동의합니다.</label></div>
    {!cached.current && phase !== 'generating' && <button className="secondary" disabled={!valid || !consent || remaining === 0} onClick={() => void generate()}>질문 음성 만들기</button>}
    {phase === 'generating' && <><p role="status">질문 음성을 생성하는 중입니다.</p><button className="secondary" onClick={discard}>음성 생성 취소</button></>}
    {cached.current && <><p role="status">{phase === 'playing' ? '질문 음성 재생 중' : '질문 음성이 준비됐습니다. 직접 재생하세요.'}</p><button className="secondary" disabled={phase === 'playing'} onClick={() => { setError(''); void player.current?.play(); }}>질문 음성 재생</button><button className="secondary" disabled={phase !== 'playing'} onClick={() => player.current?.stop()}>재생 중지</button><button className="secondary" onClick={discard}>질문 음성 폐기</button></>}
    <p className="hint">음성 읽기 남은 요청: {remaining ?? '확인 중'} / {SPEECH_LIMITS.requests} · 질문 생성/전사 한도와 별도입니다. 생성 30초·8MB·질문 1,500자·재생 최대 90초입니다. 금액 상한은 아닙니다.</p>
    <p className="hint">같은 음성 재생은 추가 요청 없이 메모리에서 처리합니다. 모델·음성 변경/질문 변경/화면 이탈 시 폐기하며, 파일로 저장하지 않습니다.</p>
  </section>;
}

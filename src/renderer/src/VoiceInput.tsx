import { useEffect, useRef, useState } from 'react';
import { VOICE_ENDPOINT, VOICE_LIMITS, VOICE_MIME } from '../../shared/voice';
import { VoiceRecorder } from './voice-recorder';
import { AIKeySettings } from './AIOptions';

type Phase = 'idle' | 'permission' | 'recording' | 'review' | 'transcribing' | 'transcript';
export function VoiceInput({ sessionId, questionId, answer, answerLimit, onApply, onBusy }: {
  sessionId: string; questionId: string; answer: string; answerLimit: number; onApply: (text: string) => void; onBusy: (busy: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [audio, setAudio] = useState<Blob>();
  const [model, setModel] = useState('');
  const [microphoneConsent, setMicrophoneConsent] = useState(false);
  const [transmissionConsent, setTransmissionConsent] = useState(false);
  const [replace, setReplace] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const [remaining, setRemaining] = useState<number>();
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<VoiceRecorder | undefined>(undefined);
  const operationId = useRef<string | undefined>(undefined);
  const live = useRef(true);
  const lock = useRef(false);
  useEffect(() => { onBusy(phase !== 'idle'); }, [phase, onBusy]);
  useEffect(() => { setReplace(false); }, [answer]);
  useEffect(() => {
    if (phase !== 'recording') return;
    const start = Date.now(); const timer = setInterval(() => setSeconds(Math.min(60, Math.floor((Date.now() - start) / 1000))), 250);
    return () => clearInterval(timer);
  }, [phase]);
  async function refresh() {
    try { const status = await window.studio!.getVoiceStatus(); if (live.current && status.ok) setRemaining(status.value.remainingRequests); } catch { /* The action reports connection errors. */ }
  }
  useEffect(() => {
    live.current = true; void refresh();
    return () => { live.current = false; recorder.current?.dispose(); const id = operationId.current; operationId.current = undefined; if (id) void window.studio!.cancelVoice(id).catch(() => {}); onBusy(false); };
  }, [onBusy]);
  function discard() {
    recorder.current?.dispose(); const id = operationId.current; operationId.current = undefined;
    if (id) void window.studio!.cancelVoice(id).catch(() => {});
    lock.current = false; setAudio(undefined); setTranscript(''); setTransmissionConsent(false); setPhase('idle'); setReplace(false);
    void refresh();
  }
  async function start() {
    if (lock.current || !microphoneConsent) return;
    lock.current = true; setError(''); setSeconds(0); setPhase('permission');
    const id = crypto.randomUUID(); operationId.current = id;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !MediaRecorder.isTypeSupported(VOICE_MIME)) throw new Error('Unsupported recording');
      const result = await window.studio!.beginVoice({ operationId: id, sessionId, questionId, microphoneConsent: true });
      if (!live.current || operationId.current !== id) { void window.studio!.cancelVoice(id).catch(() => {}); return; }
      if (!result.ok) { discard(); setError(result.error.message); return; }
      const capture = new VoiceRecorder(blob => {
        if (!live.current || operationId.current !== id) return;
        void (async () => {
          const stopped = await window.studio!.stopVoice(id);
          if (!live.current || operationId.current !== id) return;
          if (!stopped.ok) { discard(); setError(stopped.error.message); return; }
          setAudio(blob); setTransmissionConsent(false); setPhase('review'); lock.current = false;
        })().catch(() => { if (live.current && operationId.current === id) { discard(); setError('녹음을 준비하지 못했습니다. 다시 시도해 주세요.'); } });
      }, message => { if (live.current && operationId.current === id) { discard(); setError(message); } });
      recorder.current = capture;
      if (await capture.start() && live.current && operationId.current === id) setPhase('recording');
    } catch { if (live.current && operationId.current === id) { discard(); setError('음성 녹음을 시작하지 못했습니다. 지원되는 마이크를 확인하거나 텍스트로 입력하세요.'); } }
  }
  async function transcribe() {
    const id = operationId.current;
    if (lock.current || !id || !audio || !transmissionConsent) return;
    lock.current = true; setPhase('transcribing'); setError('');
    try {
      const bytes = new Uint8Array(await audio.arrayBuffer());
      if (!live.current || operationId.current !== id) return;
      const result = await window.studio!.transcribeVoice({ operationId: id, audio: bytes, model, transmissionConsent: true });
      if (!live.current || operationId.current !== id) return;
      if (result.ok) { setTranscript(result.value); setAudio(undefined); setPhase('transcript'); setTransmissionConsent(false); }
      else { setError(result.error.message); setPhase('review'); }
    } catch { if (live.current && operationId.current === id) { setError('음성 전사를 완료하지 못했습니다. 기존 답변은 유지됩니다.'); setPhase('review'); } }
    finally { if (live.current && operationId.current === id) { lock.current = false; void refresh(); } }
  }
  return <section className="settings-card voice-input" aria-label="음성 답변 입력">
    <h3>음성으로 답변 입력</h3>
    <p>한 답변을 녹음한 뒤 OpenAI로 전사하고 직접 검토합니다. 원본 음성은 저장하지 않습니다. 질문 생성 서비스와 별도이며 텍스트 연습에서도 전사에는 인터넷·OpenAI 키가 필요합니다.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {phase === 'idle' && <><AIKeySettings fixedProvider="openai" onConfigured={() => void refresh()} /><label htmlFor="voice-model">음성 전사 모델 ID (OpenAI 콘솔에서 확인)</label><input id="voice-model" maxLength={100} value={model} onChange={e => { setModel(e.target.value); setTransmissionConsent(false); }} />
      <label className="consent"><input type="checkbox" checked={microphoneConsent} onChange={e => setMicrophoneConsent(e.target.checked)} /> 이 답변을 위해 마이크를 사용하고 음성을 메모리에서 준비하는 데 동의합니다.</label>
      <button className="secondary" disabled={!microphoneConsent || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(model)} onClick={() => void start()}>녹음 시작</button></>}
    {phase === 'permission' && <p role="status">마이크 권한을 확인하는 중입니다.</p>}
    {phase === 'recording' && <><p role="status">녹음 중 · {seconds} / 60초</p><button className="secondary" onClick={() => recorder.current?.stop()}>녹음 중지</button></>}
    {audio && <div className="transmission-preview"><h4>음성 전송 미리보기</h4><p>OpenAI · {model} · {VOICE_ENDPOINT}</p><p>녹음 {seconds}초 · {(audio.size / 1024).toFixed(1)}KB · 음성과 모델·한국어 전사 설정만 전송합니다. 이력서·질문·기존 답변은 포함하지 않습니다.</p><p>서비스 과금·보존 정책이 적용됩니다. 취소 전에 발생한 요금·전송은 되돌릴 수 없습니다. 최대 60초·8MB, 요청 대기 30초입니다.</p>
      <label className="consent"><input type="checkbox" checked={transmissionConsent} disabled={phase === 'transcribing'} onChange={e => setTransmissionConsent(e.target.checked)} /> 선택 음성의 OpenAI 전송과 과금·보존 가능성을 확인했고 전사에 동의합니다.</label>
      {phase === 'review' && <button className="secondary" disabled={!transmissionConsent || remaining === 0} onClick={() => void transcribe()}>동의한 음성 전사</button>}</div>}
    {phase === 'transcribing' && <p role="status">전사 중입니다. 기존 답변은 유지됩니다.</p>}
    {phase === 'transcript' && <><label htmlFor="voice-transcript">전사 검토·수정 (아직 제출되지 않음)</label><textarea id="voice-transcript" value={transcript} onChange={e => { setTranscript(e.target.value); setReplace(false); }} /><p>{transcript.length.toLocaleString()} / {answerLimit.toLocaleString()}자 · 초과 내용은 직접 수정하세요.</p>
      {answer && <label className="consent"><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} /> 현재 입력한 답변을 검토한 전사 내용으로 교체합니다.</label>}
      <button className="secondary" disabled={!transcript.trim() || transcript.includes('\0') || transcript.length > answerLimit || (!!answer && !replace)} onClick={() => { onApply(transcript); discard(); }}>답변 입력에 적용</button></>}
    {phase !== 'idle' && <button className="secondary" onClick={() => { discard(); setError(''); }}>음성 입력 취소·폐기</button>}
    <p className="hint">전사 남은 요청: {remaining ?? '확인 중'} / {VOICE_LIMITS.requests} · 질문 생성 한도와 별도입니다. 실패·취소도 포함되며 금액 상한은 아닙니다. 재시작 시 초기화됩니다.</p>
    <p className="hint">화면을 벗어나면 음성과 미적용 전사를 폐기합니다. 적용 후에도 답변 제출 버튼을 직접 눌러야 저장됩니다.</p>
  </section>;
}

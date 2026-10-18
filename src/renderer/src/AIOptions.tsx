import { useEffect, useId, useRef, useState } from 'react';
import { AI_CALL_LIMIT, AI_ENDPOINTS, AI_NAMES, AI_PROVIDERS, isAIConfig, isAIModelId, type AIInterviewConfig, type AIProvider, type AIStatus } from '../../shared/ai';

export function AIKeySettings({ disabled = false, onStatus, fixedProvider, onConfigured }: { disabled?: boolean; onStatus?: (status: AIStatus) => void; fixedProvider?: AIProvider; onConfigured?: () => void }) {
  const fieldId = useId();
  const [provider, setProvider] = useState<AIProvider>(fixedProvider ?? 'openai');
  const [status, setStatus] = useState<AIStatus>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const live = useRef(true);
  useEffect(() => { let current = true; live.current = true; if (!disabled) void window.studio?.getAIStatus().then(result => {
    if (!current) return;
    if (result.ok) { setStatus(result.value); onStatus?.(result.value); } else setError(result.error.message);
  }).catch(() => { if (current) setError('AI 설정을 읽지 못했습니다. 화면을 다시 열어 주세요.'); });
    return () => { current = false; live.current = false; if (input.current) input.current.value = ''; };
  }, [onStatus, disabled]);
  async function update(clear: boolean) {
    if (busy || disabled) return;
    setBusy(true); setError(''); setMessage('');
    // Password input is one-way into main. Do not retain it in React state,
    // browser storage, snapshots, logs or any response returned from main.
    const key = input.current?.value ?? '';
    if (input.current) input.current.value = '';
    try {
      const result = clear ? await window.studio!.clearAIKey({ provider }) : await window.studio!.configureAIKey({ provider, key });
      if (!live.current) return;
      if (result.ok) { setStatus(result.value); onStatus?.(result.value); setMessage(clear ? '키를 비웠습니다.' : '키를 이번 실행에 등록했습니다. 실제 인증·연결은 질문 생성 때 확인합니다.'); if (!clear) onConfigured?.(); }
      else setError(result.error.message);
    } catch { if (live.current) setError('키 설정을 적용하지 못했습니다. 다시 입력해 주세요.'); }
    finally { if (live.current) setBusy(false); }
  }
  return <div className="settings-card ai-keys"><h2>외부 AI API 키</h2>
    <p>키는 앱 실행 중에만 보관하며 종료·창 닫기 시 비웁니다. 재시작 후 다시 입력하세요. 등록만으로 인터넷 요청을 보내지 않습니다.</p>
    <label htmlFor={`${fieldId}-provider`}>키를 등록할 서비스</label><select id={`${fieldId}-provider`} value={provider} disabled={disabled || busy || !!fixedProvider} onChange={e => { setProvider(e.target.value as AIProvider); if (input.current) input.current.value = ''; setMessage(''); }}>
      {AI_PROVIDERS.map(p => <option key={p} value={p}>{AI_NAMES[p]}</option>)}
    </select>
    <label htmlFor={`${fieldId}-key`}>API 키 (저장 후 화면에서 비움)</label><input ref={input} id={`${fieldId}-key`} type="password" autoComplete="off" spellCheck={false} maxLength={512} disabled={disabled || busy} />
    <div className="resume-actions"><button className="secondary" disabled={disabled || busy} onClick={() => void update(false)}>이번 실행에 키 등록</button><button className="secondary" disabled={disabled || busy} onClick={() => void update(true)}>선택 서비스 키 비우기</button></div>
    <p className="hint">{status ? status.providers.map(p => `${AI_NAMES[p.provider]}: ${p.configured ? '등록됨' : '미등록'}`).join(' · ') : '설정 확인 중…'}</p>
    {status && <p className="hint">이번 실행의 남은 요청: {status.remainingRequests} / {AI_CALL_LIMIT}. 실패·취소도 사용량에 포함됩니다. 재시작하면 요청 한도는 초기화됩니다.</p>}
    {message && <p role="status">{message}</p>}{error && <p className="error" role="alert">{error}</p>}
  </div>;
}

export function AIStartOptions({ disabled, reviewedText, onChange, onEnabledChange }: { disabled: boolean; reviewedText: string; onChange: (config: AIInterviewConfig | undefined) => void; onEnabledChange: (enabled: boolean) => void }) {
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<AIProvider>('openai');
  const [model, setModel] = useState('');
  const [quote, setQuote] = useState('');
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<AIStatus>();
  const candidate = { provider, model, quote, transmissionConsent: true as const };
  const modelError = model.length > 0 && !isAIModelId(model);
  const valid = isAIConfig(candidate) && reviewedText.includes(quote);
  const ready = enabled && consent && valid && status?.providers.some(p => p.provider === provider && p.configured) && status.remainingRequests > 0;
  useEffect(() => { onChange(ready ? { provider, model, quote, transmissionConsent: true } : undefined); }, [ready, provider, model, quote, onChange]);
  return <div className="ai-options">
    <label className="consent"><input type="checkbox" checked={enabled} disabled={disabled} onChange={e => { setEnabled(e.target.checked); onEnabledChange(e.target.checked); setConsent(false); }} /> 외부 API로 AI 질문 생성</label>
    {enabled && <>
      <AIKeySettings disabled={disabled} onStatus={setStatus} />
      <label htmlFor="ai-provider">면접 서비스</label><select id="ai-provider" value={provider} disabled={disabled} onChange={e => { setProvider(e.target.value as AIProvider); setModel(''); setConsent(false); }}>{AI_PROVIDERS.map(p => <option key={p} value={p}>{AI_NAMES[p]}</option>)}</select>
      <label htmlFor="ai-model">모델 ID (서비스 콘솔에서 확인)</label><input id="ai-model" value={model} maxLength={100} disabled={disabled} placeholder="사용 가능한 텍스트 모델 ID" aria-invalid={modelError} aria-describedby={modelError ? 'ai-model-help ai-model-error' : 'ai-model-help'} onChange={e => { setModel(e.target.value); setConsent(false); }} />
      <p id="ai-model-help" className="hint">표시 이름 대신 서비스 콘솔의 API 모델 ID를 그대로 복사하세요. 입력 형식이 맞아도 실제 모델 접근 가능 여부는 질문 생성 요청 때 확인합니다.</p>
      {modelError && <p id="ai-model-error" className="error" role="alert">모델 ID 형식이 맞지 않습니다. 공백 없이 영문·숫자로 시작하고 영문·숫자·점(.)·밑줄(_)·하이픈(-)만 사용하세요. 올바른 모델 ID를 입력해야 전송 동의를 선택할 수 있습니다.</p>}
      <label htmlFor="ai-quote">첫 질문에 보낼 구절 — 위 수정본에서 직접 복사 (최대 180자)</label><textarea id="ai-quote" value={quote} maxLength={180} disabled={disabled} onChange={e => { setQuote(e.target.value); setConsent(false); }} />
      {quote && !reviewedText.includes(quote) && <p className="error">수정본에 그대로 포함된 구절을 선택해 주세요.</p>}
      <div className="transmission-preview"><h3>첫 요청 전송 미리보기</h3><p>{AI_NAMES[provider]} · {model || '모델 미선택'} · {AI_ENDPOINTS[provider]}{provider === 'gemini' ? `${model}:generateContent` : ''}</p><pre>{quote || '선택한 구절이 없습니다.'}</pre><p>이 구절·출처 표시·질문 번호·한국어 면접 질문 생성 지시를 전송합니다. 이력서 전체·연락처를 자동 선택하지 않습니다. 이후 후속 질문은 직전 답변만 별도로 확인받아 전송합니다.</p></div>
      <p>인터넷과 본인 API 키가 필요합니다. 서비스의 요금·데이터 보존/이용 정책이 적용됩니다. 무료 플랜을 포함한 정책은 서비스에서 확인하세요. 요청당 출력 최대 600토큰·30초, 면접 12문항, 앱 실행당 최대 {AI_CALL_LIMIT}요청(수동 재시도 포함)입니다. 금액 상한은 보장하지 않으므로 서비스 콘솔에서도 예산 한도를 설정하세요. 취소해도 이미 발생한 요금·전송은 되돌릴 수 없습니다.</p>
      <p className="hint">JSON 응답을 지원하는 모델을 사용하세요. 모델 접근 권한·형식·토큰 한도 오류는 요청 실패로 표시하며 다른 서비스나 로컬 질문으로 자동 대체하지 않습니다.</p>
      <label className="consent"><input type="checkbox" checked={consent} disabled={disabled || !valid} onChange={e => setConsent(e.target.checked)} /> 선택 서비스·모델·구절과 과금·보존 가능성을 확인했고 첫 요청 전송에 동의합니다.</label>
      {!ready && <p className="hint">키 등록·모델·원문에 있는 구절·전송 동의를 확인해야 AI 면접을 시작할 수 있습니다.</p>}
    </>}
    {enabled && !ready && <p role="status">현재 AI 시작 조건이 충족되지 않았습니다.</p>}
  </div>;
}

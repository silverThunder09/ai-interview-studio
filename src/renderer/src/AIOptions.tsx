import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import { DEFAULT_AI_PREFERENCES, DEFAULT_INTERVIEWER_PROFILES, AI_CALL_LIMIT, AI_ENDPOINTS, AI_NAMES, AI_PROVIDERS, isAIConfig, isAIModelId, type AIInterviewConfig, type AIProvider, type AIStatus, type InterviewerProfiles } from '../../shared/ai';

export const ConnectionContext = createContext<{ revision: number; settingsOpen: boolean; open: (provider?: AIProvider) => void; changed: () => void }>({ revision: 0, settingsOpen: false, open: () => {}, changed: () => {} });
export function AIConnectionSummary({ disabled = false, onStatus, fixedProvider, onConfigured }: { disabled?: boolean; onStatus?: (status: AIStatus) => void; fixedProvider?: AIProvider; onConfigured?: () => void }) {
  const connection = useContext(ConnectionContext);
  const [status, setStatus] = useState<AIStatus>();
  const [error, setError] = useState('');
  const lastRevision = useRef(connection.revision);
  useEffect(() => {
    const changed = connection.revision !== lastRevision.current; lastRevision.current = connection.revision;
    let current = true;
    void window.studio?.getAIStatus().then(result => {
      if (!current) return;
      if (result.ok) { setStatus(result.value); onStatus?.(result.value); if (changed && result.value.providers.some(p => p.provider === fixedProvider && p.configured)) onConfigured?.(); }
      else setError(result.error.message);
    }).catch(() => { if (current) setError('연결 설정을 읽지 못했습니다. 설정을 다시 열어 주세요.'); });
    return () => { current = false; };
    // Callback identities change during typing; refresh on explicit settings completion only.
  }, [connection.revision, fixedProvider, disabled]);
  const selected = status?.preferences;
  return <div className="connection-summary">
    <div><strong>{fixedProvider ? AI_NAMES[fixedProvider] : selected ? AI_NAMES[selected.provider] : '외부 AI 연결'}</strong><p className="hint">{fixedProvider ? status?.providers.find(p => p.provider === fixedProvider)?.configured ? '키 등록됨' : '키 미등록' : selected?.models[selected.provider] || '설정에서 서비스와 모델을 선택하세요.'}</p></div>
    <button className="secondary" disabled={disabled} onClick={() => connection.open(fixedProvider)}>API 연결 설정</button>
    {status && <p className="hint request-budget">이번 실행의 남은 요청: {status.remainingRequests} / {AI_CALL_LIMIT}. 실패·취소도 포함됩니다.</p>}
    {error && <p role="alert" className="error">{error}</p>}
  </div>;
}

export function APISettings({ disabled = false, onStatus, fixedProvider, onConfigured }: { disabled?: boolean; onStatus?: (status: AIStatus) => void; fixedProvider?: AIProvider; onConfigured?: () => void }) {
  const fieldId = useId();
  const [provider, setProvider] = useState<AIProvider>(fixedProvider ?? 'openai');
  const [status, setStatus] = useState<AIStatus>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(true);
  const [models, setModels] = useState({ ...DEFAULT_AI_PREFERENCES.models });
  const [profiles, setProfiles] = useState<InterviewerProfiles>({ ...DEFAULT_INTERVIEWER_PROFILES });
  const connection = useContext(ConnectionContext);
  const input = useRef<HTMLInputElement>(null);
  const live = useRef(true);
  useEffect(() => { let current = true; live.current = true; if (!disabled) void window.studio?.getAIStatus().then(result => {
    if (!current) return;
    if (result.ok) { setStatus(result.value); setModels(result.value.preferences?.models ?? { ...DEFAULT_AI_PREFERENCES.models }); setProfiles(result.value.preferences?.profiles ?? { ...DEFAULT_INTERVIEWER_PROFILES }); setProvider(fixedProvider ?? result.value.preferences?.provider ?? 'openai'); onStatus?.(result.value); } else setError(result.error.message);
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
      const result = clear ? await window.studio!.clearAIKey({ provider }) : await window.studio!.configureAIKey({ provider, key, remember: remember && !!status?.storage?.available });
      if (!live.current) return;
      if (result.ok) { setStatus(result.value); onStatus?.(result.value); connection.changed(); setMessage(clear ? '저장된 키와 이번 실행의 키를 삭제했습니다.' : remember && status?.storage?.available ? '키를 이 기기에 암호화해 저장했습니다. 실제 연결은 질문 생성 때 확인합니다.' : '키를 이번 실행에 등록했습니다. 실제 인증·연결은 질문 생성 때 확인합니다.'); if (!clear) onConfigured?.(); }
      else setError(result.error.message);
    } catch { if (live.current) setError('키 설정을 적용하지 못했습니다. 다시 입력해 주세요.'); }
    finally { if (live.current) setBusy(false); }
  }
  async function savePreferences() {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await window.studio!.updateAIPreferences({ provider, models, profiles });
      if (!live.current) return;
      if (result.ok) { setStatus(result.value); connection.changed(); setMessage('서비스와 모델 설정을 저장했습니다. 면접관 말투도 저장하며 전송 동의는 저장하지 않습니다.'); }
      else setError(result.error.message);
    } catch { if (live.current) setError('모델 설정을 저장하지 못했습니다. 다시 시도해 주세요.'); }
    finally { if (live.current) setBusy(false); }
  }
  return <div className="settings-card ai-keys"><h2>외부 AI API 키</h2>
    <p>OpenAI · Claude · Gemini 연결을 한곳에서 관리합니다. 키 등록이나 모델 저장만으로 인터넷 요청을 보내지 않습니다.</p>
    <label htmlFor={`${fieldId}-provider`}>키를 등록할 서비스</label><select id={`${fieldId}-provider`} value={provider} disabled={disabled || busy || !!fixedProvider} onChange={e => { setProvider(e.target.value as AIProvider); if (input.current) input.current.value = ''; setMessage(''); }}>
      {AI_PROVIDERS.map(p => <option key={p} value={p}>{AI_NAMES[p]}</option>)}
    </select>
    <label htmlFor={`${fieldId}-model`}>모델 ID (서비스 콘솔에서 확인)</label><input id={`${fieldId}-model`} value={models[provider]} maxLength={100} disabled={busy} placeholder="예: gemini-3.8-flash" aria-invalid={models[provider] !== '' && !isAIModelId(models[provider])} onChange={e => setModels({ ...models, [provider]: e.target.value })} />
    {models[provider] !== '' && !isAIModelId(models[provider]) && <p className="error" role="alert">모델 ID 형식이 맞지 않습니다. 표시 이름 대신 공백 없는 API 모델 ID를 입력하세요.</p>}
    <p className="hint">사용 가능한 JSON 응답 모델 ID를 서비스 콘솔에서 복사하세요. 모델 접근 권한·실제 연결은 요청 때 확인합니다.</p>
    {provider === 'gemini' && <><label htmlFor={`${fieldId}-profile-a`}>기술 면접관 A의 말투</label><select id={`${fieldId}-profile-a`} value={profiles.a} disabled={busy || disabled} onChange={e => setProfiles({ ...profiles, a: e.target.value as InterviewerProfiles['a'] })}><option value="strict">엄격·논리</option><option value="balanced">균형·명확</option></select><label htmlFor={`${fieldId}-profile-b`}>경험 면접관 B의 말투</label><select id={`${fieldId}-profile-b`} value={profiles.b} disabled={busy || disabled} onChange={e => setProfiles({ ...profiles, b: e.target.value as InterviewerProfiles['b'] })}><option value="calm">차분·근거</option><option value="supportive">친절·구체화</option></select></>}
    <button className="secondary" disabled={busy || Object.values(models).some(model => model !== '' && !isAIModelId(model))} onClick={() => void savePreferences()}>서비스·모델 저장</button>
    <hr />
    <label htmlFor={`${fieldId}-key`}>API 키 (저장 후 화면에서 비움)</label><input ref={input} id={`${fieldId}-key`} type="password" autoComplete="off" spellCheck={false} maxLength={512} disabled={disabled || busy} />
    <label className="consent"><input type="checkbox" checked={remember && !!status?.storage?.available} disabled={!status?.storage?.available || busy} onChange={e => setRemember(e.target.checked)} /> 이 기기에 키 저장 (OS 암호화)</label>
    <p className="hint">Windows 사용자 계정의 보호 기능으로 저장합니다. 암호화를 사용할 수 없으면 이번 실행에만 등록할 수 있습니다. 같은 OS 계정의 악성 프로그램까지 차단하지는 않습니다.</p>
    {status?.storage?.warning && <p className="error" role="alert">{status.storage.warning}</p>}
    <div className="resume-actions"><button className="secondary" disabled={disabled || busy} onClick={() => void update(false)}>{remember && status?.storage?.available ? '키 저장' : '이번 실행에 키 등록'}</button><button className="secondary" disabled={disabled || busy} onClick={() => void update(true)}>선택 서비스 키 삭제</button></div>
    <p className="hint">{status ? status.providers.map(p => `${AI_NAMES[p.provider]}: ${p.configured ? p.saved ? '저장됨' : '이번 실행에 등록됨' : '미등록'}`).join(' · ') : '설정 확인 중…'}</p>
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
  const profiles = status?.preferences?.profiles ?? DEFAULT_INTERVIEWER_PROFILES;
  const candidate = { provider, model, quote, transmissionConsent: true as const, ...(provider === 'gemini' ? { profiles } : {}) };
  const valid = isAIConfig(candidate) && reviewedText.includes(quote);
  const ready = enabled && consent && valid && status?.providers.some(p => p.provider === provider && p.configured) && status.remainingRequests > 0;
  useEffect(() => { onChange(ready ? { provider, model, quote, transmissionConsent: true, ...(provider === 'gemini' ? { profiles } : {}) } : undefined); }, [ready, provider, model, quote, profiles.a, profiles.b, onChange]);
  return <div className="ai-options">
    <label className="consent"><input type="checkbox" checked={enabled} disabled={disabled} onChange={e => { setEnabled(e.target.checked); onEnabledChange(e.target.checked); setConsent(false); }} /> 외부 API로 AI 질문 생성</label>
    {enabled && <>
      <AIConnectionSummary disabled={disabled} onStatus={value => { setStatus(value); setProvider(value.preferences?.provider ?? 'openai'); setModel(value.preferences?.models[value.preferences.provider] ?? ''); setConsent(false); }} />
      <label htmlFor="ai-quote">첫 질문에 보낼 구절 — 위 수정본에서 직접 복사 (최대 180자)</label><textarea id="ai-quote" value={quote} maxLength={180} disabled={disabled} onChange={e => { setQuote(e.target.value); setConsent(false); }} />
      {quote && !reviewedText.includes(quote) && <p className="error">수정본에 그대로 포함된 구절을 선택해 주세요.</p>}
      <div className="transmission-preview"><h3>첫 요청 전송 미리보기</h3><p>{AI_NAMES[provider]} · {model || '모델 미선택'} · {AI_ENDPOINTS[provider]}{provider === 'gemini' ? `${model}:generateContent` : ''}</p>{provider === 'gemini' && <p>면접관 B 말투: {profiles.b === 'calm' ? '차분·근거' : '친절·구체화'} ({profiles.b})</p>}<pre>{quote || '선택한 구절이 없습니다.'}</pre><p>이 구절·출처 표시·질문 번호·한국어 면접 질문 생성 지시를 전송합니다. 이력서 전체·연락처를 자동 선택하지 않습니다. 이후 후속 질문은 직전 답변만 별도로 확인받아 전송합니다.</p></div>
      <p>인터넷과 본인 API 키가 필요합니다. 서비스의 요금·데이터 보존/이용 정책이 적용됩니다. 무료 플랜을 포함한 정책은 서비스에서 확인하세요. 요청당 출력 최대 600토큰·30초, 면접 12문항, 앱 실행당 최대 {AI_CALL_LIMIT}요청(수동 재시도 포함)입니다. 금액 상한은 보장하지 않으므로 서비스 콘솔에서도 예산 한도를 설정하세요. 취소해도 이미 발생한 요금·전송은 되돌릴 수 없습니다.</p>
      <p className="hint">JSON 응답을 지원하는 모델을 사용하세요. 모델 접근 권한·형식·토큰 한도 오류는 요청 실패로 표시하며 다른 서비스나 로컬 질문으로 자동 대체하지 않습니다.</p>
      <label className="consent"><input type="checkbox" checked={consent} disabled={disabled || !valid} onChange={e => setConsent(e.target.checked)} /> 선택 서비스·모델·구절과 과금·보존 가능성을 확인했고 첫 요청 전송에 동의합니다.</label>
      {!ready && <p className="hint">키 등록·모델·원문에 있는 구절·전송 동의를 확인해야 AI 면접을 시작할 수 있습니다.</p>}
    </>}
    {enabled && !ready && <p role="status">현재 AI 시작 조건이 충족되지 않았습니다.</p>}
  </div>;
}

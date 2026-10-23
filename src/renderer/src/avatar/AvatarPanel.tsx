import { useContext, useEffect, useRef, useState } from 'react';
import { AVATAR_SLOTS, type AvatarSlot } from '../../../shared/avatar';
import type { AvatarQuality } from '../../../shared/contracts';
import { ConnectionContext } from '../AIOptions';
import { AvatarStage, type StageMetrics } from './stage';

const names = { a: 'A · 기술 면접관', b: 'B · 경험·협업 면접관' };
export function AvatarPanel({ active = 'a', waiting = false, answering = false, preview = false }: {
  active?: AvatarSlot | null; waiting?: boolean; answering?: boolean; preview?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null), stage = useRef<AvatarStage | undefined>(undefined);
  const live = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [error, setError] = useState(''), [ready, setReady] = useState(false), [busy, setBusy] = useState(true);
  const [metrics, setMetrics] = useState<StageMetrics>();
  const [models, setModels] = useState<Record<AvatarSlot, string>>({ a: '기본 3D 캐릭터 · 실사 에셋 아님', b: '기본 3D 캐릭터 · 실사 에셋 아님' });
  const [speaker, setSpeaker] = useState<AvatarSlot | null>(null), [selected, setSelected] = useState<AvatarSlot>('a');
  const [paused, setPaused] = useState(false), [quality, setQuality] = useState<AvatarQuality>('low');
  const [qualityReady, setQualityReady] = useState(false), [qualitySaving, setQualitySaving] = useState(false), [qualityWarning, setQualityWarning] = useState('');
  const { settingsOpen } = useContext(ConnectionContext);
  useEffect(() => {
    let active = true;
    void window.studio!.getSnapshot().then(result => {
      if (!active) return;
      if (result.ok) setQuality(result.value.settings.avatarQuality ?? 'low');
      else setQualityWarning('저장한 품질을 읽지 못해 경량 품질을 적용했습니다.');
    }).catch(() => { if (active) setQualityWarning('저장한 품질을 읽지 못해 경량 품질을 적용했습니다.'); })
      .finally(() => { if (active) setQualityReady(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    live.current = true;
    let instance: AvatarStage;
    try { instance = new AvatarStage(canvas.current!, setMetrics, message => { if (live.current) setError(message); }); stage.current = instance; setReady(true); }
    catch (error) {
      console.error('3D 초기화:', error instanceof Error ? error.message.slice(0, 300) : '알 수 없는 초기화 오류');
      setError('이 환경에서 WebGL 3D를 시작하지 못했습니다. 그래픽 드라이버를 확인하세요. 텍스트 면접은 계속 사용할 수 있습니다.'); setBusy(false); return () => { live.current = false; };
    }
    void (async () => {
      for (const slot of AVATAR_SLOTS) {
        try {
          const stored = await window.studio!.getAvatar(slot);
          if (!live.current || stage.current !== instance) return;
          if (!stored.ok) { setError(stored.error.message); continue; }
          if (stored.value) {
            const capability = await instance.replace(slot, stored.value);
            if (live.current && stage.current === instance && capability) setModels(m => ({ ...m, [slot]: `${stored.value!.name} · ${capability}` }));
          }
        } catch { if (live.current && stage.current === instance) setError('저장한 모델을 복원하지 못했습니다. 기본 캐릭터로 표시합니다. 다시 선택하거나 기본 모델로 초기화하세요.'); }
      }
      if (live.current && stage.current === instance) setBusy(false);
    })();
    return () => { live.current = false; clearTimeout(timer.current); instance.dispose(); if (stage.current === instance) stage.current = undefined; };
  }, []);
  useEffect(() => {
    if (!stage.current) return;
    stage.current.state.active = preview ? selected : waiting || answering ? null : active;
    stage.current.state.speaking = preview && !settingsOpen ? speaker : null;
    stage.current.state.paused = paused || settingsOpen;
    stage.current.setQuality(quality);
  }, [active, waiting, answering, preview, selected, speaker, paused, quality, settingsOpen, ready]);
  async function selectModel(slot: AvatarSlot) {
    if (busy || !stage.current) return;
    setBusy(true); setError('');
    try {
      const result = await window.studio!.selectAvatar(slot);
      if (!live.current) return;
      if (!result.ok) { setError(result.error.message); return; }
      const asset = result.value; if (!asset) return;
      const capability = await stage.current!.replace(slot, asset, async () => {
        const saved = await window.studio!.commitAvatar(slot, asset.token);
        if (!saved.ok) throw new Error('Save failed'); return true;
      });
      if (live.current && capability) setModels(m => ({ ...m, [slot]: `${asset.name} · ${capability}` }));
    } catch { if (live.current) setError('모델 로딩·저장에 실패했습니다. 기존 모델을 유지합니다. 텍스처·리깅·자기 포함 형식을 확인하세요.'); }
    finally { if (live.current) setBusy(false); }
  }
  async function reset(slot: AvatarSlot) {
    if (busy || !stage.current) return; setBusy(true); setError('');
    try {
      const result = await window.studio!.resetAvatar(slot); if (!live.current) return;
      if (!result.ok) { setError(result.error.message); return; }
      stage.current!.reset(slot); setModels(m => ({ ...m, [slot]: '기본 3D 캐릭터 · 실사 에셋 아님' }));
    } catch { if (live.current) setError('모델 초기화에 실패했습니다. 다시 시도하세요.'); }
    finally { if (live.current) setBusy(false); }
  }
  function animate() {
    clearTimeout(timer.current); setSpeaker(selected);
    timer.current = setTimeout(() => { if (live.current) setSpeaker(null); }, 5000);
  }
  async function changeQuality(value: AvatarQuality) {
    if (!qualityReady || qualitySaving) return;
    setQuality(value); setQualitySaving(true);
    try {
      const result = await window.studio!.updateAvatarQuality(value);
      if (!result.ok) throw new Error('Quality save failed');
      if (live.current) setQualityWarning('');
    } catch { if (live.current) setQualityWarning('렌더링 품질을 이 화면에만 적용했습니다. 다시 실행하면 이전 저장값 또는 기본 경량 품질을 사용합니다.'); }
    finally { if (live.current) setQualitySaving(false); }
  }
  return <section className="avatar-panel" aria-label="3D 면접관">
    <div className="avatar-heading"><div><p className="eyebrow">3D INTERVIEW ROOM</p><h2>두 명의 면접관</h2></div><span className="avatar-status">{waiting ? '질문 준비 중' : answering ? '답변을 듣는 중' : preview ? '모델·동작 확인' : '현재 질문'}</span></div>
    <div className="avatar-viewport"><canvas ref={canvas} aria-label="마우스나 키보드로 시점을 조작하는 두 3D 면접관" data-studio-ready={ready} data-speaking={speaker ?? 'none'} data-paused={paused || settingsOpen} data-fps={metrics?.fps ?? 0} tabIndex={0} onKeyDown={event => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return;
      const action = event.key === 'ArrowLeft' ? () => stage.current?.rotate(-1)
        : event.key === 'ArrowRight' ? () => stage.current?.rotate(1)
          : event.key === '+' || event.key === '=' ? () => stage.current?.zoomIn()
            : event.key === '-' ? () => stage.current?.zoomOut()
              : event.key === 'Home' ? () => stage.current?.resetView() : undefined;
      if (action) { event.preventDefault(); action(); }
    }} />
      <div className="avatar-names" aria-hidden="true"><span>A · 기술</span><span>B · 경험·협업</span></div>
    </div>
    <div className="avatar-tools"><button className="secondary" disabled={!ready} onClick={() => stage.current?.resetView()}>시점 초기화</button><button className="secondary" disabled={!ready} onClick={() => stage.current?.zoomIn()}>확대</button><button className="secondary" disabled={!ready} onClick={() => stage.current?.zoomOut()}>축소</button><button className="secondary" disabled={!ready} onClick={() => stage.current?.rotate(-1)}>왼쪽 시점</button><button className="secondary" disabled={!ready} onClick={() => stage.current?.rotate(1)}>오른쪽 시점</button><label>렌더링 품질 <select value={quality} disabled={!qualityReady || qualitySaving} onChange={e => void changeQuality(e.target.value === 'standard' ? 'standard' : 'low')}><option value="low">경량</option><option value="standard">표준</option></select></label><label><input type="checkbox" checked={paused} onChange={e => setPaused(e.target.checked)} /> 움직임 일시정지</label></div>
    {qualityWarning && <div><p className="error" role="alert">{qualityWarning}</p><button className="secondary" disabled={!qualityReady || qualitySaving} onClick={() => void changeQuality(quality)}>품질 저장 다시 시도</button></div>}
    <p className="hint">마우스 드래그·휠 또는 방향키로 시점을 바꿀 수 있습니다. 3D 화면을 선택한 뒤 +/=로 확대하고 -로 축소하며 Home으로 초기화합니다. 한 화면에서 두 모델을 렌더링합니다. {metrics && !paused && !settingsOpen ? `현재 측정 ${metrics.fps}FPS · 삼각형 ${metrics.triangles.toLocaleString()} · geometry ${metrics.geometries} · texture ${metrics.textures}` : '최대 30FPS · 경량 품질 기본'}</p>
    {error && <p className="error" role="alert">{error}</p>}
    <details className="avatar-config"><summary>면접관 모델 설정</summary><p className="hint">사용 권한이 있는 자기 포함 GLB/glTF 2.0만 선택하세요(20MB 이하). 외부 파일·URL·압축 확장은 지원하지 않습니다. 선택 모델은 이 PC에 복사해 재시작 후 복원하며 기본 모델로 변경하면 앱 사본만 삭제합니다. 원본 파일은 유지합니다.</p>
      <div className="avatar-models">{AVATAR_SLOTS.map(slot => <article key={slot}><h3>{names[slot]}</h3><p>{models[slot]}</p><button className="secondary" disabled={busy || !ready} onClick={() => void selectModel(slot)}>{slot.toUpperCase()} 모델 불러오기</button><button className="secondary" disabled={busy || !ready} onClick={() => void reset(slot)}>{slot.toUpperCase()} 기본 모델</button></article>)}</div>
    </details>
    {preview && <div className="avatar-preview"><label>동작 확인 면접관 <select value={selected} onChange={e => { setSelected(e.target.value as AvatarSlot); setSpeaker(null); clearTimeout(timer.current); }}><option value="a">A · 기술</option><option value="b">B · 경험·협업</option></select></label><button className="secondary" disabled={!ready || paused || settingsOpen} onClick={animate}>발언 동작 미리보기 (무음)</button><button className="secondary" onClick={() => { clearTimeout(timer.current); setSpeaker(null); }}>동작 미리보기 중지</button><p className="hint">5초 동안 입·고개 움직임을 확인합니다. 음성 재생·립싱크·Gemini 역할 생성은 아직 연결하지 않았습니다. 실제 음량 립싱크는 후속 단계입니다.</p></div>}
    {busy && <p role="status">모델 검증·복원 중입니다.</p>}
  </section>;
}

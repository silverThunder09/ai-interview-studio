import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, session } from 'electron';
import { LocalSettings } from './local-settings';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHANNELS, type Result } from '../shared/contracts';
import { createHandlers } from './handlers';
import { createResumeSelector } from './resume';
import { createInterviewHandlers } from './interview-handlers';
import { InterviewStore } from './interview-store';
import { InterviewService } from './interview-service';
import { AICredentials, createAIHandlers, InterviewProviderRouter } from './external-ai';
import { createVoiceHandlers, VoiceService } from './voice';
import { createSpeechHandlers, SpeechService } from './speech';
import { createLocalSpeechHandlers, LocalSpeechService } from './local-speech';
import { AvatarModels } from './avatar';
import { APP_URL, assetPath, DEVELOPMENT_CSP, developmentURL, isTrustedSender, PRODUCTION_CSP } from './policy';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
let window: BrowserWindow | null = null;

async function start(): Promise<void> {
  const devURL = app.isPackaged ? undefined : developmentURL(process.env.ELECTRON_RENDERER_URL);
  const entry = devURL ?? APP_URL;
  const localSettings = new LocalSettings(() => join(app.getPath('userData'), 'settings.json'), safeStorage);
  const handlers = createHandlers(app.getVersion(), localSettings);
  let interviewStore: InterviewStore | undefined;
  const store = () => interviewStore ??= new InterviewStore(join(app.getPath('userData'), 'interviews.sqlite'));
  const credentials = new AICredentials(localSettings);
  const interview = createInterviewHandlers(store, new InterviewService(store, new InterviewProviderRouter(credentials)));
  const voiceService = new VoiceService(store, credentials);
  const voice = createVoiceHandlers(voiceService);
  const speechService = new SpeechService(store, credentials);
  const speech = createSpeechHandlers(speechService);
  const localSpeechService = new LocalSpeechService(store);
  const localSpeech = createLocalSpeechHandlers(localSpeechService);
  const avatars = new AvatarModels(join(app.getPath('userData'), 'avatar-models'), async () => {
    if (!window) throw new Error('Window unavailable');
    const selected = await dialog.showOpenDialog(window, {
      title: '사용 권한이 있는 자기 포함 3D 모델 선택', properties: ['openFile'],
      filters: [{ name: 'GLB / glTF 2.0 모델', extensions: ['glb', 'gltf'] }],
    });
    return selected.canceled ? undefined : selected.filePaths[0];
  });
  const ai = createAIHandlers(credentials, () => { interview.cancelPending(); voiceService.cancel(); speechService.cancel(); });
  app.on('will-quit', () => { localSpeechService.cancel(); speechService.cancel(); voiceService.cancel(); interview.close(); credentials.clearAll(); interviewStore?.close(); });
  const selectResume = createResumeSelector(async () => {
    if (!window) throw new Error('Window unavailable');
    const selected = await dialog.showOpenDialog(window, {
      title: '검토할 이력서 선택', properties: ['openFile'],
      filters: [{ name: '이력서 문서', extensions: ['pdf', 'docx'] }],
    });
    return selected.canceled ? undefined : selected.filePaths[0];
  });
  const browserSession = session.fromPartition('studio'); // in memory, no persistent web storage
  browserSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const media = 'mediaTypes' in details ? details.mediaTypes : undefined;
    callback(!!window && contents === window.webContents && voiceService.allows(permission, details.requestingUrl, details.isMainFrame, media, entry, true));
  });
  browserSession.setPermissionCheckHandler((contents, permission, _origin, details) =>
    !!window && contents === window.webContents && voiceService.allows(permission, details.requestingUrl, details.isMainFrame, details.mediaType ? [details.mediaType] : undefined, entry, false));
  browserSession.setDevicePermissionHandler(() => false);
  browserSession.on('will-download', (event) => event.preventDefault());
  browserSession.webRequest.onHeadersReceived((details, callback) => callback({
    responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [devURL ? DEVELOPMENT_CSP : PRODUCTION_CSP] },
  }));
  browserSession.protocol.handle('app', async (request) => {
    const file = assetPath(request.url, join(__dirname, '../renderer'));
    if (request.method !== 'GET' || !file) return new Response('Not found', { status: 404 });
    const response = await net.fetch(pathToFileURL(file).href);
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', PRODUCTION_CSP);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  });
  for (const [channel, handle] of [
    [CHANNELS.avatarSelect, avatars.select], [CHANNELS.avatarGet, avatars.get], [CHANNELS.avatarCommit, avatars.commit], [CHANNELS.avatarReset, avatars.reset],
    [CHANNELS.snapshot, handlers.snapshot], [CHANNELS.settings, handlers.update], [CHANNELS.avatarQuality, handlers.avatarQuality],
    [CHANNELS.resume, selectResume],
    [CHANNELS.interviewHistory, interview.history], [CHANNELS.interviewGet, interview.get],
    [CHANNELS.interviewStart, interview.start], [CHANNELS.interviewAnswer, interview.answer],
    [CHANNELS.interviewContextPreview, interview.preview],
    [CHANNELS.interviewDelete, interview.delete], [CHANNELS.interviewDeleteAll, interview.deleteAll],
    [CHANNELS.interviewCancel, interview.cancel],
    [CHANNELS.aiStatus, ai.status], [CHANNELS.aiKey, ai.set], [CHANNELS.aiClear, ai.clear],
    [CHANNELS.aiPreferences, ai.preferences],
    [CHANNELS.voiceBegin, voice.begin], [CHANNELS.voiceStop, voice.stop], [CHANNELS.voiceCancel, voice.cancel],
    [CHANNELS.voiceTranscribe, voice.transcribe], [CHANNELS.voiceStatus, voice.status],
    [CHANNELS.localSpeechGenerate, localSpeech.generate], [CHANNELS.localSpeechCancel, localSpeech.cancel], [CHANNELS.localSpeechStatus, localSpeech.status],
    [CHANNELS.speechGenerate, speech.generate], [CHANNELS.speechCancel, speech.cancel], [CHANNELS.speechStatus, speech.status],
  ] as const) {
    ipcMain.handle(channel, (event, ...args: unknown[]): Result<unknown> | Promise<Result<unknown>> => {
      const frame = event.senderFrame;
      if (!window || event.sender !== window.webContents || !frame ||
          !isTrustedSender(frame.url, entry, frame === window.webContents.mainFrame)) {
        return { ok: false, error: { code: 'UNAUTHORIZED', message: '허용되지 않은 요청입니다.' } };
      }
      if ([CHANNELS.interviewAnswer, CHANNELS.interviewDelete, CHANNELS.interviewDeleteAll].some(value => value === channel)) { voiceService.cancel(); speechService.cancel(); localSpeechService.cancel(); }
      if (channel === CHANNELS.voiceBegin) { speechService.cancel(); localSpeechService.cancel(); }
      if (channel === CHANNELS.speechGenerate) { voiceService.cancel(); localSpeechService.cancel(); }
      if (channel === CHANNELS.localSpeechGenerate) { voiceService.cancel(); speechService.cancel(); }
      return handle(args);
    });
  }
  function createWindow(): void {
    window = new BrowserWindow({
      width: 1180, height: 800, minWidth: 860, minHeight: 640,
      title: 'AI Interview Studio', backgroundColor: '#f4f5f8', autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'), session: browserSession,
        contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
        allowRunningInsecureContent: false, webviewTag: false,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('will-redirect', (event) => event.preventDefault());
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    window.on('closed', () => { localSpeechService.cancel(); speechService.cancel(); voiceService.cancel(); interview.cancelPending(); credentials.clearAll(); window = null; });
    void window.loadURL(entry).catch(() => {
      dialog.showErrorBox('시작 실패', '앱 화면을 불러오지 못했습니다. 앱을 다시 실행해 주세요.');
      app.exit(1);
    });
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}

app.whenReady().then(start).catch(() => {
  dialog.showErrorBox('시작 실패', '앱 초기화에 실패했습니다. 앱을 다시 실행해 주세요.');
  app.exit(1);
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

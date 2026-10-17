import { app, BrowserWindow, dialog, ipcMain, net, protocol, session } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHANNELS, type Result } from '../shared/contracts';
import { createHandlers } from './handlers';
import { createResumeSelector } from './resume';
import { createInterviewHandlers } from './interview-handlers';
import { InterviewStore } from './interview-store';
import { InterviewService } from './interview-service';
import { AICredentials, createAIHandlers, InterviewProviderRouter } from './external-ai';
import { APP_URL, assetPath, DEVELOPMENT_CSP, developmentURL, isTrustedSender, PRODUCTION_CSP } from './policy';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
let window: BrowserWindow | null = null;

async function start(): Promise<void> {
  const devURL = app.isPackaged ? undefined : developmentURL(process.env.ELECTRON_RENDERER_URL);
  const entry = devURL ?? APP_URL;
  const handlers = createHandlers(app.getVersion());
  let interviewStore: InterviewStore | undefined;
  const store = () => interviewStore ??= new InterviewStore(join(app.getPath('userData'), 'interviews.sqlite'));
  const credentials = new AICredentials();
  const interview = createInterviewHandlers(store, new InterviewService(store, new InterviewProviderRouter(credentials)));
  const ai = createAIHandlers(credentials, () => interview.cancelPending());
  app.on('will-quit', () => { interview.close(); credentials.clearAll(); interviewStore?.close(); });
  const selectResume = createResumeSelector(async () => {
    if (!window) throw new Error('Window unavailable');
    const selected = await dialog.showOpenDialog(window, {
      title: '검토할 이력서 선택', properties: ['openFile'],
      filters: [{ name: '이력서 문서', extensions: ['pdf', 'docx'] }],
    });
    return selected.canceled ? undefined : selected.filePaths[0];
  });
  const browserSession = session.fromPartition('studio'); // in memory, no persistent web storage
  browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  browserSession.setPermissionCheckHandler(() => false);
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
    [CHANNELS.snapshot, handlers.snapshot], [CHANNELS.settings, handlers.update],
    [CHANNELS.resume, selectResume],
    [CHANNELS.interviewHistory, interview.history], [CHANNELS.interviewGet, interview.get],
    [CHANNELS.interviewStart, interview.start], [CHANNELS.interviewAnswer, interview.answer],
    [CHANNELS.interviewDelete, interview.delete], [CHANNELS.interviewDeleteAll, interview.deleteAll],
    [CHANNELS.interviewCancel, interview.cancel],
    [CHANNELS.aiStatus, ai.status], [CHANNELS.aiKey, ai.set], [CHANNELS.aiClear, ai.clear],
  ] as const) {
    ipcMain.handle(channel, (event, ...args: unknown[]): Result<unknown> | Promise<Result<unknown>> => {
      const frame = event.senderFrame;
      if (!window || event.sender !== window.webContents || !frame ||
          !isTrustedSender(frame.url, entry, frame === window.webContents.mainFrame)) {
        return { ok: false, error: { code: 'UNAUTHORIZED', message: '허용되지 않은 요청입니다.' } };
      }
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
    window.on('closed', () => { interview.cancelPending(); credentials.clearAll(); window = null; });
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

import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, type DesktopAPI, type Settings } from '../shared/contracts';
import type { DeleteAllInterviewsRequest, DeleteInterviewRequest, StartInterviewRequest, SubmitAnswerRequest } from '../shared/interview';
import type { AIKeyRequest, AIProvider } from '../shared/ai';

const api: DesktopAPI = Object.freeze({
  getSnapshot: () => ipcRenderer.invoke(CHANNELS.snapshot),
  updateSettings: (settings: Settings) => ipcRenderer.invoke(CHANNELS.settings, settings),
  selectResume: () => ipcRenderer.invoke(CHANNELS.resume),
  getInterviewHistory: () => ipcRenderer.invoke(CHANNELS.interviewHistory),
  getInterview: (id: string) => ipcRenderer.invoke(CHANNELS.interviewGet, id),
  startInterview: (request: StartInterviewRequest) => ipcRenderer.invoke(CHANNELS.interviewStart, request),
  submitInterviewAnswer: (request: SubmitAnswerRequest) => ipcRenderer.invoke(CHANNELS.interviewAnswer, request),
  cancelInterviewOperation: (id: string) => ipcRenderer.invoke(CHANNELS.interviewCancel, id),
  deleteInterview: (request: DeleteInterviewRequest) => ipcRenderer.invoke(CHANNELS.interviewDelete, request),
  deleteAllInterviews: (request: DeleteAllInterviewsRequest) => ipcRenderer.invoke(CHANNELS.interviewDeleteAll, request),
  getAIStatus: () => ipcRenderer.invoke(CHANNELS.aiStatus),
  configureAIKey: (request: AIKeyRequest) => ipcRenderer.invoke(CHANNELS.aiKey, request),
  clearAIKey: (request: { provider: AIProvider }) => ipcRenderer.invoke(CHANNELS.aiClear, request),
});
contextBridge.exposeInMainWorld('studio', api);

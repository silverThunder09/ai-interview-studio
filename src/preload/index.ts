import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, type DesktopAPI, type Settings } from '../shared/contracts';
import type { DeleteAllInterviewsRequest, DeleteInterviewRequest, StartInterviewRequest, SubmitAnswerRequest } from '../shared/interview';
import type { AIPreferences, AIKeyRequest, AIProvider } from '../shared/ai';
import type { VoiceRequest, VoiceStart } from '../shared/voice';
import type { SpeechRequest } from '../shared/speech';

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
  updateAIPreferences: (request: AIPreferences) => ipcRenderer.invoke(CHANNELS.aiPreferences, request),
  configureAIKey: (request: AIKeyRequest) => ipcRenderer.invoke(CHANNELS.aiKey, request),
  clearAIKey: (request: { provider: AIProvider }) => ipcRenderer.invoke(CHANNELS.aiClear, request),
  beginVoice: (request: VoiceStart) => ipcRenderer.invoke(CHANNELS.voiceBegin, request),
  stopVoice: (id: string) => ipcRenderer.invoke(CHANNELS.voiceStop, id),
  cancelVoice: (id: string) => ipcRenderer.invoke(CHANNELS.voiceCancel, id),
  transcribeVoice: (request: VoiceRequest) => ipcRenderer.invoke(CHANNELS.voiceTranscribe, request),
  getVoiceStatus: () => ipcRenderer.invoke(CHANNELS.voiceStatus),
  generateSpeech: (request: SpeechRequest) => ipcRenderer.invoke(CHANNELS.speechGenerate, request),
  cancelSpeech: (id: string) => ipcRenderer.invoke(CHANNELS.speechCancel, id),
  getSpeechStatus: () => ipcRenderer.invoke(CHANNELS.speechStatus),
});
contextBridge.exposeInMainWorld('studio', api);

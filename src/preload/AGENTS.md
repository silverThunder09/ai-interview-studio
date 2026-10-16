# Preload bridge

- renderer에는 기능별로 좁고 타입이 있는 API만 노출한다. 현재 계약은 `getSnapshot`과 `updateSettings`다.
- `ipcRenderer`, 범용 invoke/send, Node·파일·자격증명 접근을 그대로 노출하지 않는다.
- IPC 채널과 타입은 `src/shared` 계약을 사용한다. 검증의 최종 책임은 main에 둔다.
- sandbox에서 허용되는 Electron API만 사용하고 로컬 모듈은 CJS preload에 번들한다. sandbox를 끄는 우회는 금지한다.
- bridge 변경은 main handler·shared 계약·renderer 사용처를 함께 검토하고 실제 격리·IPC 실패 경로를 검증한다.

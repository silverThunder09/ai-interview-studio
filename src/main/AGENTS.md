# Electron main

- 앱 수명주기, OS 권한, 데이터·provider adapter는 main이 소유한다. UI 로직을 넣지 않는다.
- `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, `nodeIntegration: false`, `webviewTag: false`를 유지한다.
- IPC는 송신 창·메인 프레임·정확한 URL과 인수 개수·키·값을 검증한다. 임의 파일·shell·범용 URL API를 노출하지 않는다.
- production은 내부 `app://studio` 자산만 제공하고 개발 서버 환경변수를 무시한다. 자산 경로 whitelist와 CSP를 유지한다.
- 탐색·팝업·webview·다운로드·장치 권한은 현재 모두 거절한다. 기능 도입 시 승인된 데이터 흐름·동의·거절·종료 해제·보존/삭제를 먼저 설계한다.
- 설정은 MVP 0에서 메모리로만 유지한다. 개인정보·DB·AI·장치 기능을 선행 구현하지 않는다.
- 향후 API 자격증명은 main 경계의 OS 보호 저장을 우선 검토하고 renderer·로그·artifact에 노출하지 않는다.
- 보안 경계 변경 전 `harness/security.md`, 구조 변경 전 `harness/architecture.md`를 읽는다.
- 계약·권한·경로의 부정 테스트와 실제 Electron smoke로 관련 변경을 검증한다. OS sandbox 제한은 해제하지 말고 보고한다.

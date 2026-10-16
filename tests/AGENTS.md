# 검증

- 테스트는 사용자 동작과 신뢰 경계를 검증한다. 실제 개인정보 대신 합성 fixture·fake provider·모의 장치를 사용한다.
- `npm run check`: strict typecheck·lint·unit tests. `npm run build` 후 `npm run test:smoke`: 실제 Electron UI·IPC·sandbox·실패 경로.
- Linux smoke에는 display와 작동하는 OS sandbox가 필요하다. `chromiumSandbox: true`를 유지하고 `--no-sandbox`로 통과시키지 않는다. 환경 차단은 Windows CI 검증과 구분해 보고한다.
- 보안 변경에는 잘못된 입력·다른 창/프레임·권한 거절·리소스 해제·개인정보 노출 관련 실패 경로를 포함한다. 해당되지 않는 하드웨어 기능을 테스트 목적으로 구현하지 않는다.
- 패키지 smoke는 `SMOKE_EXECUTABLE`을 사용한다. packaged 실행이 개발 서버 환경변수를 무시하는지 확인한다.
- Electron이 탐색을 취소하면 Playwright의 navigation 추적이 남을 수 있다. 차단 이벤트와 Electron의 committed URL·실제 document 상태로 확인한다.
- 실패를 숨기거나 테스트를 삭제해 통과시키지 않는다. 모의 입력·CI 결과를 실제 Windows 사용자 기기·마이크·webcam 검증으로 보고하지 않는다.
- 영향에 맞는 검사 후 추가 변경·실패가 없으면 불필요한 반복 검증을 피한다.

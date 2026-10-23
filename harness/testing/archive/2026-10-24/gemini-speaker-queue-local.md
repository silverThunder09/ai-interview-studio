# Gemini 역할·3D 표시 승인 큐 — 로컬 검증

- 검사 코드: `da34ef287f1e6b8b1c567389327e3400fa4b41f3`, 기준 main `0e71a1be43a65c355970b1fc710a918be10f97db`.
- 실제 `npm run check` 종료0: TypeScript·ESLint·단위556개/29파일·정책41개 성공. `git diff --check` 통과.
- 설치된 설정을 읽는 큐 확장 검사로 완료된 5건의 receipt·bootstrap을 보존하고 정확히 두 queued 작업만 추가되며 재적용이 변경을 만들지 않는지 확인했다. 새 작업의 스펙 해시도 실제 파일과 대조했다.
- Gemini/avatar/desktop의 고정 smoke 명령 결과를 읽되 비정상 종료를 포함한 성공·명령 뒤 shell 삽입을 거절하는 결과 계약을 검사했다. 원래 전체 원본 reviews·SHA·CI 출처·실패 patch 거절·사람 변경 요청·sandbox·권한 승인 조건을 유지한다.
- 이번 코드는 승인 큐·실행 안내·스펙 단계 활성화이며 제품 기능은 후속 Cloud 작업에서 구현한다. 로컬 제품 build/smoke를 새로 실행한 결과가 아니며 실제 A→B 자동 구현·공식 결과 회수·원격 Windows/머지/main CI는 설치 후 별도 인수 항목이다.
- Legacy의 단위555·정책41·Electron2 성공은 사용자가 제공한 별도 후속 보고다. 여기의556개 결과와 합산하거나 자동 실행 증거로 바꾸지 않는다. 기본 실행 EPERM은 도구의 정식 확장 실행 권한에서 해소됐으며 승인 불가 시 보류한다. Chromium sandbox/TLS/proxy는 해제하지 않는다.
- 지난 Legacy 안내의 install-deps chromium만으로 GTK3가 포함된다는 전제는 부정확했다. 새 환경 준비는 고정 Playwright의 install-deps chromium firefox와 실제 Electron ldd의 not found 여부로 확인한다. 이 저장소 PR이 사용자의 환경 설정을 직접 편집하지는 않았다.
- 실제 개인 자료·유료 API·새 자격증명·권한 확대·release는 사용하지 않았다. 과거 검증 기록을 덮어쓰지 않는다.

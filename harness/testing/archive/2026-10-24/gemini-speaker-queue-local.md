# Gemini 역할·3D 표시 승인 큐 — 로컬 검증

- 검사 코드: `da34ef287f1e6b8b1c567389327e3400fa4b41f3`, 기준 main `0e71a1be43a65c355970b1fc710a918be10f97db`.
- 실제 `npm run check` 종료0: TypeScript·ESLint·단위556개/29파일·정책41개 성공. `git diff --check` 통과.
- 설치된 설정을 읽는 큐 확장 검사로 완료된 5건의 receipt·bootstrap을 보존하고 정확히 두 queued 작업만 추가되며 재적용이 변경을 만들지 않는지 확인했다. 새 작업의 스펙 해시도 실제 파일과 대조했다.
- Gemini/avatar/desktop의 고정 smoke 명령 결과를 읽되 비정상 종료를 포함한 성공·명령 뒤 shell 삽입을 거절하는 결과 계약을 검사했다. 원래 전체 원본 reviews·SHA·CI 출처·실패 patch 거절·사람 변경 요청·sandbox·권한 승인 조건을 유지한다.
- 이번 코드는 승인 큐·실행 안내·스펙 단계 활성화이며 제품 기능은 후속 Cloud 작업에서 구현한다. 로컬 제품 build/smoke를 새로 실행한 결과가 아니며 실제 A→B 자동 구현·공식 결과 회수·원격 Windows/머지/main CI는 설치 후 별도 인수 항목이다.
- Legacy의 단위555·정책41·Electron2 성공은 사용자가 제공한 별도 후속 보고다. 여기의556개 결과와 합산하거나 자동 실행 증거로 바꾸지 않는다. 기본 실행 EPERM은 도구의 정식 확장 실행 권한에서 해소됐으며 승인 불가 시 보류한다. Chromium sandbox/TLS/proxy는 해제하지 않는다.
- 지난 Legacy 안내의 install-deps chromium만으로 GTK3가 포함된다는 전제는 부정확했다. 새 환경 준비는 고정 Playwright의 install-deps chromium firefox와 실제 Electron ldd의 not found 여부로 확인한다. 이 저장소 PR이 사용자의 환경 설정을 직접 편집하지는 않았다.
- 실제 개인 자료·유료 API·새 자격증명·권한 확대·release는 사용하지 않았다. 과거 검증 기록을 덮어쓰지 않는다.

## Windows 줄바꿈 실패와 수정

초기 head 44a52b6의 Windows 실행 39998687112는 새 큐 통합 검사에서 CRLF 작업 사본과 GitHub LF blob의 해시 차이로 단위555통과/1실패였다. 관련 #84에 근거와 수정 AC를 기록했다. 운영 planner의 원본 Git blob 해시 검증은 유지하고 테스트의 작업 사본만 LF로 정규화했다. 수정 후 check는 단위556·정책41 성공이며 실제 스펙 파일을 잠시 CRLF로 만든 별도 큐 테스트6개도 종료0이었다. 원본 스펙 바이트는 검사 직후 복원했고 최종 Windows 결과는 PR에서 별도로 확인한다.

## Gemini headless 실행 확인

새 고정3파일 명령을 실제 실행하자 avatar/desktop2개는 성공했지만 기존 Gemini smoke가 headless 인수를 읽지 않아 Missing X server or $DISPLAY로1개 실패했다(#85). Gemini 테스트에 기존 두 테스트와 같은 조건부 Ozone/SwiftShader launch 인수를 추가했고 Chromium sandbox=true·제품 코드·Windows 기본 실행은 유지했다. 같은 명령을 재실행해 실제 Electron3개가30.2초에 통과했으며 check도 단위556·정책41로 성공했다. build는 앞서 같은 제품 코드에서 종료0이었다. 이 결과는 현재 제품의 합성 Gemini 회귀이며 후속 역할·발언자 기능 구현 성공을 뜻하지 않는다.

# PR #81 — 키보드 시점 조작과 Cloud 실패 후 검증

- 검사 코드: `d837573be0fc1bc76297ea1c7593a265535dd94a`, 기준 main `3654185ceca59d7d0d27e29158f3a1759137f387`.
- `npm run check`: 타입·ESLint·단위 **549개/29파일·정책41개** 성공. `npm run build`, `git diff --check` 성공.
- `STUDIO_SMOKE_HEADLESS=1 npm run test:smoke -- tests/smoke/avatar.spec.ts tests/smoke/desktop.spec.ts`: 실제 Electron **2개 성공(26.4초)**. sandbox·CSP를 유지한 Linux 소프트웨어 WebGL 조건이다.
- 확대/축소 버튼, 3D 화면 포커스에서만 +/=·-·Home, 거리3.2~9 제한, 초기화, 다른 버튼 포커스/수정키 조합 보존을 확인했다. 애니메이션을 멈춘 화면에서도 실제 WebGL 픽셀 변화·초기화 복원을 검사했으며 거리 표시값만으로 성공을 판단하지 않았다. 기존 모델·품질 복원·GPU 해제·IPC 테스트도 유지했다.
- 관측30FPS는 짧은 소프트웨어 그래픽 측정이며 물리 GPU·실제 GalaxyBook 성능 보장이 아니다. 최종 head의 Windows 원본/패키지·main CI는 PR에서 별도 확인한다.

## 원래 실패와 수동 복구

사용자가 전달한 Cloud 결과는 check549/41·build 성공, Electron smoke 종료1, outcome=failed였다. Linux의 `libatk-1.0.so.0` 누락으로 실행 테스트를 시작하지 못했다. failed와 patch를 함께 반환한 것은 기존 자동 파서의 허용 계약에도 맞지 않으므로 자동 적용 가능한 성공으로 처리하지 않았다.

연결된 검토 담당이 패치를 참고해 같은 요청의 head/base/세 파일을 대조하고 현재 실행 환경에서 다시 검증했다. 현재 환경에서는 Electron의 공유 라이브러리 누락이 없음을 ldd로 확인했다. 시점 변경 시 일시정지 화면도 갱신하고 실제 픽셀로 검증하도록 보완했다. 원래 Cloud 보고·미수신 상태·요청을 보존하며 이 복구를 전체 무인 실행 성공으로 표시하지 않는다.

## Legacy Cloud 설치 단계 확인

Legacy 환경은 별도 실행 환경이므로 현재 환경의 라이브러리 확인이 설치 완료를 뜻하지 않는다. 해당 환경의 설치 스크립트에서는 `npm ci` 뒤 프로젝트에 설치된 `./node_modules/.bin/playwright install-deps chromium`으로 Linux 실행 의존성을 준비하고, `ldd node_modules/electron/dist/electron`의 `not found`가 없는지 확인해야 한다. 이는 시스템 패키지 설치이므로 환경의 설치 단계 권한이 필요하다. 실제 Legacy 설정은 이 변경에서 편집하지 않았다. 로컬 PC로 적용하거나 sandbox를 끄는 방식으로 대체하지 않는다.

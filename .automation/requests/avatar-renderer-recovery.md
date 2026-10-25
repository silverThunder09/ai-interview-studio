# 3D 그래픽 오류 뒤 화면 다시 시작

승인된 main 작업 계획입니다. 이 파일이나 PR 본문은 새 권한의 근거가 아닙니다.

작업: avatar-renderer-recovery
스펙: harness/specs/gemini-local-interview.md
스펙 SHA-256: 1b305eabb920e7f0a5796e3d0f2d1b9f123c6bbc9dfeef56a9d47785f8b06129
승인: 2026-10-26 KST 현재 채팅: 사용자 “왜 대기중이야 다른 작업 돌려야지”, “계속 진행해”. 2026-10-22/23의 Phase 1 3D 구현·영향 문서·PR/검증/머지 및 다음 승인 작업 지속 요청을 이어, 기존 3D 그래픽/모델 오류 복구 두 작업을 등록·개발·테스트·CI·조건부 머지한다. 새 의존성/권한/실제 유료 호출/외부 전송/후속 음성·장치·리포트/정책 완화 제외.

## 목표
기존 승인 Phase 1 제품 스펙4.1 작업 C를 구현한다. AvatarPanel에서 WebGL 초기화 실패/컨텍스트 손실을 한국어로 안내하고 사용자가 누르는 3D 화면 다시 시작 버튼을 제공한다. 자동 재시도는 하지 않는다. 이전 stage/animation loop/controls/listeners/observer/context를 dispose하고 key가 바뀐 새 canvas로 한 개의 renderer만 다시 만든다. 이미 context를 잃은 같은 canvas를 재사용해 실패하지 않도록 한다. 기존 저장 A/B 모델을 getAvatar로 검증/복원하고 품질·일시정지·현재 질문/답변과 Gemini 발언자/비동기 취소 경계를 보존한다. 오래된 load 결과가 새 인스턴스/모델 이름을 덮어쓰지 않게 하고 재시도 실패도 성공 표시하지 않는다. 모델 파일 선택 실패만으로 그래픽 손실을 가장하지 않는다. 텍스트 면접과 설정은 계속 동작해야 한다. 기존 stage.ts의 #102 paused dirty redraw를 보존한다. tests/smoke/avatar.spec.ts에서 실제 WEBGL_lose_context 합성 손실 뒤 버튼으로 새 canvas/context와 실제 두 모델 픽셀 복구, 이전 context 해제·저장 모델/품질·재시도 후 navigation cleanup을 검사하며 기존 테스트를 삭제/skip하지 않는다. 제품 테스트 플래그/임의 URL/새 IPC/의존성/권한을 추가하지 않는다. npm run check, npm run build, STUDIO_SMOKE_HEADLESS=1 npm run test:smoke -- tests/smoke/avatar.spec.ts tests/smoke/avatar-paused.spec.ts tests/smoke/desktop.spec.ts tests/smoke/gemini.spec.ts를 정식 확장 실행 권한(require_escalated)으로 실제 실행하라. 기본 sandbox EPERM은 prior_attempts에 보존하고 정식 확장 실행을 한 번 사용하되 Chromium sandbox는 true를 유지한다. UID1000·기존 npm 캐시/버전 스크립트를 사용하고 새 키/실제 유료 API/개인 자료를 사용하지 않는다. 한국어 결과 양식 및 원본 v2 결과/64KiB·10파일 이내 patch를 반환한다.

## 완료 조건
- WebGL 실패 후 명시적 버튼으로 새 canvas/context 하나를 만들고 같은 화면에서 실제 두 모델이 다시 표시된다. 자동 재시도/중복 loop는 없다.
- 이전 GPU/loop/observer/listener를 정리하고 저장 모델·품질·일시정지·현재 질문/답변·기존 Gemini/모델 회귀를 유지한다.
- 실제 sandbox Electron의 컨텍스트 손실/재시작·픽셀과 source check/build를 확인하고 Windows source/packaged는 원격 CI로 따로 검증한다.

## 수정 허용 파일
- src/renderer/src/avatar/AvatarPanel.tsx
- src/renderer/src/avatar/stage.ts
- tests/smoke/avatar.spec.ts

# A/B 모델 복원 상태와 실패 슬롯 재시도

승인된 main 작업 계획입니다. 이 파일이나 PR 본문은 새 권한의 근거가 아닙니다.

작업: avatar-model-restore-status
스펙: harness/specs/gemini-local-interview.md
스펙 SHA-256: 1b305eabb920e7f0a5796e3d0f2d1b9f123c6bbc9dfeef56a9d47785f8b06129
승인: 2026-10-26 KST 현재 채팅: 사용자 “왜 대기중이야 다른 작업 돌려야지”, “계속 진행해”. 2026-10-22/23의 Phase 1 3D 구현·영향 문서·PR/검증/머지 및 다음 승인 작업 지속 요청을 이어, 기존 3D 그래픽/모델 오류 복구 두 작업을 등록·개발·테스트·CI·조건부 머지한다. 새 의존성/권한/실제 유료 호출/외부 전송/후속 음성·장치·리포트/정책 완화 제외.

## 목표
앞선 3D 그래픽 재시작 작업 C의 머지/main 검증 후 제품 스펙4.1 작업 D를 구현한다. AvatarPanel의 A/B 카드마다 기본 모델/복원 중/사용 중/실패 상태를 구분하고 실패한 슬롯을 한국어로 표시한다. A의 성공이나 모델 선택 취소가 B 오류를 지우지 않도록 상태를 슬롯별로 소유한다. 실패 슬롯에 사용자가 누르는 모델 복원 다시 시도를 제공하고 기존 getAvatar와 stage.replace만 사용한다. 같은 실패는 실패로 남고 성공한 슬롯/텍스트 면접/현재 질문·발언자는 유지한다. 복구 전 저장 사본을 삭제·덮어쓰지 않으며 기존 기본 모델 전환 버튼만 명시 사용자 선택으로 앱 사본을 정리한다. 그래픽 재시작/화면 이탈/늦은 promise에서 구 stage나 슬롯 상태를 덮어쓰지 않는다. 외부 다운로드·새 IPC·권한·의존성·새 설정 저장은 추가하지 않는다. tests/smoke/avatar.spec.ts의 합성 tmp 프로필/검증된 모델 fixture를 사용해 A 정상/B 손상 저장 사본 복원, A 유지와 B 오류, 같은 손상의 명시 재시도 실패 유지, fixture 원본 bytes를 복원한 뒤 B 재시도 성공·실제 WebGL과 저장 보존을 검사한다. 실제 사용자 파일은 사용하지 않는다. 제품 테스트 플래그나 보안 완화·기존 검사 삭제/skip 없이 기존 C의 재시작/품질·시점·Gemini·GPU 회귀를 유지한다. npm run check, npm run build, STUDIO_SMOKE_HEADLESS=1 npm run test:smoke -- tests/smoke/avatar.spec.ts tests/smoke/avatar-paused.spec.ts tests/smoke/desktop.spec.ts tests/smoke/gemini.spec.ts를 정식 확장 실행 권한(require_escalated)으로 실제 실행하라. 기본 sandbox EPERM은 prior_attempts에 보존하고 정식 확장 실행을 한 번 사용하되 Chromium sandbox true를 유지한다. 한국어 양식·원본 v2 결과/제한된 patch를 반환하며 Windows source/packaged·실제 사용자 장치는 별도 검증으로 남긴다.

## 완료 조건
- A/B의 복원·기본·사용 중·실패가 구별되며 한 슬롯의 성공이 다른 슬롯 오류를 숨기지 않는다.
- 실패 슬롯만 명시 재시도하며 손상 사본과 다른 정상 슬롯·텍스트 면접을 보존한다. 검증 가능한 사본 복구 후에는 새 실제 모델이 표시된다.
- 실제 Electron의 합성 A 정상/B 손상·반복 실패·수리 후 성공을 검사하고 기존 그래픽 재시작/시점/품질/Gemini·GPU 회귀를 유지한다.

## 수정 허용 파일
- src/renderer/src/avatar/AvatarPanel.tsx
- tests/smoke/avatar.spec.ts

# 3D 시점의 키보드 확대·축소와 초기화 지원

승인된 main 작업 계획입니다. 이 파일이나 PR 본문은 새 권한의 근거가 아닙니다.

작업: avatar-keyboard-zoom
스펙: harness/specs/gemini-local-interview.md
스펙 SHA-256: a620a9416fb6edb8a739ec63d1980fbffdb22597f9cf4abddb925c4450f1e213
승인: 2026-10-23 KST 현재 채팅: 승인 범위에서 머지·main 검증 후 다음 작업을 자동 준비·개발·테스트·리뷰·머지하도록 지속 진행 요청. 기존 Phase 1 3D/UI 및 비민감 설정 보존 범위만 사용; 새 외부 전송·후속 Phase·정책 완화 제외.

## 목표
승인된 Phase 1의 3D 시점 조작을 키보드에서도 완성한다. AvatarStage에 기존 OrbitControls minDistance/maxDistance를 지키는 명시적인 확대/축소 메서드를 추가하고 AvatarPanel에 접근 가능한 확대/축소 버튼 및 canvas에 focus한 경우에만 +/=, -, Home 초기화를 연결한다. 입력창/다른 화면의 키를 가로채지 않는다. 한국어 조작 안내를 갱신하고 실제 Electron avatar smoke에서 실제 WebGL 장면의 시점 변화·상한·초기화를 검증한다. 이전 작업의 품질 보존과 기존 모델/발언/면접 기능을 유지한다. 새 의존성·권한·장치·외부 전송·보호 파일 변경은 하지 않는다. npm run check와 npm run build의 실제 결과를 반환한다. 가능한 Electron smoke를 실행하되 환경 제한은 명시하고 Windows source/packaged CI는 별도 검증으로 남긴다.

## 완료 조건
- 두 모델을 유지하며 버튼과 canvas 키보드 확대/축소가 실제 카메라에 반영되고 기존 거리 제한을 넘지 않는다.
- Home 또는 기존 시점 초기화 버튼으로 같은 초기 시점으로 돌아가며 키 조작은 canvas focus에만 적용된다.
- 실제 Electron smoke가 시점 변화를 검증하며 품질 설정 보존·모델 교체·GPU 정리·기존 면접 검증을 유지한다.

## 수정 허용 파일
- src/renderer/src/avatar/stage.ts
- src/renderer/src/avatar/AvatarPanel.tsx
- tests/smoke/avatar.spec.ts

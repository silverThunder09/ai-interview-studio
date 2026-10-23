# 3D 화면의 렌더링 품질 설정 보존

승인된 main 작업 계획입니다. 이 파일이나 PR 본문은 새 권한의 근거가 아닙니다.

작업: avatar-quality-preference
스펙: harness/specs/gemini-local-interview.md
스펙 SHA-256: a620a9416fb6edb8a739ec63d1980fbffdb22597f9cf4abddb925c4450f1e213
승인: 2026-10-23 KST 현재 채팅: 승인 범위에서 머지·main 검증 후 다음 작업을 자동 준비·개발·테스트·리뷰·머지하도록 지속 진행 요청. 기존 Phase 1 3D/UI 및 비민감 설정 보존 범위만 사용; 새 외부 전송·후속 Phase·정책 완화 제외.

## 목표
승인된 Phase 1 3D 화면의 렌더링 품질(low/standard)만 이 PC에서 화면 이동·앱 재시작 뒤 복원하도록 구현한다. AvatarPanel의 버전 있는 작은 localStorage UI 설정을 엄격히 검증한다. API 키·모델·이력서·면접·동의·일시정지/발언 상태는 저장하거나 변경하지 않는다. 별도 의존성·IPC·권한·외부 호출·보호 파일 변경은 하지 않는다. 기존 Electron avatar smoke에 실제 선택·화면 재진입·프로필 재시작 복원 및 손상/저장 접근 실패 경로 검증을 추가한다. 기존 검증을 삭제/skip하지 않고 npm run check와 npm run build를 실행한 실제 결과를 반환한다. 가능한 Electron smoke를 실행하되 환경 제한은 명시하고 Windows source/packaged CI는 별도 검증으로 남긴다.

## 완료 조건
- 처음 실행과 손상/알 수 없는 버전의 설정은 경량(low)을 사용하며 정상 standard 선택은 화면 이동·동일 앱 프로필 재시작 뒤 복원한다.
- 저장 API가 거절돼도 3D·텍스트 면접이 동작하고 저장 실패를 성공으로 안내하지 않는다.
- 실제 Electron smoke에서 UI 선택과 재시작 복원을 검증하고 기존 두 모델·GPU 정리·면접 회귀 검증을 유지한다.

## 수정 허용 파일
- src/renderer/src/avatar/AvatarPanel.tsx
- tests/smoke/avatar.spec.ts

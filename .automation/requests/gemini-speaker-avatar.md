# Gemini 발언자와 3D 면접관·질문 표시 연결

승인된 main 작업 계획입니다. 이 파일이나 PR 본문은 새 권한의 근거가 아닙니다.

작업: gemini-speaker-avatar
스펙: harness/specs/gemini-local-interview.md
스펙 SHA-256: 0f4467e79fb23e45e721256f93d7c88f40b78e4299f2cf818b44eb5cc265f1e7
승인: 2026-10-24 KST 현재 채팅: #35의 Gemini 역할·검증 발언자 ID 작업 A와 3D/UI 표시 연결 작업 B 두 작업을 승인 큐에 등록해 구현·테스트·PR·CI·조건부 머지 및 A 뒤 B 자동 재개를 검증하는 제안에 사용자 “승인할게”. 기존 전송 데이터/키/요청·시간·토큰 한도 유지, 합성 검증만 사용, 공유 문맥·음성·웹캠·리포트·실제 유료 호출·새 인증/권한/정책 완화 제외.

## 목표
앞선 Gemini 역할·발언자 작업이 머지되고 main CI가 검증된 뒤 제품 스펙 3.1의 작업 B를 구현한다. InterviewWorkspace의 새 Gemini 질문은 검증된 question.speakerId를 AvatarRoom/AvatarPanel의 실제 활성 슬롯과 한국어 현재 면접관 역할 표시에 우선 연결한다. B 경험→B 후속→A 기술→A 후속이 같은 질문/3D 강조에 표시돼야 한다. 새 값은 기존 공유 계약을 사용하며 추정 ID로 잘못된 API 결과를 성공 처리하지 않는다. ID 없는 과거/다른 공급자/로컬 질문은 기존 kind 기반 표시, 면접 완료는 active=null을 유지한다. 역할 표시는 질문/저장 기록 재열기에서도 실제 질문과 맞고 비동기 실패/취소 시 기존 질문/입력/강조를 유지한다. 필요하면 canvas에 실제 stage 활성 상태를 반영하는 작은 관측 속성을 제공하되 테스트가 그 속성만 자가 검증하지 않도록 질문·역할/UI와 실제 WebGL 준비를 함께 확인한다. tests/smoke/gemini.spec.ts에서 main fetch를 합성 Gemini로 바꾸고 B/B/A/A 응답·잘못된 발언자 뒤 입력/질문 보존·기록 재열기를 검사하며 실제 Google 호출·제품 테스트 플래그를 추가하지 않는다. 기존 avatar의 모델/품질/시점/GPU·키/동의·실패 회귀를 삭제/skip하지 않는다. 같은 허용 경로 안에서 headless launch가 필요하면 기존 avatar/desktop 방식을 재사용하고 Chromium sandbox를 유지한다. npm run check, npm run build 및 허용된 Gemini/avatar/desktop 관련 smoke를 정식 확장 실행 권한으로 실제 실행하고 한국어 양식과 원본 v2 결과/제한된 UTF-8 patch를 반환한다. TTS/립싱크/웹캠·새 키/의존성/전송 범위/요청/권한/보호 파일은 변경하지 않는다.

## 완료 조건
- 검증된 Gemini speakerId가 질문·한국어 면접관 역할·3D 활성 슬롯에 일치하고 후속 질문도 같은 발언자로 표시된다.
- ID 없는 과거/다른 공급자/로컬 질문과 완료 화면·실패/취소·기록 복원을 보존하며 새로운 전송·호출을 만들지 않는다.
- 실제 sandbox Electron 합성 Gemini에서 B/B/A/A 진행·잘못된 ID 뒤 보존·기록 재열기와 기존 avatar 회귀를 확인한다.

## 수정 허용 파일
- src/renderer/src/InterviewWorkspace.tsx
- src/renderer/src/avatar/AvatarPanel.tsx
- tests/smoke/gemini.spec.ts
- tests/smoke/avatar.spec.ts

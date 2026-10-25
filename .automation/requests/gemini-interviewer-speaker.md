# Gemini 기술·경험 면접관 역할과 발언자 검증

승인된 main 작업 계획입니다. 이 파일이나 PR 본문은 새 권한의 근거가 아닙니다.

작업: gemini-interviewer-speaker
스펙: harness/specs/gemini-local-interview.md
스펙 SHA-256: 0f4467e79fb23e45e721256f93d7c88f40b78e4299f2cf818b44eb5cc265f1e7
승인: 2026-10-24 KST 현재 채팅: #35의 Gemini 역할·검증 발언자 ID 작업 A와 3D/UI 표시 연결 작업 B 두 작업을 승인 큐에 등록해 구현·테스트·PR·CI·조건부 머지 및 A 뒤 B 자동 재개를 검증하는 제안에 사용자 “승인할게”. 기존 전송 데이터/키/요청·시간·토큰 한도 유지, 합성 검증만 사용, 공유 문맥·음성·웹캠·리포트·실제 유료 호출·새 인증/권한/정책 완화 제외.

## 목표
main 제품 스펙 3.1의 작업 A를 기존 경로에 구현한다. src/main/ai-question-provider.ts와 external-ai.ts의 Gemini 경로에만 A 기술(엄격·논리) / B 경험·협업(차분·근거 중심) 역할을 연결한다. 현재 질문 순서(최초 experience B, technical A, follow-up은 직전 역할)를 유지하고 실제 요청한 speakerId(a/b)를 Gemini 응답 JSON schema/근거 snapshot과 함께 엄격히 검증해 QuestionDraft/InterviewQuestion에 보존한다. 누락·다른 역할·알 수 없는 값·허용 밖 필드는 INVALID_RESPONSE이며 실패/취소 시 기존 답변·한도·중복 제어를 보존한다. isInterviewQuestion은 선택적 speakerId를 검증하되 ID 없는 과거 기록·OpenAI/Claude/로컬 질문을 유지한다. 질문 JSON 저장 구조를 재사용하고 DB migration·공유 문맥·전체 이력서/이전 대화·API 추가 호출·UI·보호 파일은 변경하지 않는다. 기존 단일 Gemini 키·선택 구절/직전 답변만 전송·12문항/36요청/600출력토큰/30초를 유지한다. tests/unit의 provider/adapter/SQLite 기록 복원·잘못된 ID/취소/중복·다른 공급자 회귀와 tests/smoke/gemini.spec.ts의 합성 응답을 새 schema에 맞춰 실제 검증한다. 기존 검사를 삭제/skip하지 않고 필요하면 해당 smoke에 기존 avatar/desktop과 같은 Linux headless launch 설정을 재사용하되 chromiumSandbox:true를 유지한다. npm run check, npm run build 및 허용된 Gemini/avatar/desktop 관련 smoke를 실제 실행한다. 명령은 제공된 정식 확장 실행 권한으로 수행하고 도구 승인을 우회하지 않는다. 실제 개인 자료·유료 API는 호출하지 않는다. 결과는 한국어 양식·원본 v2 JSON과 64KiB/10파일 이내 UTF-8 patch로 반환하며 실패/blocked에는 patch를 넣지 않는다.

## 완료 조건
- Gemini 최초 경험 B와 기술 A·각 후속 질문의 요청 역할이 응답/저장 JSON의 speakerId와 일치하며 잘못된 ID는 답변 저장 전에 거절한다.
- 같은 Gemini 키·기존 전송 범위·한도를 유지하고 OpenAI/Claude/로컬·ID 없는 SQLite 과거 기록을 복원한다.
- 합성 provider/adapter·저장·실패/취소/중복 검사와 실제 Gemini Electron 회귀를 통과하고 원격 Windows source/packaged는 별도 CI로 확인한다.

## 수정 허용 파일
- src/shared/interview.ts
- src/main/ai-question-provider.ts
- src/main/external-ai.ts
- tests/unit/ai-question-provider.test.ts
- tests/unit/external-ai.test.ts
- tests/unit/interview.test.ts
- tests/unit/interview-service.test.ts
- tests/smoke/gemini.spec.ts

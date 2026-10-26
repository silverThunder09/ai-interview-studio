# 동의한 공유 문맥과 A/B 교대·질문 중복 제어

승인된 main 작업 계획입니다. 이 파일이나 PR 본문은 새 권한의 근거가 아닙니다.

작업: gemini-context-turns
스펙: harness/specs/gemini-local-interview.md
스펙 SHA-256: d310364e58aefa2ef152376bb7c55a09ee38c9464896c8589450f666e89c473d
승인: 2026-10-26 KST 현재 채팅: 로드맵 순서의 사용량 기록/복원/표시 → 공유 문맥 범위/미리보기/동의 → A/B 교대/꼬리질문/중복 방지 → 성격 설정/보존 및 문서 현행화·승인 큐 등록 제안에 사용자 “ㄱㄱ”. 네 작업의 구현·테스트·PR·CI/AI 검토·조건부 자동 머지/main 검증과 다음 작업 연결 승인. 기존 한도·보안·사람 리뷰 유지, 합성 검증만 사용; 새 workflow/권한/의존성/키/실제 유료 호출/음성·장치·리포트·에셋 제외.

## 목표
F 머지/main 검증 뒤 스펙3.2 G를 구현한다. 별도 동의와 main 재생성 hash가 일치할 때만 기존 Gemini 요청 하나에 제한 history를 전송하고 opts-out/과거/다른 공급자의 기존 전송 범위를 유지한다. 같은 canonical 객체로 preview/실제payload를 결합해 입력/질문/프로필 변경 시 HTTP0으로 거절한다. 최초 구절 동의와 매 답변 완료 버튼을 유지한다. 12문항 기본 B경험/B후속/A기술/A후속 쌍을3회 반복하도록 Gemini main 역할/kind 조정과 응답 speakerId·허용 근거를 함께 검증한다. 후속은 직전역할, B경험은 기존선택근거, A기술은evidence=null을 사용한다. 현재세션의 제한된 이전질문과 공백정규화 후 완전히 같은 질문은 INVALID_RESPONSE로 거절하고 입력/저장/usage를 일관되게 보존한다. 의미중복전체판정이나 자동 재생성은 하지 않는다. 자동재시도/추가 모델/서비스/요약호출 없이 기존12문항/36요청/1500질문자/600출력토큰/30초·8000data상한·원자저장/취소를 유지한다. 합성payload가 preview와byte일치, 동의없음/낡음의 history미전송, B/B/A/A 반복·잘못된역할·중복질문·취소/동시/재열기·OpenAI/Claude/로컬 회귀와 Electron 질문/3D/한도/usage를 검증한다. 기존 검사를 삭제/skip하지 말고 npm run check, npm run build, bash scripts/codex/smoke.sh, git diff --check를 정식 확장 실행 권한(require_escalated)으로 실제 실행한다. Chromium sandbox=true·TLS/proxy·기존 키/호출/출력/시간 한도를 유지한다. 실제 외부 API/개인 자료는 사용하지 않는다. 실패/미실행을 성공으로 표시하지 말고 한국어 양식과 renderDevelopmentResult의 ASCII JSON/원본 diff를 그대로 반환한다. Windows source/packaged와 실제 장치는 별도 원격/수동 검증으로 남긴다.

## 완료 조건
- 별도 동의한 현재 snapshot만 기존 Gemini 단일요청에 들어가고 동의없음/변경/과거/다른 공급자로 공유 history가 새지 않는다.
- B/B/A/A3쌍과 speaker/kind/근거가 일치하며 동일 질문은 추가 자동호출 없이 거절하고 답변·usage·저장 원자성을 보존한다.
- 실제 Electron 합성Gemini와 단위/Windows CI가 기존3D/기록/요청·길이·시간/공급자 회귀를 유지한다.

## 수정 허용 파일
- src/shared/interview.ts
- src/main/ai-question-provider.ts
- src/main/external-ai.ts
- src/main/interview-service.ts
- src/main/interview-store.ts
- src/renderer/src/InterviewWorkspace.tsx
- tests/unit/ai-question-provider.test.ts
- tests/unit/external-ai.test.ts
- tests/unit/interview-service.test.ts
- tests/smoke/gemini.spec.ts

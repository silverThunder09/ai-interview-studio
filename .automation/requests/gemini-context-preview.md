# 공유 문맥의 제한된 미리보기와 동의 계약

승인된 main 작업 계획입니다. 이 파일이나 PR 본문은 새 권한의 근거가 아닙니다.

작업: gemini-context-preview
스펙: harness/specs/gemini-local-interview.md
스펙 SHA-256: d310364e58aefa2ef152376bb7c55a09ee38c9464896c8589450f666e89c473d
승인: 2026-10-26 KST 현재 채팅: 로드맵 순서의 사용량 기록/복원/표시 → 공유 문맥 범위/미리보기/동의 → A/B 교대/꼬리질문/중복 방지 → 성격 설정/보존 및 문서 현행화·승인 큐 등록 제안에 사용자 “ㄱㄱ”. 네 작업의 구현·테스트·PR·CI/AI 검토·조건부 자동 머지/main 검증과 다음 작업 연결 승인. 기존 한도·보안·사람 리뷰 유지, 합성 검증만 사용; 새 workflow/권한/의존성/키/실제 유료 호출/음성·장치·리포트·에셋 제외.

## 목표
E 머지/main 검증 뒤 스펙3.2 F만 구현한다. main의 현재 DB/질문/입력으로 선택구절180자·최근완료QA2개(질문500/답변1000자)·이번답변2000자만 뽑는다. shared history JSON4000자/최종data JSON8000자(UTF16) 상한, 명시 발췌 안내, 범위초과 거절을 공통 순수 계약으로 만든다. 전체 원문/연락처/경로/원본 음성·영상 자동 포함·원격 요약/캐시는 금지한다. 좁은 preview IPC를 기존 정확한 창/프레임/URL·인자 검증과 함께 등록하고 preview는 HTTP0회여야 한다. canonical payload hash를 세션/현재질문/답변/역할 snapshot에 결합해 전달하며 renderer가 만든 대화목록을 신뢰하지 않는다. UI에 실제 내용과 범위/발췌/전송 목적을 보여주고 입력/세션/질문/프로필 변경·이탈/재열기에서 체크를 무효화한다. 동의는 저장하지 않는다. F는 미리보기 계약만 제공하고 공유 전송 활성화는 G에 맡긴다. 연결 전 UI를 전송 활성화로 오인시키지 않고 기존 선택구절/직전답변 제출을 유지한다. 합성 단위/Electron에서 최근2개 선택/경계길이/손상입력/낡은snapshot/다른세션/재시작 동의미복원·preview의 네트워크0을 확인한다. 사용량/기록/취소 회귀를 유지한다. 기존 검사를 삭제/skip하지 말고 npm run check, npm run build, bash scripts/codex/smoke.sh, git diff --check를 정식 확장 실행 권한(require_escalated)으로 실제 실행한다. Chromium sandbox=true·TLS/proxy·기존 키/호출/출력/시간 한도를 유지한다. 실제 외부 API/개인 자료는 사용하지 않는다. 실패/미실행을 성공으로 표시하지 말고 한국어 양식과 renderDevelopmentResult의 ASCII JSON/원본 diff를 그대로 반환한다. Windows source/packaged와 실제 장치는 별도 원격/수동 검증으로 남긴다.

## 완료 조건
- main이 만든 최근2개/선택구절/이번답변의 정확한 제한 내용과 digest를 preview로 보여주며 원문전체/원격호출이 없다.
- JSON 크기·이전 질문/입력·세션 불일치를 거절하고 동의가 저장/재시작·재열기로 복원되지 않는다.
- 새 preview IPC가 기존 Electron 보안·한정 계약을 유지하고 기존 답변/사용량/3D 경로가 통과한다.

## 수정 허용 파일
- src/shared/interview.ts
- src/shared/contracts.ts
- src/main/interview-handlers.ts
- src/main/interview-service.ts
- src/main/index.ts
- src/preload/index.ts
- src/renderer/src/InterviewWorkspace.tsx
- tests/unit/interview-service.test.ts
- tests/unit/interview.test.ts
- tests/smoke/gemini.spec.ts

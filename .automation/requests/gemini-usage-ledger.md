# Gemini 사용량 기록·복원과 세션별 표시

승인된 main 작업 계획입니다. 이 파일이나 PR 본문은 새 권한의 근거가 아닙니다.

작업: gemini-usage-ledger
스펙: harness/specs/gemini-local-interview.md
스펙 SHA-256: d310364e58aefa2ef152376bb7c55a09ee38c9464896c8589450f666e89c473d
승인: 2026-10-26 KST 현재 채팅: 로드맵 순서의 사용량 기록/복원/표시 → 공유 문맥 범위/미리보기/동의 → A/B 교대/꼬리질문/중복 방지 → 성격 설정/보존 및 문서 현행화·승인 큐 등록 제안에 사용자 “ㄱㄱ”. 네 작업의 구현·테스트·PR·CI/AI 검토·조건부 자동 머지/main 검증과 다음 작업 연결 승인. 기존 한도·보안·사람 리뷰 유지, 합성 검증만 사용; 새 workflow/권한/의존성/키/실제 유료 호출/음성·장치·리포트·에셋 제외.

## 목표
제품 스펙3.2 E만 구현한다. 기존 Gemini generateContent usageMetadata의 알려진5개 토큰 필드를 비음수 안전정수/unknown으로 정규화하고 원문/키/질문·답변을 ledger에 넣지 않는다. 실제 요청 시도별 ID로 중복을 막고, 같은 in-flight는1회·수동 재시도는별도·실패/취소/timeout은기존36요청예산에 포함한다. session 생성 전 실패도 성공 세션으로 위장하지 않고 제한된 비민감 요청 이력으로 귀속한다. schema2→3의 보존형 usage ledger·원자 migration/rollback·schema1/2 과거/다른 공급자 호환·3600행 상한과 명시 세션/전체 삭제 연계를 구현한다. 네트워크 await 동안 DB transaction을 열어두지 않는다. 초기 실패의 미연결 이력은 명시 전체 삭제로만 정리하며 저장 실패/상한은 요청 전에 알려 숨기지 않는다. InterviewSession의 선택적 usage 계약과 현재 세션/기록 재열기 표시를 연결한다. 누락=0/무료로 표시하지 않고 제공분/누락/시도 수를 구분하며 캐시/thinking을 이중 합산하거나 금액/청구액을 추정하지 않는다. 앱 재시작 시 기존 실행당 요청 예산 의미를 바꾸지 않는다. 허용 테스트에서 직접 provider/adapter/SQLite 성공·누락/손상 수치·실패/취소/중복·재시작·migration rollback·삭제·다른 공급자 회귀와 합성 Gemini Electron 표시/복원을 검증한다. 공유 문맥·새 요청·실제 요금조회·다른 파일을 추가하지 않는다. 기존 검사를 삭제/skip하지 말고 npm run check, npm run build, bash scripts/codex/smoke.sh, git diff --check를 정식 확장 실행 권한(require_escalated)으로 실제 실행한다. Chromium sandbox=true·TLS/proxy·기존 키/호출/출력/시간 한도를 유지한다. 실제 외부 API/개인 자료는 사용하지 않는다. 실패/미실행을 성공으로 표시하지 말고 한국어 양식과 renderDevelopmentResult의 ASCII JSON/원본 diff를 그대로 반환한다. Windows source/packaged와 실제 장치는 별도 원격/수동 검증으로 남긴다.

## 완료 조건
- 정상/누락/잘못된 Gemini usage와 요청 시도·중복·실패/취소를 구분하고 실제 없는 토큰을0/가격으로 만들지 않는다.
- 기존 SQLite 기록·request hash를 보존한 schema3 migration/rollback·세션/전체 삭제·재시작 복원이 검증된다.
- 세션의 제공 사용량/unknown/시도 수가 실제 Electron에서 표시·재조회되며 기존 답변/한도/다른 공급자를 유지한다.

## 수정 허용 파일
- src/shared/interview.ts
- src/main/external-ai.ts
- src/main/ai-question-provider.ts
- src/main/interview-service.ts
- src/main/interview-store.ts
- src/renderer/src/InterviewWorkspace.tsx
- tests/unit/external-ai.test.ts
- tests/unit/interview-service.test.ts
- tests/unit/interview.test.ts
- tests/smoke/gemini.spec.ts

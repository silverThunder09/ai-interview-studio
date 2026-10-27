# 면접관별 성격 프리셋과 로컬 설정 보존

승인된 main 작업 계획입니다. 이 파일이나 PR 본문은 새 권한의 근거가 아닙니다.

작업: gemini-personality-presets
스펙: harness/specs/gemini-local-interview.md
스펙 SHA-256: d310364e58aefa2ef152376bb7c55a09ee38c9464896c8589450f666e89c473d
승인: 2026-10-26 KST 현재 채팅: 로드맵 순서의 사용량 기록/복원/표시 → 공유 문맥 범위/미리보기/동의 → A/B 교대/꼬리질문/중복 방지 → 성격 설정/보존 및 문서 현행화·승인 큐 등록 제안에 사용자 “ㄱㄱ”. 네 작업의 구현·테스트·PR·CI/AI 검토·조건부 자동 머지/main 검증과 다음 작업 연결 승인. 기존 한도·보안·사람 리뷰 유지, 합성 검증만 사용; 새 workflow/권한/의존성/키/실제 유료 호출/음성·장치·리포트·에셋 제외.

## 목표
G 머지/main 검증 뒤 스펙3.2 H만 구현한다. A strict/balanced, B calm/supportive의 검증된 enum 프리셋만 제공하고 자유명령/루브릭/목소리/새 모델을 추가하지 않는다. 기존 비민감 preferences·좁은 설정 API와 버전/누락 기본값·저장실패 안내를 재사용하고 API키 OS보호/공급자모델/3D품질을 보존한다. 새 면접의 ai config에 허용 profile snapshot을 저장해 기록 재열기·실제 Gemini고정역할 prompt·한국어 설정/현재역할 표시가 일치하도록 한다. 진행중/과거세션을 전역설정으로 다시쓰지 않고 오래된 config/request hash를 보존한다. 같은 실제 프로필 값이 공유 preview/hash에 포함되도록 하며 변경/재시작은 전송동의를 복원하지 않는다. 설정된 말투가 문서/사용자내용보다 우선하는 system 안전/근거/600토큰/30초/36요청 경계를 바꾸지 않으며 다른 공급자/로컬에 Gemini필드를 강제로 붙이지 않는다. 합성 단위/Electron에서 각프리셋 요청/표시·재시작보존·누락/불명값·저장권한거절·기존키암호화/과거기록·현재세션불변·공유동의미복원/usage/3D 회귀를 검증한다. 기존 검사를 삭제/skip하지 말고 npm run check, npm run build, bash scripts/codex/smoke.sh, git diff --check를 정식 확장 실행 권한(require_escalated)으로 실제 실행한다. Chromium sandbox=true·TLS/proxy·기존 키/호출/출력/시간 한도를 유지한다. 실제 외부 API/개인 자료는 사용하지 않는다. 실패/미실행을 성공으로 표시하지 말고 한국어 양식과 renderDevelopmentResult의 ASCII JSON/원본 diff를 그대로 반환한다. Windows source/packaged와 실제 장치는 별도 원격/수동 검증으로 남긴다.

## 완료 조건
- A/B의 허용 프리셋만 새 Gemini 요청/화면/세션 snapshot에 일치하고 프롬프트 권한·근거·호출 한도를 바꾸지 않는다.
- 재시작 설정 보존/오류·기존 키 보호와 기록 호환을 검증하고 과거/진행중 세션을 전역값으로 덮어쓰지 않는다.
- 프로필을 포함한 실제 전송 preview/hash·동의 무효화와 실제 Electron/Windows·기존 공급자/3D/usage 회귀가 통과한다.

## 수정 허용 파일
- src/shared/ai.ts
- src/main/local-settings.ts
- src/main/ai-question-provider.ts
- src/main/external-ai.ts
- src/renderer/src/AIOptions.tsx
- src/renderer/src/InterviewWorkspace.tsx
- tests/unit/external-ai.test.ts
- tests/unit/ai-question-provider.test.ts
- tests/unit/local-settings.test.ts
- tests/smoke/gemini.spec.ts

# 승인 스펙의 다음 PR 준비 — 로컬 검증

- 기록 ID: `tests-2026-10-23-goal-planner-local`
- 검사 코드: `3787c580929b5f6b17755ace66136a820e359805`, 기준 main `0d778b601112217a52b67a5c2e09bd71109dc3c8`.
- Node 24.19.0에서 `npm run check` 성공: TypeScript·ESLint·단위 **540개/28파일**·정책 **41개**. `npm run build`, `git diff --check` 성공.
- 새 경계 테스트 14개: 기존 PR 없는 계획의 검증, main tree/parent 보존·Draft 생성, PR/branch 응답 유실 복구와 중복 생성0, 실패 조회를 없음으로 취급하지 않음, 스펙/main/branch/seed/작성자/닫힌 PR 변경 거절, Cloud 요청1회 및 재실행 추가0, 이전 작업 보류·lease·main CI 대기, 설치 main CI/key bridge, 모든 페이지의 중지 라벨·상태 보존 재개, seed만 있는 성공 보고의 완료 차단, 계획 종료 시 사용자 결정 안내1회.
- 최초 기본 sandbox 전체 검사는 기존 CLI의 하위 Node 실행이 `EPERM`으로 실패했다. 동일 검사를 실행 권한이 있는 환경에서 다시 수행해 위 성공을 확인했다. 정책·sandbox·테스트를 끄거나 실패를 성공으로 바꾸지 않았다.
- API fixture는 합성이며 실제 GitHub PR 생성·사용자 토큰 권한·Cloud 접수/종료·후속 머지 성공을 대신하지 않는다. 이 시점 원격 Windows CI 및 설치 후 실제 후속 실행은 미검증이다. 실제 진행은 [운영 이슈 #35](https://github.com/silverThunder09/ai-interview-studio/issues/35)와 연결된 PR/Actions에서 확인한다.
- 앱 소스는 변경하지 않았다. 준비한 다음 제품 작업인 품질 설정 보존·키보드 확대/축소가 이 검사로 구현됐다고 주장하지 않는다. 실제 Gemini 호출·음성·사용자 장치 검증도 하지 않았다. [최신 앱 기록](../../latest.md)과 과거 기록을 보존한다.

# PR #76 — 후속 승인 큐 연결의 로컬 검증

- 기록 ID: `tests-2026-10-23-pr76-local-queue`
- 검사 코드: `8cd9b8e3c253f1f5ff62d25c5db766606442901f`, 기준 main `750f9304b64cefcb8a2e8ad34fdee179d68912e4`.
- 실제 명령: `npm run check` 성공. TypeScript·ESLint·단위520개/26파일·리뷰 정책41개 성공, `git diff --check` 성공.
- 완료 receipt·bootstrap·회차·순서 보존, 과거 goal/approval/path 변경·삭제·재정렬 거절, paused/진행/lease 거절, 기존 tree/parent·non-force·두 번째 추가 쓰기0·동시 ref 변경 거절을 합성 API로 검사했다.
- 원격 영속 상태의 기존 scope hash가 새 승인 구성의 첫 두 정의와 같음을 확인했다. 이 비교는 원격 상태를 수정하지 않았다.
- 첫 기본 sandbox 실행은 기존 Node CLI 자식 프로세스의 EPERM 때문에 실패했다. 테스트를 삭제/skip하거나 보안 설정을 끄지 않고, 실행 권한이 있는 동일 검사에서 위 성공 결과를 얻었다.
- 작성 시점 Windows/최종 문서 head CI·실제 Cloud 후속 개발·원격 patch/머지·main 검증은 아직 완료되지 않았다. 이후 실제 실행은 [PR #76](https://github.com/silverThunder09/ai-interview-studio/pull/76), [후속 #75](https://github.com/silverThunder09/ai-interview-studio/pull/75), [운영 기록 #35](https://github.com/silverThunder09/ai-interview-studio/issues/35)에서 확인한다. 이 로컬 기록을 원격 무인 실행 성공으로 사용하지 않는다.
- 앱 코드는 변경하지 않았으며 [최신 앱 기준](../../latest.md)과 이전 기록을 보존한다. 합성 자료만 사용했고 새 API·개인자료 전송·권한·시간 예약은 없다.

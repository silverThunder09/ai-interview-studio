# PR #80 — 3D 품질 보존의 검토·복구와 로컬 검증

- 코드: `524cc2666f3cae933f331b2fa878542d9454b68c`(제품 수정 `734d5ae` 포함), 기준 main `00dd0a7fed2bbcfccefba461917d1b55ca37b220`.
- 실제 명령: `npm run check` 성공, TypeScript·ESLint·전체 단위547개/29파일·정책41개. `npm run build`, `git diff --check` 성공.
- 실제 Electron: `STUDIO_SMOKE_HEADLESS=1 npm run test:smoke -- tests/smoke/avatar.spec.ts tests/smoke/desktop.spec.ts` **2개 성공**. Linux 소프트웨어 WebGL2에서 30FPS 관측; peak CPU/RAM·물리 GPU·사용자 GalaxyBook은 미검증이다.
- 실제 재시작의 품질 복원, 화면 이동, 충돌하는 settings temp 파일의 원본/기존 저장값 보존, 재시도, 손상/알 수 없는 파일 버전의 덮어쓰기 거절, 모델 보존·GPU 정리·테마 보존, 새 품질 IPC의 다른 창 요청 거절을 확인했다. 기존 단위 테스트에 없는 실제 파일/창 동작을 구분한다.

## 실패를 보존한 복구

자동 실행기가 [Draft PR #80](https://github.com/silverThunder09/ai-interview-studio/pull/80)을 만들고 [개발 요청](https://github.com/silverThunder09/ai-interview-studio/pull/80#issuecomment-6358958276)을 보냈다. [공식 결과](https://github.com/silverThunder09/ai-interview-studio/pull/80#issuecomment-6359011168)는 check/build0·smoke1을 반환하면서 succeeded라고 주장했다. main 파서는 이를 `unproven_success`로 거절했고 patch를 원격에 적용하지 않았다. 이 실패 보고를 편집·성공 처리하지 않았다.

연결된 검토 담당이 후보 patch만 로컬에 적용해 검사하자 실제 앱 재시작에서 standard가 low로 돌아가는 실패를 재현했다. 앱의 `session.fromPartition('studio')`는 의도적인 메모리 세션이므로 최초 계획의 localStorage 보존 방식이 잘못됐다. 메모리 세션·CSP·sandbox를 유지하고 기존 main의 원자적 settings 저장 경로에 검증된 선택 필드만 추가했다. 허용 값 두 개의 좁은 IPC를 사용하고 테마 갱신이 오래된 snapshot으로 품질을 되돌리지 않게 했다. 기존 모델·암호화된 키·기록·동의 상태는 보존한다.

초기 avatar 후보 테스트는 **재시작 보존 실패**였다. 수정 뒤 avatar 테스트는 통과했고 desktop은 X 서버 부재로 시작하지 못했다. 기존 avatar와 같은 명시적 headless 옵션을 desktop 테스트에도 적용해 sandbox를 유지한 최종 2개 성공을 확인했다. 원래 실패를 환경 문제로 덮어쓰거나 실패 검사를 삭제하지 않았다. 닫힌 첫 창의 locator를 재사용하던 후보 테스트도 현재 창을 조회하도록 고쳤다.

Cloud 요청 안내에는 실제 tests 중 하나라도 nonzero이면 failed로 보고하도록 명시하고, 기존 관련 headless smoke 명령의 정확한 보고 이름을 추가했다. 특권 담당이 보고 문자열을 실행하지 않으며 파서의 실패/최신 CI/머지 조건은 그대로다.

## 읽기 쉬운 리뷰 양식 추가

사용자의 추가 요청으로 변경 내용·확인 결과·남은 작업·머지 가능 여부를 먼저 쓰는 `.github/AI_REVIEW_TEMPLATE.md`와 자동 작성 함수를 추가했다. 결함은 본문에 표시하고 SHA·CI 링크만 상세 근거로 접는다. 기존 자동 리뷰는 같은 식별자·head·작성자를 확인해 본문을 갱신하며 중복 게시하지 않는다. 사람의 변경 요청은 그대로 머지를 차단한다.

이 변경의 `npm run check`는 타입·lint·단위 **549개/29파일·정책41개**로 성공했다. 추가 검증은 결함 가시성·오래된/누락된 증거 거절·기존 자동 댓글 갱신·사람의 변경 요청 유지다. 첫 추가 테스트는 단순 fixture 대신 실제 증거 수집기를 사용하도록 바로잡은 뒤 통과했다. 위 제품 build·Electron 검증과 구분하며, 최종 원격 CI는 새 head에서 다시 확인한다.

이번 제품 복구는 **연결된 검토 담당의 수동 수정**이다. 자동화의 파일 allowlist나 과거 정의를 바꾸지 않았고 전체 무인 성공이라고 표시하지 않는다. 최종 head의 Windows 원본/패키지·원격 CI·merged main·다음 자동 작업 재개는 아직 대기이며 [PR #80](https://github.com/silverThunder09/ai-interview-studio/pull/80)과 [운영 이슈 #35](https://github.com/silverThunder09/ai-interview-studio/issues/35)에 이어 기록한다. 기존 최신 앱 기준·과거 숫자를 이 로컬 결과로 덮어쓰지 않는다.

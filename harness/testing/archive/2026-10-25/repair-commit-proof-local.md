# 수정 commit 검증의 실제 transport 회귀

관련 [기존 이슈60](https://github.com/silverThunder09/ai-interview-studio/issues/60)·[운영35](https://github.com/silverThunder09/ai-interview-studio/issues/35). 기준 main6400682fb3e625b51a26534fd5ccdb2b5c2c3914, 검사한 구현b19782a5444a743631b55643093a392e3f4c27c6.

- `npm run check` exit0: typecheck/lint·단위689/689(32파일)·정책41/41. 실제 GitHub 클래스로 `/compare/...`가 네트워크 전에 거절되는 기존 문제를 재현했다.
- 경로 검사는 바꾸지 않았다. SHA로 고정한 `/git/commits/:sha`의 최대16개 first-parent와 `/commits/:sha`의 단일 parent·실제 변경 파일로 검증한다. 새 수정 회차마다 apply commit을 보존하며 옛 미완료1회만 기존 apply journal을 사용한다. 복수 과거 회차가 모호하면 거절한다.
- 실제 GitHub transport를 통과하는 해결 흐름, main 일반 merge 뒤 옛 수정 commit 확인, 다회 수정의 개별 commit·파일 검증, 무관한 head/부모 변경/미수정 파일/모호한 과거 이력을 검사했다. 원본 사람 리뷰·최신 CI/새 AI·허용 경로·상한은 유지한다.
- 제품 소스는 변경하지 않아 로컬 build/smoke를 반복하지 않았다. 원격 Windows/CI와 설치 후 검증된 review 재개1회는 실제 실행에서 확인한다. 일반 paused/수동 정지는 자동 해제하지 않으며 기존 PR95 cycles=1·요청/영수증/수정 이력을 초기화하지 않는다.

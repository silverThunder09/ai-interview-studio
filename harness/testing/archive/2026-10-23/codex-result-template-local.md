# Codex 작업 결과 양식 — 로컬 검증

- 검사한 코드: `3cbd058e334ee8d0ea196f3c19f350b346991fe8`, 기준 main `3654185ceca59d7d0d27e29158f3a1759137f387`.
- 실제 명령: `npm run check` 성공. TypeScript·ESLint·단위 **553개/29파일·정책41개** 통과, `git diff --check` 성공.
- 확인한 동작: 사람용 작업 요약·검사별 결과·실패/보류·다음 단계가 JSON/patch보다 먼저 표시된다. 기존 JSON 전용 응답도 유지한다. pretty JSON·CRLF·동일 patch 반영 계획을 확인했다.
- 확인한 거절 조건: 보이는 테스트 수/상태 변조, 실패 종료 코드를 포함한 성공 주장, 공식 작성자 위장, 이전 head, 중복 JSON 키, 추가 승인 지시, HTML로 요약 숨기기. 원격 머지 권한이 생기지 않는 것도 확인했다.
- 첫 검사에서는 정규식의 불필요한 escape에 lint 오류가 있어 수정한 뒤 성공했다. 실패 검사를 숨기거나 삭제하지 않았다.
- 제품 UI·의존성·CI/머지 조건 변경은 없다. 이번 단계는 자동 요청/결과 parser와 합성 공식 댓글 fixture 검증이며, 실제 Codex가 새 양식으로 반환한 운영 결과·최종 Windows CI는 아직 미검증이다. 별도 실제 모델 API나 개인정보 전송은 실행하지 않았다.
- 양식: [CODEX_RESULT_TEMPLATE.md](../../../../.github/CODEX_RESULT_TEMPLATE.md). 로컬 결과로 기존 앱 최신 기준·과거 검사 수를 덮어쓰지 않는다.

## 실제 실패 결과의 patch 안내 보완

사용자가 #81에서 전달한 실제 결과는 smoke 실패와 outcome=failed를 표시하면서 patch도 포함했다. 원래 파서는 실패 patch를 거절하므로 이 검증을 유지하고, 요청 안내에 failed/blocked의 change.kind는 반드시 none임을 명시했다. 해당 두 결과의 거절과 자동 commit 계획 차단을 추가 확인했다. 코드 `154fdcb8548e94917adcf152ef70e39a028c2fd4`의 `npm run check`는 단위 **555개/29파일·정책41개**, 타입·lint로 성공했다. GitHub 결과 댓글 미수신의 원인이 이 JSON 형식 때문이라고 단정하지 않는다. 그 구간은 별도 미확인 상태다.

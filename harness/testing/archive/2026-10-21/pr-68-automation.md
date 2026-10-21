# 자동화 회귀 검증 — PR #68

기준일: 2026-10-21 KST. **이 기록의 성공 범위는 CI 대상 커밋 검증 수정과 아래 관측한 단계다. 전체 A→B 자동 개발 루프 완료 기록은 아니다.** 앱 기능 기준 `latest.md`를 교체하지 않는다.

## 검사한 코드와 결과

| 항목 | 값 |
| --- | --- |
| PR | [#68](https://github.com/silverThunder09/ai-interview-studio/pull/68) |
| head | `6a302852969e570e1998304f7ad2b36dcae12a51` |
| base | `9fe12c97b00e1f111fd02cb45c2ccb6a62e664eb` |
| 실제 merge checkout | `e0fd176605d7c020ee92b7ca1f24aabd3d6a2fdb` |
| 머지 후 main | `d933f6e692dcee846c98ac7cfc90f5fced422cf0` |
| 단위 / 정책 | 464 / 41 성공 |
| Windows 원본 / 패키지 smoke | 9 / 9 성공 |

- [checks](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39560868165/job/119091518513): TypeScript·ESLint·단위464·정책41 성공.
- [package](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39560868134/job/119091517521): 번들·원본 smoke·Windows package·패키지 smoke·notices/checksum 성공.
- [최종 본문의 pr-policy](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39561463691/job/119093484225): 성공.

세 job 모두 최신 attempt=1의 성공한 `Record tested head and base` 명령 **실제 stdout의 마지막 유효 AIS_CI_EVIDENCE**를 추출했다. repository·PR68·run_id·위 head/base/checkout을 검증했다. PR_BODY 환경변수나 댓글의 문자열은 증거로 쓰지 않았다. 모든 페이지 원본 REST reviews 1개(COMMENTED), change_requests=0, 라벨/미해결 스레드/연결 finding=0을 실제 API로 확인하고 trusted-main policy.mjs의 allowed=true를 확인한 뒤 expected-head squash했다.

머지 후 [main checks](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39561621483/job/119093992360)와 [main package](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39561621562/job/119093993786)도 성공했다. 두 성공 checkout 단계의 실제 git log stdout이 위 main SHA임을 확인했다. 단위464·정책41·Windows smoke 각9를 재확인했다.

## 실패와 복구 이력

- 이전 [#66](https://github.com/silverThunder09/ai-interview-studio/pull/66)은 main 일반 merge 직후 PR REST head 반영 지연을 수정했다([#65](https://github.com/silverThunder09/ai-interview-studio/issues/65)). 당시 단위458·정책41·Windows smoke 각9 성공과 main9fe12c9를 검증했다.
- [#67](https://github.com/silverThunder09/ai-interview-studio/issues/67)의 실제 실패 CI [39559065174](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39559065174)는 이전 head를 부모로 가진 checkout을 거절했다. 성공으로 덮어쓰거나 같은 입력으로 재실행하지 않았다.
- #68은 실제 Git commit API에서 부모가 정확히 `(현재 main, 현재 PR head)`인지 확인한 뒤 CI를 전송하도록 수정했다. 이전 실제 checkout=false·현재 checkout=true와 동시 main/ref/차단 라벨 변경 거절을 검증했다.
- 실패한 전체 task/request/delivery/operation/key/checkout은 상태 브랜치 `automation/approved-loop`의 `recovery_history`/`ci_recovery_history`에 보존했다. 기존 v1 ledger도 보존했다.

## A 작업에서 실제로 확인한 연결

| 단계 | 관측 |
| --- | --- |
| Codex Cloud 개발 | [실제 작업](https://chatgpt.com/s/cd_6ad862649efc8191ac6a7aa6844a031d)의 공식 v2 결과6310089891을 조정자가 반영 |
| 새 main 일반 merge 후 A head | `bf3e858b80e2e129a06d6ceb2c29a34aced914a6` |
| A base / checkout | `d933f6e692dcee846c98ac7cfc90f5fced422cf0` / `e84263b2b254039de0f16d701ca997b7890281f7` |
| A CI | [39562588322](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39562588322): 단위465·정책41·Windows 원본/패키지 smoke 각9 성공, 세 Record stdout의 head/base/checkout 일치 |
| 완료 이벤트 | [CI completion](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39562590476) → [조정자](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39563236437) 자동 호출 성공 |
| 다음 리뷰 요청 | [6310686977](https://github.com/silverThunder09/ai-interview-studio/pull/58#issuecomment-6310686977) 1개 자동 발신 |
| 중복 검증 | 조정자39531026347 attempt7 재실행 성공, task 내용 동일·해당 CI1개·추가 CI/개발 요청0 |

## 남은 실패·미검증

공식 bot은 [내장 코드 리뷰 summary](https://github.com/silverThunder09/ai-interview-studio/pull/58#issuecomment-6310690943)와 [receipt](https://github.com/silverThunder09/ai-interview-studio/pull/58#issuecomment-6310710728)를 반환했다. 현재 head 전체 SHA·completed·finding 없음은 확인했지만 main의 실행기는 별도 `ais-code-review-result`/Cloud 작업 URL만 기다리고 native 댓글 이벤트를 건너뛰었다([#69](https://github.com/silverThunder09/ai-interview-studio/issues/69)).

이 브랜치의 수정 후보는 **review 단계에만** 공식 native 응답의 작성자/type·원본 URL·전체 head·완료 시각·구조화 상태/보안 finding을 검증하고 created/edited 이벤트를 연결한다. 실제 두 bot 댓글로 경계 함수를 검증했고 로컬 TypeScript·ESLint·영향 테스트131개(기존 v1 실행기 포함)·정책41개, YAML·기존 권한·로컬 문서 링크33개·색인 경로13개를 확인했다. 원격 CI·설치 후 실제 callback은 아직 검증하지 않았다. 기존 v2 개발 종료 계약과 사람 리뷰/CI/머지 조건은 유지한다. 일반 리뷰를 개발 작업 종료나 독립된 사람 승인으로 간주하지 않는다.

A 자동 머지·그 main CI·B의 실제 시작/완료는 **미검증**이다. [운영 검증 #35](https://github.com/silverThunder09/ai-interview-studio/issues/35)는 열어 둔다. 이번 실행의 PR2개 및 세 번째 실패 경계에서 기존 상태/이력을 보존하고 다음 실행으로 인계한다. Linux native 하위 프로세스 제한으로 로컬 전체 check 성공을 주장하지 않으며 Windows 실제 CI와 구분한다. 실제 사용자 하드웨어·유료 모델 호출·개인 자료 전송은 검증하지 않았다.

[기록 목록](../../README.md) · [이벤트 루프의 실제 검증과 한계](../../../event-loop.md#실제-검증과-한계)


## 후속 관측 — #70 설치와 null 메타데이터 (2026-10-21 KST)

위 항목은 #68 및 #70 설치 전의 역사적 기록이다. 이후 [#70](https://github.com/silverThunder09/ai-interview-studio/pull/70)이 머지됐고 main `d6d4dd72440f0070a4e0f82fcac9dc2a57fff4b9`의 [검사](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39572860122)·[Windows](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39572860053)가 성공했다. 단위489·정책41·원본/패키지 smoke 각9 및 실제 main checkout을 확인했다.

A #58의 head `b3abefda5c9bec942c5840b650568ca3484fbe70`, base `d6d4dd72440f0070a4e0f82fcac9dc2a57fff4b9`, checkout `c55f92564d1dec6cbb7261052cbba5a5b1564cbe`의 [CI39574119443](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39574119443)가 단위490·정책41·Windows smoke 각9를 통과했다. 실제 성공 Record 명령 stdout에서 세 필수 context의 head/base/checkout을 확인했다. 완료 이벤트는 새 리뷰 요청과 native 완료 callback까지 자동으로 이어졌다.

그러나 [실제 summary](https://github.com/silverThunder09/ai-interview-studio/pull/58#issuecomment-6310690943)는 전체 head·completed를 반환하면서 finding 두 필드를 null로 남겼고, [callback39575071480](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39575071480)이 이를 finding으로 취급해 멈췄다. [receipt6312350376](https://github.com/silverThunder09/ai-interview-studio/pull/58#issuecomment-6312350376)의 문구는 단독 성공 증거가 아니다. 같은 시점의 모든 페이지 원본 REST reviews/inline comments는 각0개다. [#69](https://github.com/silverThunder09/ai-interview-studio/issues/69)를 재개했다.

후속 후보는 null을 false로 덮어쓰지 않고 위 API 근거와 현재 head/base를 결합한다. true finding·공식 bot 리뷰/인라인 댓글·누락/잘못된 API 근거·stale SHA를 거절하며, 기존 사람 변경 요청·스레드·라벨·필수 CI·expected-head squash 검사는 유지한다.

| 후속 후보의 실제 로컬 검사 | 결과 |
| --- | --- |
| `npm run typecheck`, `npm run lint` | 성공 |
| `npx vitest run tests/unit/native-review.test.ts tests/unit/loop-coordinator.test.ts` | 67개 성공, 두 번째 페이지 finding 거절 포함 |
| `node scripts/review/policy.test.mjs` | 41개 성공, 사람 변경 요청·누락 원본 리뷰 거절 포함 |
| 실제 현재 API를 `parseNativeReviewResult`에 입력 | API 근거 없음은 대기, 전체 현재 API 근거 포함은 native 완료 판정 |
| `git diff --check` | 성공 |

후속 후보의 원격 CI·설치·운영 검증은 아직 수행하지 않았다. A는 paused/cycles3, B는 queued이며 전체 루프는 미완료다. #70의 PR 1회 예외는 이미 사용했으며 이 기록은 추가 PR/추가 복구 승인이나 카운터 초기화가 아니다.


### #71 머지 경계 재검증 추가

최종 호출부 점검에서 `gatherMergeEvidence`가 저장된 native receipt를 기존 custom JSON parser로 다시 해석해 `wrong_review_key`로 멈추는 것도 재현했다. 모의 `verifyMerge`를 사용하지 않고 실제 수집기를 거치는 회귀 테스트가 수정 전 native 두 형식에서 실패함을 확인한 뒤, 같은 parser·모든 페이지 원본 API 근거를 머지 직전 두 번 재검증하도록 연결했다. native의 true/null 형식과 기존 custom 형식 모두 A 머지 후 main CI를 기다리며, 마지막 조회에서 새 finding이나 사람 변경 요청이 생기면 머지하지 않는 것을 확인했다.

추가 변경 후 타입·lint·native/조정자/CI 근거 테스트 **81개**·정책 **41개**·diff 검사가 성공했다. 합성 API를 통한 회귀이며 실제 A/B 운영 완료를 뜻하지 않는다.

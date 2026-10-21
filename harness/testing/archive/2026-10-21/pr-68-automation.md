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

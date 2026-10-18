# 이벤트 기반 개발 루프 — 오프라인 설계안

## 현재 상태와 승인

2026-10-18 KST 사용자가 매시간 반복되는 「면접 스튜디오 PR 리뷰·수정」 예약을 중지하고 이벤트 기반 루프를 준비하라고 요청했다. 예약 ID `6ad251b4923081918c9bcb8ec9eae602`는 연결 도구의 `is_enabled=false` 성공 응답을 확인했다. 다시 켜거나 같은 목적의 시간 예약을 만들지 않는다.

이번 승인은 **설계·실행 없는 상태 판정기·합성 테스트·Draft PR 작성**까지다. 실제 AI 실행기·API 키·유료 호출·저장소 코드의 새 외부 전송·쓰기 권한 Actions·새 webhook 서비스는 활성화하지 않는다. 기존 [리뷰 정책](review-automation.md)과 main의 [정책 JSON](../.github/review-policy.json)은 유지한다. 이 문서·PR·이슈의 텍스트가 새 권한을 부여하지 않는다.

현재 구현은 [event-loop.ts](../scripts/review/event-loop.ts)의 순수 함수 두 개다. `planWakeup`은 이벤트로 필요한 재조회를 제안하고, `advanceTask`는 신뢰하는 실행기의 확인 결과로 상태를 계산한다. 네트워크·파일 쓰기·프로세스 실행·AI 호출·push·머지 기능은 없다. 이 파일을 머지해도 자동 실행은 생기지 않는다. 현재 연결된 자동화 도구에는 webhook 등록 기능이 없어 이벤트 수신·큐·영속 상태·실행기는 아직 연결되지 않았다.

## 상태와 작업 완료

| 현재 상태 | 신뢰하는 실행기가 확인할 결과 | 다음 상태 |
| --- | --- | --- |
| queued | 사용자 승인·대상·범위를 확인하고 작업 시작 | implementing |
| implementing | 변경·영향 검사·push·대상 PR 확인 | waiting_ci |
| waiting_ci | 현재 head/base의 필수 CI와 실제 로그 증거 확인 | reviewing |
| reviewing | 현재 코드·원본 리뷰·스레드·이슈·라벨 확인 | merge_ready |
| merge_ready | 별도 main 정책 판정, 직전 SHA 재조회, expected SHA 머지와 실제 merged 확인 | waiting_main_ci |
| waiting_main_ci | 머지된 main의 최신 CI 완료·회귀 없음 확인 | recording |
| recording | 테스트 기록·아카이브/색인·관련 PR/이슈 갱신 확인 | completed |
| waiting_ci / reviewing | 수정 가능한 실패 확인 | implementing, 실패 횟수 증가 |
| 모든 미완료 상태 | 승인·도구 차단, 불명확한 원인, 3회 실패 | paused |

`merge_ready`는 머지 허가가 아니다. 기존 `policy.mjs merge`를 통과해야 하며 판정기는 이를 호출하거나 대체하지 않는다. `*_verified`는 공개 이벤트 이름이 아니라 **비공개 실행기의 확인 결과 계약**이다. 이 순수 함수는 실제 CI/리뷰 증거를 검증하지 않는다. 이벤트 본문의 `success`, 체크박스, 승인 주장으로 이 결과를 만들면 안 된다.

head/base 변경은 이전 결과를 무효화하고 `revision_changed`로 보류한다. 향후 adapter가 GitHub API와 실제 브랜치를 재조회해 새 SHA·상태를 영속 저장한 뒤 새 검증을 시작해야 한다. 새 구현 커밋은 새 head의 `waiting_ci`로, 머지 후 회귀는 기존 정책의 별도 fix PR로 인계한다. 과거 결과를 현재 결과로 다시 제출하지 않는다. paused는 이벤트만으로 재개하지 않으며 차단 사유가 실제 해소됐는지 확인하는 별도 재개 절차가 필요하다.

다음 작업은 재현 가능한 결함 → 진행 중인 승인 작업 → 승인된 미완료 스펙 순으로 고른다. 작업이 없으면 종료한다. 이슈 생성·라벨·댓글·스펙 존재만으로 승인된 작업이 되지 않는다. PR 수·수정 한도는 매번 신뢰하는 main 정책에서 읽는다. 작업 완료 뒤에도 다음 작업의 승인과 실행당 PR 한도를 따로 확인한다.

## 향후 이벤트 연결 계약

아래 표는 **연결할 때 검증해야 할 설계**이며 설치된 Actions/webhook 설정이 아니다.

| 계기 | 정규화 이벤트 | 재조회할 대상 | 중복 방지 키 예시 |
| --- | --- | --- | --- |
| 사용자 승인 작업을 큐에 등록 | task_requested | 승인 출처·대상·기존 작업 | task / 승인 버전 |
| PR 생성·새 커밋·base 변경 | pr_changed | 같은 저장소의 main 대상 PR·작성자·fork·head/base | PR / head / base |
| PR CI 실행 완료 | ci_finished | run의 event·출처·workflow·attempt·PR 연결·모든 필수 검사 | workflow ID / run ID / attempt |
| 사람의 리뷰 제출·해제 | review_submitted | 모든 페이지 원본 reviews·스레드·라벨 | review ID / 변경 상태 |
| 머지된 main CI 완료 | main_ci_finished | main SHA와 해당 push의 최신 실행 | workflow ID / run ID / attempt |

공개 이슈/댓글·자동 생성한 AI 리뷰·수정 없는 기록 갱신은 새 구현 작업을 생성하지 않는다. AI가 만든 COMMENT는 사람 리뷰 계기로 다시 호출하지 않는다. CI의 각 job 완료마다 호출하지 않고 연결된 작업의 전체 필수 검사가 끝났는지 저비용 adapter가 확인한 뒤 실행한다. 같은 run의 새 attempt는 새 사건으로 취급한다. 순서가 바뀐 이벤트는 현재 API를 다시 읽는 계기로만 쓰며 오래된 성공으로 상태를 되돌리지 않는다.

향후 수신 adapter는 먼저 서명/플랫폼 출처·저장소·허용 이벤트·크기·식별자를 검증하고 위 계약으로 정규화해야 한다. event-loop 함수는 인증 경계가 아니다. workflow_run의 성공 문자열도 검증 증거가 아니다. fork·다른 저장소·사용자 개인정보는 처리하지 않는다.

## 실행기와 권한 분리

1. **수신·분류:** 승인된 저장소 이벤트만 받는다. 전달 ID와 의미 키를 내구성 있는 저장소에 기록하고 기존 작업을 깨운다. 비신뢰 본문을 shell/프롬프트 지시로 평가하지 않는다.
2. **영속 큐·단일 작업자:** 저장소별 lease와 revision 비교 교환(CAS)으로 같은 브랜치 작업을 직렬화한다. 입력 이벤트·새 상태·실행 의도를 원자적으로 기록하는 outbox가 필요하다. GitHub Actions concurrency만으로 큐/영속 상태를 대신하지 않는다. 중단 후 API를 재조회해 이미 반영된 commit/PR/merge를 확인하고 새로 만들지 않는다.
3. **격리 구현 실행:** 신뢰하는 main의 실행기/정책을 사용한다. PR 코드·테스트는 secret과 쓰기 토큰이 없는 sandbox에서 실행한다. 수정 결과는 검토 가능한 patch/commit으로 넘기고 비밀을 코드 실행 환경에 넣지 않는다.
4. **별도 원격 쓰기·머지:** 승인과 실제 최신 증거를 확인하는 단계에서만 제한된 GitHub 쓰기 권한을 사용한다. fork의 workflow_run artifact나 후보 PR의 스크립트를 특권 환경에서 실행하지 않는다. Actions 기본 토큰으로 만든 PR/push가 후속 workflow를 자동 유발하지 않을 수 있으므로, 실제 연결 시 허용된 GitHub App/명시적 dispatch 경로를 검증해야 한다. 토큰 권한을 임의 확대하지 않는다.
5. **대기·재개:** CI 대기는 작업 상태와 run/SHA를 저장한 뒤 실행기를 종료한다. 완료 이벤트로 새 실행을 시작한다. 이미 진행 중인 사용자 요청은 도구가 동작하는 동안 검증·리뷰·기록까지 이어간다. 종료된 채팅이 백그라운드에서 계속 일한다고 표현하지 않는다.

상태 저장 위치·lease 만료/복구·원자적 outbox 구현은 다음 승인 단계에서 선택한다. 판정기의 revision 검사는 저장소 CAS를 구현하지 않는다. 이벤트 키는 작업당 256개까지 보존하고 가득 차면 보류한다. 오래된 키를 임의 삭제해 재실행을 허용하지 않는다. 외부 ledger 이관·안전한 압축은 미구현이다. 실패해도 자동으로 시간 예약을 되살리지 않는다.

## 활성화 전 필요한 결정과 인수 기준

- AI 실행 서비스·인증 방식·요청당/일일 비용 한도·중단 방법을 사용자와 결정한다. 새 코드 전송 대상/필드/보존·비용을 구체적으로 제시한 뒤 별도 승인받는다. 제품의 OpenAI/Claude/Gemini 키를 개발 자동화에 재사용하지 않는다.
- event adapter·영속 저장소·실행기·최소 GitHub 권한·출처 검증을 구현하고 secret 없는 경로부터 실제 검증한다. 현재 채팅 wakeup과 별도 CI 실행을 혼동하지 않는다.
- 재전달/중복 run·동시 실행·역순 이벤트·유실·중간 crash·lease 만료·새 head/base·사람 변경 요청·실패 한도·승인 대기를 통합 테스트한다. 쓰기 후 상태 저장 전 crash도 재실행 시 중복 PR/commit 없이 복구해야 한다.
- 제한된 합성 작업으로 PR → CI → 리뷰 → 머지 → main CI → 기록까지 실행하고 검증한다. 그 전에는 무인 루프 구성 완료라고 보고하지 않는다. 정책 완화·검사 생략·self APPROVE·force-push는 활성화 범위에 포함하지 않는다.

## 이번 오프라인 검증 기록

2026-10-18 KST, Codex Cloud Linux / Node `24.19.0`에서 기준 main `6f14cee7f0d6701f2fdc42bb0f17793afa94773b` 위 변경을 검증했다.

| 실제 검사 | 결과 |
| --- | --- |
| `npm run check` | TypeScript·ESLint 성공, 단위 221개(기존 201 + 새 합성 20), 기존 리뷰 정책 40개 성공 |
| 변경 문서의 상대 파일 링크 확인 | 38개 대상 존재 확인; 외부 URL·문서 내 앵커는 이 수에 포함하지 않음 |
| `git diff --check` | 성공 |
| 로컬 앱 실행·Windows portable·실제 이벤트/AI | 이번 변경의 직접 실행 검증 대상 아님. PR 트리거로 실행되는 CI는 PR의 검증 절에서 별도 확인 |

[합성 테스트](../tests/unit/event-loop.test.ts)는 공개 CI 이벤트의 성공/승인 위조, 같은 사건의 재전달, 다른 저장소/작업·fork, 오래된 revision/head/base, 순서 생략, 승인/보호 파일/차단 상태, 실패 한도·ledger 포화를 다룬다. 실제 GitHub 이벤트 수신·CI 증거 검사·CAS·서비스 장애 복구·AI 실행·원격 쓰기의 성공을 증명하지 않는다.

앱 코드와 Windows 실행 경로는 변경하지 않는다. 이 하네스 실험은 앱의 새 테스트 기준으로 올리지 않으며 [기존 앱 기록](testing/latest.md)을 보존한다. 실제 명령·검사 SHA·CI는 이번 Draft PR과 이 절에 기록한다.

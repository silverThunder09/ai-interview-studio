# 이벤트 기반 개발 루프

## 별도 설계 초안

[GitHub 담당·Legacy 개발 담당 역할 분리](event-loop-role-separation.md)는 2026-10-20 KST 사용자가 요청한 설계 초안이다. 문서 작성과 검증 후 머지만 승인됐으며 구현·새 인증·권한/종료 계약 변경·활성화는 별도 승인 대상이다. 아래의 현재 운영 규칙과 기존 outbox는 그대로 유지한다.

## 승인과 실제 구성

2026-10-18 KST 사용자가 매시간 반복 예약을 중지하고 오프라인 설계를 승인했다. 예약 ID `6ad251b4923081918c9bcb8ec9eae602`의 일시정지를 확인했으며 다시 켜지 않는다. **2026-10-19 KST에는 이벤트 수신기·실행기 구현과 검증 후 머지를 요청했고, 별도 API 과금 없이 기존 Codex Cloud만 사용하도록 선택했다.** 이후 사용자가 새 Actions 실행과 contents:write·issues:write 권한 및 push·PR·검증 후 머지를 명시적으로 승인했다. 이번 구현은 이 요청에 따른다. 새 MVP·유료 모델 API·제품 키 재사용·외부 webhook 서버·공개 release는 포함하지 않는다.

[Event worker](../.github/workflows/event-worker.yml)가 GitHub의 저장소 이벤트를 받으며 [event-worker.ts](../scripts/review/event-worker.ts)가 신뢰하는 main의 정책과 GitHub 현재 상태를 재조회한다. 준비된 PR은 기존 GitHub Codex 연결의 `@codex` 댓글로 Cloud 작업을 요청한다. 별도 모델 API 키·외부 서버·시간 예약은 사용하지 않는다. Codex 사용량과 GitHub Actions는 기존 계정의 한도를 따르며 무제한/무비용 실행을 보장하지 않는다.

공식 연결 방법: [Codex GitHub integration](https://developers.openai.com/codex/integrations/github/). 댓글 작성 성공·👀 반응·자동 리뷰의 시작만으로 Cloud 구현 작업이나 전체 개발 루프가 성공했다고 판단하지 않는다. 실제 상태 댓글·코드/CI/머지 결과가 있어야 한다. 연결 검증 결과는 PR #26과 연결된 이슈에 기록하며, 미확인 상태는 완료로 보고하지 않는다.

초기에는 [Codex bot이 저장소 환경 생성을 요구했다](https://github.com/silverThunder09/ai-interview-studio/pull/26#issuecomment-6251982889). Legacy 환경 생성 후 수동 요청의 실제 작업 종료를 확인했다. [PR #44](https://github.com/silverThunder09/ai-interview-studio/pull/44) 설치 후 기존 worker의 [요청 댓글 전달](https://github.com/silverThunder09/ai-interview-studio/pull/45#issuecomment-6265460842) 1회와 동일 job 재실행의 추가 전달0회를 확인해 POST403 결함 [#40](https://github.com/silverThunder09/ai-interview-studio/issues/40)을 종료했다. 과거 실패 ledger는 보존했다. 그러나 Actions 봇 댓글의 실제 Cloud 접수·종료는 미확인이다. 사용자 지시로 [사용자 계정 요청](https://github.com/silverThunder09/ai-interview-studio/pull/45#issuecomment-6268907023)을 한 번 재시도하자 2026-10-19 22:55 KST [공식 Cloud 종료 응답](https://github.com/silverThunder09/ai-interview-studio/pull/45#issuecomment-6268934744)이 왔다(checkout 0fd3a46, main f5e4e94, Node24.19.0, 단위275·정책40, Git 변경 없음). 본문도 다르므로 발신자 차이만을 원인으로 단정하지 않으며, 수동 요청 성공을 원래 outbox의 종료 증거로 대체하지 않는다. [운영 검증 #35](https://github.com/silverThunder09/ai-interview-studio/issues/35)는 정상 자동 요청·종료·중복 방지까지 확인하기 전에는 닫지 않는다.

### 사용자 토큰 발신 — 독립 검증 완료, 기존 실행기 통합

2026-10-19 KST 사용자는 독립 검증 커밋·PR #46과 단기 저장소 토큰 사용을 승인했다. 사용자가 Secret 등록·최초 수동 실행을 마친 뒤 [실제 workflow](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39269133817)의 사용자 계정 요청→82초 후 [공식 Cloud 종료](https://github.com/silverThunder09/ai-interview-studio/pull/45#issuecomment-6269654424)를 확인했다. 같은 job attempt2는 기존 요청을 찾아 POST를 생략했다. 요청1개·공식 nonce 응답1개이며 기존 outbox를 대신 완료 처리하지 않았다. 공식 작업 보고는 PR head0fd3a46·Node24.19.0·단위275·정책40·Git 변경 없음이다. main bed1a3b는 PR 메타데이터로 확인했으며 작업의 로컬 main ref/원격 부재로 독립 조회는 못 했다는 제한을 보존한다. 검증 PR45는 머지 없이 닫고 임시 차단 라벨만 제거했다.

같은 날 현재 채팅에서 사용자는 기존 실행기에 검증된 사용자 토큰 경로를 연결하고 종료 인식·중복 방지·다음 작업 재개를 검증하는 변경의 PR·CI 후 머지를 별도로 승인했다(직전 범위 설명에 대한 “승인할게”). 독립 검증 승인만으로 확대하지 않았으며 현재 설치·실제 운영 검증 여부는 #35와 해당 PR의 최신 근거를 따른다.

- Event worker는 main만 checkout하고 정확한 현재 main SHA를 확인한다. checkout 자격증명을 남기지 않고 npm·후보 PR 코드·artifact를 특권 job에서 실행하지 않는다. 기존 GITHUB_TOKEN은 조회·ledger·보류 이슈에 사용하고 `AIS_CODEX_COMMENT_TOKEN`은 reconcile 단계에서 고정 저장소 PR 요청 댓글 POST에만 사용한다. 별도 Cloud sender는 PR 수정·머지·ledger API를 호출하지 않는다.
- 사용자 토큰이 없거나 만료/거절되면 봇 토큰으로 재전송하지 않는다. 누락은 API/ledger 저장 전에 실패한다. 토큰 값·환경 전체·원문 응답을 로그·요청 본문·artifact·Cloud 환경에 복사하지 않는다. 제품 AI 키·별도 모델 API는 사용하지 않는다.
- 사용자가 이 저장소 하나에 한정된 fine-grained token을 직접 발급·[Actions Secret](https://github.com/silverThunder09/ai-interview-studio/settings/secrets/actions)으로 관리한다. Pull requests:read/write와 필수 Metadata:read만 사용하고 토큰은 PR 수정·머지에도 쓰일 수 있다는 권한 한계를 유지한다. 최초 검증 토큰은 7일 이내 만료이며 자동 갱신하지 않는다. 장기 자격증명 운영은 별도 사용자 관리 대상이다. 원문을 채팅에 보내지 않으며 만료/폐기 후 실행이 멈추면 사용자가 같은 제한 범위로 재등록한다.
- 요청 POST의 실제 작성자 silverThunder09/User·양의 댓글 ID·전체 고정 본문 일치를 검증한다. 전송 전 sending을 저장하고, 응답 유실 후에는 모든 댓글 페이지에서 정확한 본문·작성자·유일한 receipt를 확인한다. 기존 github-actions[bot]/Bot 요청도 정확히 일치할 때만 복구한다. 다른 작성자·변조 본문·중복 marker는 보류하고 재전송하지 않는다. 과거 ledger·실패 이력을 초기화하지 않는다.
- 종료 댓글은 기존 전체 본문 형식과 허용 작성자 검사를 유지한다. 독립 검증 nonce·본문에 포함된 예시·다른 key를 원래 outbox 완료로 쓰지 않는다. 같은 상태는 추가 요청0, 새 유효 상태는 기존 종료 확인 후 한 번만 재개하며 정책의 PR/dispatch 상한·CI·보호 영역·차단 라벨·사람 리뷰 경계를 유지한다.
- 수신 이벤트·필수 CI·policy JSON·sandbox·GitHub 보호 규칙·GITHUB_TOKEN 권한은 변경하지 않는다. 별도 예약·외부 서버·새 과금 API를 추가하지 않는다. 자동화 자체의 보호 파일 변경을 자동 승인하지 않으며 이번 변경도 현재 채팅의 명시 승인으로 검토한다.

이 통합의 합성 테스트는 실제 Event worker→Cloud 종료→같은 이벤트/다음 head 재개를 증명하지 않는다. 설치 후 실제 실행·원래 key의 독립 종료 댓글·ledger·job 재실행을 대조하기 전에는 #35를 닫거나 전체 자동 개발 루프 완료로 표시하지 않는다. 최초 workflow dispatch가 도구에서 지원되지 않으면 사용자에게 첫 실행만 요청하고 예약/polling으로 대체하지 않는다.

## 계기와 작업 선택

### 완료 큐의 후속 승인 작업

2026-10-23 KST 현재 채팅의 “멈추지 말고 자동화 돌리라고” 요청에 따라 기존 승인 작업을 이어가는 경로를 보완한다. `.github/approved-loop.json`의 기존 작업 정의와 순서는 그대로 보존하고 신뢰하는 main에서 검토·머지한 후속 정의만 끝에 추가한다. 기존 config hash를 새 목록의 앞부분과 비교하므로 과거 goal·approval·allowed_paths 변경/삭제/재정렬은 거절한다. 기존 작업 전부 completed·lease=null일 때만 새 작업을 queued로 추가하고, 완료 receipt·회차·bootstrap·기존 journal 파일/트리·parent를 보존한 non-force commit으로 저장한다. 같은 구성이면 추가 저장·발신하지 않는다. 응답 유실 후에는 현재 영속 상태부터 다시 읽는다.

이는 임의 스펙의 구현 승인을 만들거나 새 MVP·전송·권한을 자동 승인하는 기능이 아니다. 각 후속 작업은 목표·실제 승인 출처·허용 파일·기존 PR이 필요하며 기존 필수 CI·사람 리뷰·보호 경로·3회 상한을 유지한다. paused/진행 중 작업·잠금·동시 ref 변경·과거 정의 변경은 초기화하지 않는다. 현재 운영 검증은 큐 확장 후 실제 Cloud 수정→CI→리뷰→머지→main 검사를 확인하고 #35에 기록한다. 테스트 통과나 작업 요청만으로 전체 무인 실행 완료로 표시하지 않는다.

| 계기 | 처리 |
| --- | --- |
| 같은 저장소·허용 작성자의 main 대상 PR 생성/수정/ready/종료 | 현재 open PR과 main에 연결된 merged PR을 재조회 |
| Validation / Windows build / PR policy 완료 | 필수 check 전체 완료를 확인하고 대기 중 작업 재개 |
| 사람의 리뷰 제출/해제 | 쓰기 권한 없는 [Review wake-up](../.github/workflows/review-wakeup.yml) → main의 worker가 실제 리뷰를 재조회하도록 요청 |
| Cloud 종료 확인 댓글 | 고정 형식·허용 작성자만 wake-up으로 사용 |
| workflow_dispatch | 사용자가 현재 상태를 한 번 재조회; 시간 반복이 아님 |

이벤트는 성공·승인 증거가 아니다. 모든 파일/라벨/check/comment 페이지를 읽고 fork·다른 저장소·다른 작성자·차단 라벨은 처리하지 않는다. 보호 경로는 rename 전 경로까지 검사해 자동 실행에서 제외한다. main 정책의 PR 상한(현재 2개)을 지킨다. PR·이슈·라벨만으로 새 기능 승인을 만들지 않는다. 다음 새 MVP는 사용자 요청이나 신뢰하는 승인 범위가 필요하다.

각 PR의 현재 head/main/check ID·결과·시각과 작성자별 최신 유효 리뷰 결정으로 의미 키를 만든다. CI가 pending이면 AI 요청을 하지 않는다. 완료된 실패는 승인된 결함 수정 요청으로 전달할 수 있으나 머지 허가는 아니다. AI 자체 COMMENT는 사람 리뷰 wake-up으로 다시 요청하지 않는다.

## 내구성·동시 실행·복구

- 상태는 이 비공개 저장소의 **`automation/event-ledger` 브랜치, `.automation/event-ledger.json`**에 저장한다. 앱 main·제품 데이터·API 키를 변경하지 않는다. PR 번호·SHA·의미 키·댓글 ID·보류 원인과 lease만 보관한다.
- 저장은 현재 ref를 확인하고 그 SHA를 parent로 만든 새 commit에 **force=false fast-forward**를 적용한다. 동시 sibling commit은 함께 반영될 수 없으며 충돌을 덮어쓰지 않는다. GitHub Actions concurrency에 더해 ledger의 10분 lease를 사용한다. job timeout은 5분이다.
- `prepared → sending → dispatched` outbox를 먼저 영속 저장한다. POST 이후 중단되면 실제 GitHub 댓글 marker를 찾아 receipt를 복구한다. `sending`인데 결과 댓글을 찾을 수 없으면 재전송하지 않고 보류 이슈를 남긴다. 외부 댓글 API에 원자적 중복 방지 기능이 있다고 가정하지 않는다.
- Cloud 작업 종료가 확인되기 전에는 새 head가 와도 같은 PR의 다음 Cloud 요청을 보내지 않는다. 다음 이벤트에서 요청 후 60분이 지났는데 종료 확인이 없으면 보류 이슈 하나를 남긴다. 타이머로 Cloud를 재호출하지 않는다. 실행기는 종료 직전 `<!-- ais-cloud-result:<64자 key>:waiting_ci|completed|paused -->` 중 하나를 **독립된 댓글 전체 본문**으로 남기도록 요청한다. 허용된 사용자/공식 Codex bot의 고정 형식만 인식하며, 이 값은 실행 순서 조절용일 뿐 승인·CI·머지 증거가 아니다.
- 응답 유실·Cloud 보류·3회 dispatch 한도는 PR별 같은 marker의 보류 이슈 하나를 재사용한다. 3회는 수정 실패 수보다 보수적인 **전체 Cloud wake-up 상한**이다. 무한 반복하지 않는다. 한도가 찼거나 종료 확인이 없으면 수동 확인이 필요하다.
- 상태는 최대 256개 작업·1MB다. 자동으로 과거 중복 키를 버리지 않는다. 안전한 이관·압축·재개는 현재 수동 절차이며 삭제/리셋은 승인 없이 하지 않는다.
- Actions의 대기 실행이 합쳐져도 다음 실행은 이벤트 본문 한 건 대신 현재 PR/CI/merged main 상태 전체를 다시 확인한다. 중간 상태의 모든 이벤트 이력을 보존하는 큐라고 표현하지 않는다. 새 이벤트가 전혀 없으면 자동으로 시간 예약을 만들지 않으며 수동 dispatch로 복구한다.

## 권한과 머지 경계

이 구현에 한해 사용자 요청으로 새 worker job에 `contents: write`(ledger 브랜치의 CAS)·`issues: write`(제한된 PR 요청 댓글·중복 없는 보류 이슈)를 부여한다. 토큰의 저장소 권한 자체가 branch 단위로 강제되는 것은 아니다. 따라서 **특권 job은 main의 정확한 checkout만 실행하고 npm/PR 코드/PR artifact는 실행하지 않는다.** PR·fork 이벤트의 코드를 checkout하지 않고 토큰을 source/test 환경이나 Cloud 요청 본문에 넘기지 않는다. action은 immutable SHA에 고정하고 checkout credential을 남기지 않는다.

2026-10-19 KST 사용자가 기존 worker의 `pull-requests: read`를 `write`로 바꾸는 수정·권한 테스트·지침·운영 문서의 push·PR·CI 검증 후 머지와 새 합성 Draft PR의 실제 Cloud 요청·종료·중복 방지 검증을 별도로 승인했다(현재 채팅의 “승인할게 결과 보고해줘”). 격리된 비교 job 승인만으로 확대하지 않았다. GitHub 권한 자체는 댓글 전용이 아니며 PR 수정·머지 권한까지 포함할 수 있다. worker의 API 호출은 기존 제한된 댓글·ledger·보류 이슈 경로로 유지하고 PR 수정·머지 API는 호출하지 않는다. 당시 변경은 checks/actions 쓰기 권한·새 secret·시간 예약·모델 API를 추가하지 않았다. 이후 별도 승인된 사용자 토큰 연결은 위 절의 범위를 따른다. 기존 모호한 전송 ledger는 초기화하거나 재전송하지 않고, 새 합성 검증 PR의 정상 경로로 설치 후 검증한다.

기존 Validation·Windows build·PR policy의 read-only 권한과 필수 검사는 유지한다. 사람 리뷰 이벤트의 unprivileged relay에는 쓰기 권한·checkout·secret이 없다. receiver는 예산이 있는 모델 API·Codex CLI 로그인·ChatGPT cookie·숨겨진 Cloud API를 사용하지 않는다.

worker는 코드 수정·PR 생성·merge API를 직접 수행하지 않는다. Cloud 작업이 [기존 운영 정책](review-automation.md)과 main의 [정책 JSON](../.github/review-policy.json)을 읽고 승인 확인 → 코드 리뷰/수정 → CI → 정확한 head/base COMMENT → 실제 로그 증거·모든 페이지 원본 reviews → policy.mjs → expected SHA squash merge → 실제 merged/main CI를 검증한다. 보호 변경 자동 승인·self APPROVE·force-push·미해결 사람 리뷰 해제는 허용하지 않는다.

머지 후 main push의 checks/package는 PR의 pr-policy와 다르게 다룬다. 현재 main의 merge SHA에 연결된 PR을 재조회해 회귀 확인 작업을 요청한다. 회귀는 기존 정책의 관련 이슈·fix PR로 복구한다. 사용자가 승인하지 않은 새 스펙을 작업이 없다는 이유만으로 시작하지 않는다.

## 실제 검증과 한계

2026-10-21 KST v2 조정자의 [관측 기록](testing/archive/2026-10-21/pr-68-automation.md): 실제 Cloud 개발 결과→patch 반영→현재 merge 부모의 CI→완료 이벤트→다음 AI 리뷰 요청까지 확인했다. 중복 job의 추가 CI/개발 요청은0이다. 일반 GitHub 코드 리뷰 완료와 개발 작업 종료는 구분한다. 현재 native **리뷰** 완료를 기다리는 연결 결함 [#69](https://github.com/silverThunder09/ai-interview-studio/issues/69)은 미해결이며 A 자동 머지/main CI→B는 미검증이다. 아래 v1의 과거 설치/미확인 상태는 당시 기록이며 v2 전체 운영 성공을 의미하지 않는다. 최신 실행·승인·보류 상태는 [#35](https://github.com/silverThunder09/ai-interview-studio/issues/35)를 확인한다.

- [상태 전환 순수 함수](../scripts/review/event-loop.ts)와 [기존 합성 테스트](../tests/unit/event-loop.test.ts)는 유지한다. 공개 이벤트를 성공/승인 결과로 승격하지 않는다.
- [실행기 합성 테스트](../tests/unit/event-worker.test.ts): 중복 이벤트, Cloud 종료 전 새 head, 가짜 종료 댓글, POST 후 응답 유실, 전송 불명확 시 보류, 동시 lease·CAS·expiry, CI 누락/진행/출처 위조, 보호 경로, 상한, 페이지네이션, main 이동·머지 후 확인, 권한 실패를 검증한다.
- 로컬 Node 24.19.0에서 check·native TypeScript module 로딩을 실행한다. 이 테스트는 실제 GitHub token 권한·Codex 작업 시작·원격 crash 복구 성공을 대신하지 않는다. 실제 receiver 실행은 이 PR을 main에 설치한 뒤 Actions·ledger·댓글·Cloud 결과로 확인한다.
- 테스트 기록의 앱 기준과 개발 자동화 검증은 분리한다. 실제 실행/미검증/차단의 마지막 결과는 PR/이슈에서 확인한다. 저장소 파일만으로 ChatGPT의 webhook automation 설정이 등록됐다고 주장하지 않는다.

이전 오프라인 검증: 2026-10-18 KST main `6f14cee7f0d6701f2fdc42bb0f17793afa94773b` 위에서 단위 221개(당시 201 + 상태 전환 20)·정책 40개와 링크 38개/diff를 확인했다. 당시에는 실제 receiver·Cloud·원격 쓰기를 실행하지 않았다. 이 과거 결과를 현재 구현의 성공 증거로 재사용하지 않는다.

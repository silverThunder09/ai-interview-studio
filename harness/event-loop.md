# 이벤트 기반 개발 루프

## 승인과 실제 구성

2026-10-18 KST 사용자가 매시간 반복 예약을 중지하고 오프라인 설계를 승인했다. 예약 ID `6ad251b4923081918c9bcb8ec9eae602`의 일시정지를 확인했으며 다시 켜지 않는다. **2026-10-19 KST에는 이벤트 수신기·실행기 구현과 검증 후 머지를 요청했고, 별도 API 과금 없이 기존 Codex Cloud만 사용하도록 선택했다.** 이후 사용자가 새 Actions 실행과 contents:write·issues:write 권한 및 push·PR·검증 후 머지를 명시적으로 승인했다. 이번 구현은 이 요청에 따른다. 새 MVP·유료 모델 API·제품 키 재사용·외부 webhook 서버·공개 release는 포함하지 않는다.

[Event worker](../.github/workflows/event-worker.yml)가 GitHub의 저장소 이벤트를 받으며 [event-worker.ts](../scripts/review/event-worker.ts)가 신뢰하는 main의 정책과 GitHub 현재 상태를 재조회한다. 준비된 PR은 기존 GitHub Codex 연결의 `@codex` 댓글로 Cloud 작업을 요청한다. 별도 모델 API 키·외부 서버·시간 예약은 사용하지 않는다. Codex 사용량과 GitHub Actions는 기존 계정의 한도를 따르며 무제한/무비용 실행을 보장하지 않는다.

공식 연결 방법: [Codex GitHub integration](https://developers.openai.com/codex/integrations/github/). 댓글 작성 성공·👀 반응·자동 리뷰의 시작만으로 Cloud 구현 작업이나 전체 개발 루프가 성공했다고 판단하지 않는다. 실제 상태 댓글·코드/CI/머지 결과가 있어야 한다. 연결 검증 결과는 PR #26과 연결된 이슈에 기록하며, 미확인 상태는 완료로 보고하지 않는다.

초기에는 [Codex bot이 저장소 환경 생성을 요구했다](https://github.com/silverThunder09/ai-interview-studio/pull/26#issuecomment-6251982889). Legacy 환경 생성 후 수동 요청의 실제 작업 종료를 확인했다. [PR #44](https://github.com/silverThunder09/ai-interview-studio/pull/44) 설치 후 기존 worker의 [요청 댓글 전달](https://github.com/silverThunder09/ai-interview-studio/pull/45#issuecomment-6265460842) 1회와 동일 job 재실행의 추가 전달0회를 확인해 POST403 결함 [#40](https://github.com/silverThunder09/ai-interview-studio/issues/40)을 종료했다. 과거 실패 ledger는 보존했다. 그러나 Actions 봇 댓글의 실제 Cloud 접수·종료는 미확인이다. 사용자 지시로 [사용자 계정 요청](https://github.com/silverThunder09/ai-interview-studio/pull/45#issuecomment-6268907023)을 한 번 재시도하자 2026-10-19 22:55 KST [공식 Cloud 종료 응답](https://github.com/silverThunder09/ai-interview-studio/pull/45#issuecomment-6268934744)이 왔다(checkout 0fd3a46, main f5e4e94, Node24.19.0, 단위275·정책40, Git 변경 없음). 본문도 다르므로 발신자 차이만을 원인으로 단정하지 않으며, 수동 요청 성공을 원래 outbox의 종료 증거로 대체하지 않는다. [운영 검증 #35](https://github.com/silverThunder09/ai-interview-studio/issues/35)는 정상 자동 요청·종료·중복 방지까지 확인하기 전에는 닫지 않는다.

### 사용자 토큰 경로의 독립 검증안 — 승인 대기

현재 automation 도구에는 webhook schema 조회·triggers 입력이 없어 공식 Work 이벤트 작업을 여기서 등록할 수 없다. 시간 예약으로 대체하지 않는다. 다음 후보는 [독립 검증 workflow](../.github/workflows/user-comment-cloud-probe.yml)의 수동 dispatch로 사용자 계정 댓글 경로를 한 번 비교하는 것이다. 기존 Event worker·권한·ledger·정책은 바꾸지 않는다. 새 사용자 자격증명과 보호 workflow의 push·PR·CI 후 머지·실제 실행은 별도 명시 승인을 받기 전까지 진행하지 않는다. 이 문서나 후보 PR이 승인을 대신하지 않는다.

- job은 main에서만 수동 실행하며 checkout·외부 action·의존성 설치·시간 예약이 없다. GITHUB_TOKEN 권한은 비어 있고 새 GitHub Secret `AIS_CODEX_COMMENT_TOKEN`만 고정된 GitHub REST PR45 요청에 사용한다. 미설정이면 네트워크 요청 전에 실패한다. 토큰 값·응답 본문·환경 전체를 출력하지 않는다.
- 사용자가 [GitHub fine-grained token 설정](https://github.com/settings/personal-access-tokens/new)에서 직접 발급한다. Resource owner는 `silverThunder09`, Only select repositories는 `ai-interview-studio` 하나, 만료는 7일 이내, Repository permission은 Pull requests:read/write와 필수 Metadata:read만 선택한다. Contents/Actions/Issues/계정 권한은 추가하지 않는다. 토큰 자체는 댓글 전용이 아니며 PR 수정·머지에도 쓰일 수 있음을 승인 전에 알린다. 장기 통합에는 GitHub의 App 권장과 단기 비교 목적을 구분한다([공식 토큰 안내](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)).
- 승인 후 사용자가 [이 저장소 Actions secrets](https://github.com/silverThunder09/ai-interview-studio/settings/secrets/actions)에 위 이름으로 직접 저장한다. 채팅·Git·Cloud 환경 변수·제품 AI 키에 복사하지 않는다. 에이전트는 발급·secret 원문 읽기를 하지 않는다. 시험 후 이 전용 Secret과 토큰은 사용자가 삭제·폐기한다.
- 실행 전 에이전트가 검증용 PR45에 needs-user 라벨을 붙여 기존 worker의 추가 전송을 차단한 뒤 기존 Draft를 다시 연다. workflow는 PR45·작성자·같은 저장소·고정 head `0fd3a46450600069602f4a8fab9b7ba82b9880ae`·main 대상·Draft·차단 라벨을 검증한다. 모든 댓글 페이지에서 이전 동일 요청이 있으면 POST하지 않으며, 다른 작성자·본문·중복 marker가 있으면 보류한다.
- POST는 한 번뿐이며 응답의 작성자가 silverThunder09/User인지와 receipt를 확인한다. 작성자 검사는 전송 후 이루어지므로 잘못 발급한 토큰이면 이미 댓글이 생겼을 수 있다. 실패·응답 유실 시 댓글을 직접 대조하기 전에 재실행하지 않는다. 정상 전송을 확인한 경우에만 같은 job을 한 번 재실행해 중복 POST0을 확인한다.
- Cloud 작업은 읽기 전용 check·합성 식별자 `AIS_USER_TOKEN_CLOUD_PROBE_20261019_01`만 반환한다. 유료 모델 API·실제 개인정보·소스 수정·push·머지·기존 outbox 완료 marker 작성은 요청하지 않는다. 실제 Cloud 접수·테스트 종료 응답까지 확인한 뒤 검증 PR은 다시 머지 없이 닫고 임시 라벨만 제거한다.
- 이 비교가 성공해도 #35를 닫지 않는다. 영구 worker 전송·원래 key의 종료 receipt·다음 이벤트 재개 검증은 별도 구현/검증 범위다. 토큰 미설정·접수 실패를 우회하거나 새 권한을 추정해 확대하지 않는다.
- 로컬 Node24.19.0에서 타입·린트·단위285(검증 job의 합성 HTTP/중복/오류 경로10개 포함)·정책40을 통과했다. 처음 typecheck에서 테스트의 정규식 capture가 undefined일 가능성을 지적해 optional 접근을 보완한 후 전체 검사를 통과했다. YAML 수동 trigger/빈 기본 권한/단일 step, Bash·Node 문법, diff를 확인했다. 실제 토큰·원격 workflow·Cloud 호출은 미실행이며 이 결과는 실제 접수 성공 증거가 아니다.

## 계기와 작업 선택

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

2026-10-19 KST 사용자가 기존 worker의 `pull-requests: read`를 `write`로 바꾸는 수정·권한 테스트·지침·운영 문서의 push·PR·CI 검증 후 머지와 새 합성 Draft PR의 실제 Cloud 요청·종료·중복 방지 검증을 별도로 승인했다(현재 채팅의 “승인할게 결과 보고해줘”). 격리된 비교 job 승인만으로 확대하지 않았다. GitHub 권한 자체는 댓글 전용이 아니며 PR 수정·머지 권한까지 포함할 수 있다. worker의 API 호출은 기존 제한된 댓글·ledger·보류 이슈 경로로 유지하고 PR 수정·머지 API는 호출하지 않는다. checks/actions 쓰기 권한, 새 secret, 시간 예약, 모델 API를 추가하지 않는다. 기존 모호한 전송 ledger는 초기화하거나 재전송하지 않고, 새 합성 검증 PR의 정상 경로로 설치 후 검증한다.

기존 Validation·Windows build·PR policy의 read-only 권한과 필수 검사는 유지한다. 사람 리뷰 이벤트의 unprivileged relay에는 쓰기 권한·checkout·secret이 없다. receiver는 예산이 있는 모델 API·Codex CLI 로그인·ChatGPT cookie·숨겨진 Cloud API를 사용하지 않는다.

worker는 코드 수정·PR 생성·merge API를 직접 수행하지 않는다. Cloud 작업이 [기존 운영 정책](review-automation.md)과 main의 [정책 JSON](../.github/review-policy.json)을 읽고 승인 확인 → 코드 리뷰/수정 → CI → 정확한 head/base COMMENT → 실제 로그 증거·모든 페이지 원본 reviews → policy.mjs → expected SHA squash merge → 실제 merged/main CI를 검증한다. 보호 변경 자동 승인·self APPROVE·force-push·미해결 사람 리뷰 해제는 허용하지 않는다.

머지 후 main push의 checks/package는 PR의 pr-policy와 다르게 다룬다. 현재 main의 merge SHA에 연결된 PR을 재조회해 회귀 확인 작업을 요청한다. 회귀는 기존 정책의 관련 이슈·fix PR로 복구한다. 사용자가 승인하지 않은 새 스펙을 작업이 없다는 이유만으로 시작하지 않는다.

## 실제 검증과 한계

- [상태 전환 순수 함수](../scripts/review/event-loop.ts)와 [기존 합성 테스트](../tests/unit/event-loop.test.ts)는 유지한다. 공개 이벤트를 성공/승인 결과로 승격하지 않는다.
- [실행기 합성 테스트](../tests/unit/event-worker.test.ts): 중복 이벤트, Cloud 종료 전 새 head, 가짜 종료 댓글, POST 후 응답 유실, 전송 불명확 시 보류, 동시 lease·CAS·expiry, CI 누락/진행/출처 위조, 보호 경로, 상한, 페이지네이션, main 이동·머지 후 확인, 권한 실패를 검증한다.
- 로컬 Node 24.19.0에서 check·native TypeScript module 로딩을 실행한다. 이 테스트는 실제 GitHub token 권한·Codex 작업 시작·원격 crash 복구 성공을 대신하지 않는다. 실제 receiver 실행은 이 PR을 main에 설치한 뒤 Actions·ledger·댓글·Cloud 결과로 확인한다.
- 테스트 기록의 앱 기준과 개발 자동화 검증은 분리한다. 실제 실행/미검증/차단의 마지막 결과는 PR/이슈에서 확인한다. 저장소 파일만으로 ChatGPT의 webhook automation 설정이 등록됐다고 주장하지 않는다.

이전 오프라인 검증: 2026-10-18 KST main `6f14cee7f0d6701f2fdc42bb0f17793afa94773b` 위에서 단위 221개(당시 201 + 상태 전환 20)·정책 40개와 링크 38개/diff를 확인했다. 당시에는 실제 receiver·Cloud·원격 쓰기를 실행하지 않았다. 이 과거 결과를 현재 구현의 성공 증거로 재사용하지 않는다.

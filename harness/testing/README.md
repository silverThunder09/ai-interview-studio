# 테스트 기록과 아카이브

**지금 무엇이 통과했는지는 [최신 기록](latest.md)부터 읽는다.** 과거 결과는 아래 표와 [archive/](archive/)에서 찾는다. 자동 검증 성공과 실제 사용자 기기/API 검증은 구분한다.

## 진행 중 검증

[Phase 1 3D 기반의 실제 실행·검증](phase-1-3d.md): 단위513·정책41·build/라이선스·로컬 실제3D smoke 성공, 실제 화면 포함. 최초 Windows 원본10/패키지10 성공 후 픽셀 검사를 강화했으며 최신 PR CI를 별도로 확인한다. 앱의 최신 성공 기준을 아직 교체하지 않는다.

## 기록 목록

| 구분 | 기준일(KST) | 기능·상세 기록 | PR | 단위 / 정책 | Windows 원본 / 패키지 |
| --- | --- | --- | --- | --- | --- |
| 과거 | 2026-10-17 | [MVP 0 · Electron 기반과 리뷰 자동화](archive/2026-10-17/pr-01.md) | [#1](https://github.com/silverThunder09/ai-interview-studio/pull/1) | 39 / 40 | 1 / 1 |
| 과거 | 2026-10-17 | [이력서 PDF/DOCX 추출·검토](archive/2026-10-17/pr-05.md) | [#5](https://github.com/silverThunder09/ai-interview-studio/pull/5) | 54 / 40 | 2 / 2 |
| 과거 | 2026-10-17 | [로컬 텍스트 면접·SQLite 기록](archive/2026-10-17/pr-08.md) | [#8](https://github.com/silverThunder09/ai-interview-studio/pull/8) | 72 / 40 | 3 / 3 |
| 과거 | 2026-10-17 | [AI 질문 공급자 공통 계약](archive/2026-10-17/pr-13.md) | [#13](https://github.com/silverThunder09/ai-interview-studio/pull/13) | 119 / 40 | 3 / 3 |
| 과거 | 2026-10-17 | [비동기 질문 생성·취소·저장 일관성](archive/2026-10-17/pr-14.md) | [#14](https://github.com/silverThunder09/ai-interview-studio/pull/14) | 132 / 40 | 3 / 3 |
| 과거 | 2026-10-17 | [OpenAI·Claude·Gemini 텍스트 면접](archive/2026-10-17/pr-15.md) | [#15](https://github.com/silverThunder09/ai-interview-studio/pull/15) | 163 / 40 | 4 / 4 |
| 과거 | 2026-10-17 | [답변을 유지하며 API 키 재등록](archive/2026-10-17/pr-18.md) | [#18](https://github.com/silverThunder09/ai-interview-studio/pull/18) | 163 / 40 | 4 / 4 |
| 과거 | 2026-10-17 | [음성 입력·전사·답변 검토](archive/2026-10-17/tests-2026-10-17-pr19.md) | [#19](https://github.com/silverThunder09/ai-interview-studio/pull/19) | 186 / 40 | 5 / 5 |
| 과거 | 2026-10-18 | [질문 음성 읽기·재생/중지](archive/2026-10-18/tests-2026-10-18-pr21.md) | [#21](https://github.com/silverThunder09/ai-interview-studio/pull/21) | 201 / 40 | 6 / 6 |
| 과거 | 2026-10-18 | [통합 음성 연습·전사 검토·직접 제출](archive/2026-10-18/tests-2026-10-18-pr24.md) | [#24](https://github.com/silverThunder09/ai-interview-studio/pull/24) | 201 / 40 | 6 / 6 |
| 과거 | 2026-10-18 | [UI·API 설정 분리와 OS 보호 저장](archive/2026-10-19/tests-2026-10-18-pr31.md) | [#31](https://github.com/silverThunder09/ai-interview-studio/pull/31) | 220 / 40 | 8 / 8 |

| 최신 | 2026-10-19 | [전체 시각 디자인·테마·최소 창 크기](latest.md) | [#34](https://github.com/silverThunder09/ai-interview-studio/pull/34) | 220 / 40 | 9 / 9 |

각 숫자는 해당 최종 SHA의 성공 실행에서 읽었다. Windows 숫자는 큰 사용자 흐름을 묶은 smoke 개수다. 각 테스트의 assertion 수·코드 커버리지 비율·실제 사용자 환경 성공률은 아니다. 모든 과거 개수를 합산해 현재 테스트 수로 제시하지 않는다.

## 여기서 말하는 테스트

자동화 회귀의 당시 성공 기록: [2026-10-21 · PR #68의 CI 대상 커밋 검증과 A 작업 연결 관측](archive/2026-10-21/pr-68-automation.md). 단위464·정책41·Windows smoke 각9의 PR 검증과 이후 A의 실제465개 검증을 구분해 기록했다. 전체 A→B 완료는 미검증이며 앱의 최신 기준을 교체하지 않는다. 색인의 `scope: automation` 항목으로 검색할 수 있다.

앱 기준 기록과 별도로 [이벤트 루프·실행기의 검증과 한계](../event-loop.md#실제-검증과-한계)을 관리한다. 실제 이벤트 수신·AI 실행 성공을 뜻하지 않으며 앱의 최신/과거 기준을 교체하지 않는다.

| 종류 | 의미 | 해석할 때 주의할 점 |
| --- | --- | --- |
| TypeScript / ESLint | 타입·정적 규칙 검사 | 앱을 실행해 본 결과와 다름 |
| 단위 테스트 | 입력 검증·파서·SQLite·AI/음성 계약과 실패 경로 | 실제 SQLite 검증과 합성 provider/장치를 구분 |
| 리뷰 정책 부정 테스트 | 머지 거절 조건·리뷰 집계·CI 증거 판정 | 독립적인 사람의 코드 승인이나 제품 품질 점수가 아님 |
| build / package | 번들과 Windows 실행 파일 생성 | 생성 성공만으로 사용 흐름 성공을 뜻하지 않음 |
| Windows smoke | 실제 Electron UI·IPC·보안·저장을 원본/패키지에서 실행 | 합성 마이크/문서/응답이며 사용자 하드웨어·실제 과금 검증은 아님 |
| 수동 확인 | 사용자가 실제 앱·장치·문서/서비스에서 확인 | 결과를 받기 전에는 미실행으로 유지 |

## 찾는 방법

- 사람은 위 표에서 기능·PR·날짜로 찾는다. 예: 설정 보존 → 최신 기록, 통합 음성 연습 → PR #24, 질문 음성 읽기 → PR #21, 음성 입력 → PR #19, PDF → PR #5, 키 재등록 → PR #18.
- 텍스트 검색 예: `rg -n '음성|transcription' harness/testing`, `rg -n 'pr18|9ad35898' harness/testing`.
- 인덱싱 도구는 [index.json](index.json)의 `records`를 읽는다. ID·상태·KST 날짜·PR·태그·문서 경로·검사 SHA·개수·실행 증거를 제공한다. 경로는 이 폴더 기준 상대 경로다.
- 과거 SHA는 그때의 코드 기준이다. 현재 코드가 달라졌다면 현재 성공 증거로 사용하지 않는다.

## 기록·아카이브 운영

1. 기능 변경/중요한 회귀 검증이 완료되면 실제 명령·환경·결과·실행 링크·검사 SHA·범위/한계를 함께 기록한다. 확인되지 않은 항목은 `미실행`, 환경 때문에 실행하지 못한 항목은 `환경 차단`, 실제 실패는 `실패`로 적는다.
2. 새 앱 기준 기록으로 교체할 때 이전 `latest.md`를 `archive/YYYY-MM-DD/<기존 기록 ID>.md`로 보존하고 내부 상대 링크를 새 위치에 맞춘다. 이전 ID·SHA·실행 링크·당시 결과를 유지한다. 이번 최초 이관 파일명은 검색하기 쉬운 `pr-NN.md`를 사용했다.
3. 새 `latest.md`와 `index.json`을 함께 갱신한다. 기존 JSON 항목을 삭제하지 않고 `archived`로 바꿔 새 경로를 연결한다. 기록 ID는 바꾸거나 재사용하지 않는다.
4. 실패→수정→재검증이 있었다면 관련 이슈/커밋·실패 원인과 최종 결과를 구분한다. 과거 실패를 성공으로 덮어쓰지 않는다. 새 검증을 위해 기존 앱 코드/테스트를 바꾸거나 개인정보/secret/전체 로그를 문서에 복사하지 않는다.
5. 단순 문서 CI·변경 없는 반복 실행은 앱의 새 기준 버전을 만들지 않는다. 해당 PR 검증 절에 결과를 남긴다. 문서 링크/diff/색인을 검사하고, 앱 코드를 다시 빌드하거나 같은 검사를 무한 반복하지 않는다.
6. 로그/artifact는 삭제·만료될 수 있다. 실행/PR/commit 링크와 검증 당시 추출한 SHA·숫자·CI 증거를 이 문서와 JSON에 보존한다. 이 사본은 당시 관측 기록이며 GitHub 서명이나 미래 머지의 승인 근거를 대신하지 않는다. 실제 머지 시에는 항상 최신 API/로그 증거를 새로 확인한다.

최초 이관은 기능 PR #1·#5·#8·#13·#14·#15·#18·#19의 최종 성공 head를 다뤘다. 이후 PR #21·#24·#31 기준과 수정/재검증 이슈 #22·#32를 추가했다. 모든 중간 실패·취소·로컬 반복 실행의 전수 로그를 복원한 것은 아니다. 알려진 수정 이슈는 해당 과거 기록에서 연결하고 최신 기록에는 Linux 환경 차단과 실제 하드웨어/API 미검증을 남겼다.

개발/검증 절차의 기준은 [workflow](../workflow.md), 기능 범위는 [architecture](../architecture.md)와 [스펙](../specs/), 개인정보·장치 경계는 [security](../security.md)다. 이 기록은 검사·sandbox·승인 정책을 변경하지 않는다.

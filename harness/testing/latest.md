# 최신 앱 테스트 기록 — 통합 음성 연습까지

[전체 목록·찾는 방법](README.md) · [검색용 JSON](index.json) · [PR #24](https://github.com/silverThunder09/ai-interview-studio/pull/24)

**2026-10-18 KST, main `cab1ef0250b11169ab1e345d89e7cb4437bdad87`의 일반 검사와 Windows 원본·패키지 앱 검사가 성공했다.** 실제 사용자 하드웨어와 유료 API는 검증하지 않았다.

- 기록 ID: `tests-2026-10-18-pr24`
- 적용 기능: 이력서 PDF/DOCX 검토, 텍스트 면접·기록, 외부 API 질문 생성, 음성 전사·답변 검토, 현재 질문의 음성 읽기·재생/중지, 듣기 → 녹음·전사 → 검토·직접 제출의 통합 흐름.
- 판정: **자동 검증 통과**. 이후 코드 변경이나 실제 사용자 환경까지 보장하는 뜻은 아니다.
- 이 기록은 해당 SHA의 고정 스냅샷이다. 문서 PR의 CI는 해당 PR에서 확인하며 앱 검증 기준을 자동으로 바꾸지 않는다.
- 이전 [PR #21 질문 음성 읽기 기준](archive/2026-10-18/tests-2026-10-18-pr21.md)은 ID·SHA·실행 링크를 보존해 아카이브로 옮겼다.

## 성공한 검사 — 무엇이 통과했나

| 검사 | 결과 | 무엇을 확인했나 |
| --- | --- | --- |
| TypeScript / ESLint | 성공 | 타입·정적 규칙 위반 없음 |
| 단위 테스트 | 201개 통과 | 입력·권한·파서·저장·AI/음성 실패 경로, TTS 생성·재생 자원 |
| 리뷰/머지 정책 테스트 | 40개 통과 | 미해결 변경 요청·이전 SHA·누락 증거 등 거절 |
| 앱 번들 build | 성공 | main/preload/renderer 번들 생성 |
| Windows 원본 앱 smoke | 6개 통과 · 37.3s | 실제 Electron에서 아래 6개 흐름 실행 |
| Windows 패키지 앱 smoke | 6개 통과 · 27.0s | 패키징한 실행 파일에서 같은 흐름 실행 |
| Windows portable 패키징 | 성공 | exe·체크섬·라이선스 artifact 생성 |

201 + 40 = 241은 단위/정책 검사의 합계다. Windows의 6개 흐름을 원본·패키지에서 각각 실행한 것이므로 서로 다른 기능 12개로 세지 않는다. 과거 개수도 합산하지 않는다.

## 단위 테스트 — 어떤 문제를 막는 검사인가

| 영역 | 주요 확인 내용 | 세부 케이스 |
| --- | --- | --- |
| 설정 | 잘못된 테마·추가 필드 거절, 설정 변경·초기값 | [contracts.test.ts](../../tests/unit/contracts.test.ts) |
| 자산·IPC 송신자 | 경로 탈출/위장 URL 거절, 정확한 창·프레임·개발 주소 | [policy.test.ts](../../tests/unit/policy.test.ts) |
| 문서 입력·파싱 | 문서 서명·크기·ZIP/XML 한도와 손상·빈 문서·한글 추출 | [resume.test.ts](../../tests/unit/resume.test.ts) |
| 파서 수명주기 | 취소·시간 초과·worker 정리와 오래된 응답 | [resume-worker.test.ts](../../tests/unit/resume-worker.test.ts) |
| 면접·실제 SQLite | 동의·질문 순서·중복/충돌·rollback·복원·삭제·근거 출처 | [interview.test.ts](../../tests/unit/interview.test.ts) |
| AI 질문 계약 | 선택 문맥만 전송, 허구 근거/잘못된 응답 거절, 오류 비노출·취소 | [ai-question-provider.test.ts](../../tests/unit/ai-question-provider.test.ts) |
| 비동기 면접 서비스 | DB 밖에서 생성 대기, 중복 병합·취소·저장 원자성 | [interview-service.test.ts](../../tests/unit/interview-service.test.ts) |
| 외부 API adapter | 세 서비스 요청/응답, 메모리 키·예산·합성 인증/429·stream 취소 | [external-ai.test.ts](../../tests/unit/external-ai.test.ts) |
| 음성 전사 경계 | audio-only 권한·WebM/Opus·한도·현재 질문·최소 payload·늦은 결과 | [voice.test.ts](../../tests/unit/voice.test.ts) |
| 녹음 리소스 | 권한 거절/장치 없음·중지·이탈 후 늦은 허용·트랙 해제 | [voice-recorder.test.ts](../../tests/unit/voice-recorder.test.ts) |
| 질문 음성 생성 | 현재 질문/동의·고정 endpoint·별도 예산·오류 정제·MP3/크기·중복·취소/timeout·늦은 결과 | [speech.test.ts](../../tests/unit/speech.test.ts) |
| 질문 음성 재생 | 자동 재생 없음·stop/end/90초 제한·URL 해제·캐시 재생·디코더 실패·늦은 play 거절 | [speech-player.test.ts](../../tests/unit/speech-player.test.ts) |

서비스 응답·장치는 합성이며 SQLite는 임시 파일을 실제로 사용한다. TTS 단위 15개를 포함한 총 201개다. 이번 UI 작업은 새 단위 테스트를 추가하지 않고 기존 Windows smoke의 통합 검증 범위를 넓혔다. 자동 검증은 모든 결함을 발견한다는 보증이 아니다.

## Windows에서 실행한 6개 흐름

| 흐름 | 확인 내용 | 테스트 파일 |
| --- | --- | --- |
| 데스크톱 기본·보안 | 한국어·테마·재시작, Node 격리·다른 창 IPC 거절·탐색·네트워크·장치 거절 | [desktop.spec.ts](../../tests/smoke/desktop.spec.ts) |
| 이력서 검토 | 합성 PDF/DOCX·한글 추출, 수정/검토·취소·실패 후 보존·비우기 | [resume.spec.ts](../../tests/smoke/resume.spec.ts) |
| 로컬 연습·기록 | 저장 동의·12개 답변·실패 보존·재시작 이어하기·삭제·선택 음성 비용 안내 | [interview.spec.ts](../../tests/smoke/interview.spec.ts) |
| 외부 AI 면접 | 선택 구절/동의·합성 질문·예산·키 재등록·입력 보존 | [external-ai.spec.ts](../../tests/smoke/external-ai.spec.ts) |
| 음성 입력 | 합성 마이크의 실제 MediaRecorder, 개별 동의·합성 429/재시도·검토/교체·적용 후 포커스와 직접 제출 | [voice.spec.ts](../../tests/smoke/voice.spec.ts) |
| 통합 음성 연습 | MP3 재생/중지 → 녹음 전환과 트랙 해제 → 새 동의 후 전사 → 수정/교체 → 답변 포커스·DB 미저장 → 직접 제출·다음 질문 단계 초기화, 외부 media CSP 차단 | [speech.spec.ts](../../tests/smoke/speech.spec.ts) |

TTS는 직접 만든 합성 무음 MP3를 실제 HTMLAudioElement로 디코딩/재생한다. CI는 `--mute-audio`를 사용하므로 실제 스피커 출력/음질 검증으로 표현하지 않는다. sandbox는 유지한다. 소스 링크는 탐색용이며 당시 기준은 아래 SHA와 실행 로그다.

## 실제 실행 링크와 SHA

### 머지 후 main 재검증

- [main Validation / checks](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39092304758/job/117571433617): TypeScript·ESLint·단위 201개·정책 40개·build 성공.
- [main Windows / package](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39092304739/job/117571433437): 원본 6개·패키지 6개·portable 생성 성공.
- 두 push run의 head는 `cab1ef0250b11169ab1e345d89e7cb4437bdad87`, attempt는 각각 1 / 1이며 성공했다. PR 전용 evidence와 main push 검증을 혼동하지 않는다.

### PR #24의 머지 전 검증

| 검사 | run / job | 실제 Record tested head and base 단계 |
| --- | --- | --- |
| [checks](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39090131977/job/117564934828) | 39090131977 / 117564934828 | 성공 |
| [package](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39090131978/job/117564934947) | 39090131978 / 117564934947 | 성공 |
| [pr-policy](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39092231188/job/117571217995) | 39092231188 / 117571217995 | 성공 |

| SHA 구분 | 값 |
| --- | --- |
| 검사한 PR head | `1caa1cae5e874125d5a267deafd66d6ecd436b00` |
| 검사한 base | `9c8f9a5d04337ba2fedf06e9d5bf30e36d965b3b` |
| 실제 PR merge checkout | `09878491c551f84aae387efffabfb43e27785af8` |
| 머지 후 main commit | `cab1ef0250b11169ab1e345d89e7cb4437bdad87` |

성공한 세 job의 Record tested head and base 실제 명령 출력에 있는 마지막 유효 AIS_CI_EVIDENCE의 repository·PR·run·head·base·checkout을 대조했다. 최신 attempt/Actions 출처·전체 REST reviews·라벨·스레드·관련 이슈를 확인하고 main의 merge 판정기를 실제 증거 JSON으로 실행했다. PR 본문/댓글의 비슷한 문자열은 증거가 아니다. 구조화한 값은 [index.json](index.json)에 보존한다.

## 이번 검증과 과거 실패 이력

이번 PR #24의 최종 head와 머지 후 main은 위 검사에서 모두 성공했다. 테스트 개수는 이전 기준과 같지만, 기존 음성 smoke에 단계 전환·포커스·적용 직후 DB 미저장·직접 제출·다음 질문 초기화 검증을 추가했다.

이전 PR #21의 문구 locator 실패와 이슈 #22의 수정/재검증은 [당시 기록](archive/2026-10-18/tests-2026-10-18-pr21.md)에 보존한다. 과거 실패를 이번 PR의 실패로 복사하거나 삭제하지 않는다.

## 성공으로 기록하지 않은 항목

| 항목 | 상태와 이유 |
| --- | --- |
| Linux Electron 화면 smoke | **환경 차단**: OS sandbox의 shutdown Operation not permitted로 시작 실패. sandbox를 해제하지 않음 |
| 실제 Windows 사용자 PC·마이크·스피커·OS 권한 | **미실행**: CI 합성 장치/무음 재생과 구분 |
| 실제 개인 이력서/음성의 정확도 | **미실행**: 합성 fixture만 사용 |
| 실제 OpenAI·Claude·Gemini 인증/모델 접근·요금·보존·생성/전사/TTS 품질 | **미실행**: main fetch를 합성 응답으로 대체, 실제 유료 호출 없음 |
| 실시간 음성 대화·끼어들기·카메라 | **범위 밖**: 구현/검증 완료로 표현하지 않음 |

## 사람이 직접 확인하려면

검증한 앱은 [main Windows 실행](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39092304739)의 `ai-interview-studio-windows-x64` artifact에서 받는다. 합성/비민감 문서로 텍스트 연습·기록/복원/삭제를 확인한다. 현재 질문에서 '1. 질문 듣기' → 본인 OpenAI 키/지원 모델/음성·전송 동의 → 만들기/재생 → '답변 녹음 단계로 이동' → 마이크 동의 후 녹음/중지 → 별도 전송 동의 후 전사 → 검토/수정·교체 확인 후 적용 → '3. 답변 검토·제출'에서 직접 제출 순서다. 단계 이동만으로 녹음·전송·저장을 시작하지 않는다. 실제 서비스 이용은 사용자의 개별 선택이며 수동 확인 결과를 받기 전에는 성공으로 기록하지 않는다.

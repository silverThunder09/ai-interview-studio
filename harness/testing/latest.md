# 최신 앱 테스트 기록 — UI·API 설정 분리와 보호 저장

[전체 목록·찾는 방법](README.md) · [검색용 JSON](index.json) · [기능 PR #31](https://github.com/silverThunder09/ai-interview-studio/pull/31)

**2026-10-18 KST, main `9c09e63ee0850b7bb58f413543eb3f20db16382f`에서 단위 220개·리뷰 정책 40개·Windows 원본/패키지 각 8개가 통과했다.** 실제 유료 API·개인 자료·사용자 하드웨어는 검증하지 않았다.

- 기록 ID: `tests-2026-10-18-pr31` · 판정: **자동 검증 통과**.
- 적용 기능: 이력서 검토, 로컬/외부 AI 면접·기록, 음성 입력/읽기와 기존 흐름, 별도 API 설정 창, 테마·서비스별 질문 모델·선택한 키의 재실행 복원/삭제.
- 이 기록은 위 앱 SHA의 고정 스냅샷이다. 문서 PR의 CI와 이후 코드 변경은 이 앱 기준을 바꾸지 않는다.
- 이전 [PR #24 통합 음성 연습 기준](archive/2026-10-18/tests-2026-10-18-pr24.md)은 ID·SHA·실행 링크와 당시 결과를 보존했다. 테스트 수를 과거 기록과 합산하지 않는다.

## 성공한 검사

| 검사 | 결과 | 확인 내용 |
| --- | --- | --- |
| strict TypeScript / ESLint | 성공 | 타입·정적 규칙 |
| 단위 테스트 | 220개 통과 | 13개 파일의 입력·문서·SQLite·AI/음성·설정 보존과 실패 경로 |
| 리뷰/머지 정책 테스트 | 40개 통과 | 변경 요청 집계·이전 SHA·누락/위조 CI 증거·보호 변경 거절 |
| 앱 번들·Windows portable | 성공 | main/preload/renderer·exe·체크섬·라이선스 |
| Windows 원본 앱 smoke | 8개 · 50.7초 | 실제 Electron UI·IPC·보안·저장 |
| Windows 패키지 앱 smoke | 8개 · 45초 | 패키징한 앱에서 같은 8개 흐름 |

단위 220개와 정책 40개, 원본/패키지의 8개 흐름은 서로 다른 종류의 수치다. assertion 수·커버리지 비율·사용자 환경 성공률이 아니다. 로컬에서도 `npm run check`, `npm run build`, `git diff --check`를 실행했고 성공했다. Windows CI는 lockfile 설치부터 패키징까지 별도로 수행했다.

## 실제 Windows에서 실행한 8개 흐름

| 흐름 | 이번에 확인한 내용 | 테스트 |
| --- | --- | --- |
| 데스크톱·보안 | 한국어·테마 재실행 복원, 좁은 API·다른 창 거절·sandbox·CSP·장치 거절 | [desktop.spec.ts](../../tests/smoke/desktop.spec.ts) |
| 이력서 검토 | 합성 PDF/DOCX·한글, 수정/검토·취소·실패 후 내용 보존 | [resume.spec.ts](../../tests/smoke/resume.spec.ts) |
| 로컬 연습·기록 | 저장 동의, 질문/답변 순서·실패 보존·12개 답변·재시작·삭제 | [interview.spec.ts](../../tests/smoke/interview.spec.ts) |
| 외부 AI 면접 | 별도 설정에서 모델 ID 형식 검사, 선택 구절/매 전송 동의, 예산·임시 키의 재시작 재등록과 답변 보존 | [external-ai.spec.ts](../../tests/smoke/external-ai.spec.ts) |
| Gemini 회귀 | strict 합성 REST의 JSON MIME enum·HTTP 400/404·불완전 응답 구분과 답변 유지 | [gemini.spec.ts](../../tests/smoke/gemini.spec.ts) |
| 설정 보호 저장 | 실제 Electron safeStorage 암복호화·파일/IPC 평문 부재, 키/모델/테마 복원, 서비스별 삭제 후 재실행, dialog 초점/Escape | [settings.spec.ts](../../tests/smoke/settings.spec.ts) |
| 음성 입력 | 실제 합성 마이크/MediaRecorder·개별 동의·429/재시도·검토/교체/적용·직접 제출 | [voice.spec.ts](../../tests/smoke/voice.spec.ts) |
| 통합 음성 연습 | 합성 MP3 디코딩/재생/중지, 설정 열기 시 재생·녹음 정리와 답변 보존, 동의 재확인·직접 제출·외부 media 차단 | [speech.spec.ts](../../tests/smoke/speech.spec.ts) |

Windows 보호 저장은 실제 OS의 safeStorage를 사용했다. 개인 키 대신 합성 키만 사용하고 외부 AI/음성 응답은 main fetch를 대체했다. MP3는 합성 무음이며 실제 스피커 출력·음질 확인이 아니다. OS sandbox·renderer 네트워크 차단을 유지하고 각 테스트는 별도 임시 profile을 사용했다.

새 [local-settings.test.ts](../../tests/unit/local-settings.test.ts)의 8개 단위 케이스는 암호화 불가/`basic_text`, 임시 등록과 기존 저장본 삭제, 쓰기·삭제 충돌, 손상/미래/과대 파일, 복호화 실패, 엄격한 IPC를 검증한다. 단위 검사의 crypto adapter는 합성이며 실제 OS 보호 검증은 Windows smoke와 구분한다. 나머지 계약·파서·SQLite·AI/음성 단위 테스트도 현재 SHA에서 다시 통과했다.

## 실제 실행 링크와 검사 SHA

### 머지 후 main 재검증

- [Validation / checks](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39125406989/job/117669383647): 단위 220개·정책 40개·타입/lint/build 성공.
- [Windows / package](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39125407092/job/117669384374): 원본 8개·패키지 8개·portable/notices/체크섬/artifact 성공.
- 두 push run은 head `9c09e63ee0850b7bb58f413543eb3f20db16382f`, 최신 attempt 각각 1, 성공이다. PR 전용 CI 증거와 main push 검증을 혼동하지 않는다.

### PR #31 머지 전 검증

| 검사 | run / job | Record tested head and base |
| --- | --- | --- |
| [checks](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39124912469/job/117667873778) | 39124912469 / 117667873778 | 성공 |
| [package](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39124912460/job/117667894545) | 39124912460 / 117667894545 | 성공 |
| [pr-policy](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39125323149/job/117669132803) | 39125323149 / 117669132803 | 성공 |

| 구분 | SHA |
| --- | --- |
| 검사한 PR head | `a46c14b3741db89c49ae31aa352cc3bc07aa32f2` |
| 검사한 base | `f008472b9c46d616731ffb539fad653863f60791` |
| 실제 PR merge checkout | `b5fbbb03cf35d45df5ff73d1d53cea980b3c7bcc` |
| 머지 후 main | `9c09e63ee0850b7bb58f413543eb3f20db16382f` |

성공한 세 job의 실제 Record tested head and base 명령 출력에서 마지막 유효 AIS_CI_EVIDENCE JSON을 읽어 repository·PR·run·head·base·checkout을 대조했다. 원본 REST reviews 전체 페이지·라벨·스레드·연결 이슈와 최신 attempt/Actions 출처를 확인하고 trusted main의 판정기를 실제 API 증거로 실행해 allowed=true를 확인했다. expected head squash merge 후 실제 merged 상태와 main CI도 확인했다. PR 본문·댓글은 증거로 사용하지 않았다. 추출한 값은 [색인](index.json)에 보존한다. AI 자체 검토이며 사람의 독립 승인이 아니다.

## 발견한 결함과 수정

[이슈 #32](https://github.com/silverThunder09/ai-interview-studio/issues/32): 별도 설정 창을 열어도 녹음/재생 component가 유지되어 오디오 작업이 계속되는 P2를 코드 리뷰에서 발견했다. 수정 `30e325eecdadd9533039e7aede3cabb06d42ef36`와 최종 head의 수동 단계 재개/초점 보완 `a46c14b3741db89c49ae31aa352cc3bc07aa32f2`를 반영했다. 설정 열기 시 기존 cleanup을 실행하고 답변은 유지하는 흐름을 원본·패키지에서 확인한 뒤 이슈를 닫았다.

초기 두 head의 CI는 코드 수정에 따른 새 실행으로 취소됐다. 이 취소를 성공으로 세지 않고 최종 head의 완료된 실행만 사용했다. 최초 로컬 typecheck의 optional 속성/unknown narrowing 오류는 수정 후 check/build로 재검증했다. PR #28·#30의 이전 모델 ID/Gemini 프로토콜 수정은 이번 최신 회귀에 포함되며 당시 결과는 각 PR·이슈에 있다. PR #24와 그 이전의 결과는 아카이브에 그대로 둔다.

## 성공으로 기록하지 않은 항목

| 항목 | 상태·이유 |
| --- | --- |
| 실제 사용자 Windows PC·마이크·스피커·OS 권한 | 미실행 — CI 합성 장치/무음 재생과 구분 |
| 실제 개인 이력서/음성 정확도 | 미실행 — 합성 문서/음성만 사용 |
| 실제 서비스 키·모델 접근·과금·보존·생성/전사/TTS 품질 | 미실행 — 유료 호출·개인 자료 전송 없음 |
| 현재 작업의 Linux Electron 화면 | 미실행 — 이전 실행의 sandbox 환경 차단을 성공으로 재사용하지 않았고 이번에 sandbox를 해제하지 않음 |
| 음성 모델/voice·미제출 답변·전송 동의의 추가 보존 | 범위 밖 — 보존한 값은 테마·질문 서비스/모델·선택한 키 |
| 실시간 대화·카메라·이벤트 자동화 활성화 | 범위 밖 |

## 직접 확인하는 순서

[이 앱 SHA의 Windows 빌드](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39125407092)에서 artifact를 내려받아 기존 앱을 닫고 새 exe를 실행한다. 설정에서 서비스·질문 모델을 저장하고 합성/본인 키의 보존 여부를 직접 선택한다. 앱 재실행 후 테마·서비스/모델·등록 상태가 복원되는지 확인하고 서비스별 키 삭제 후 다시 실행해 미등록인지 확인한다. 저장된 키는 다시 표시하지 않는다. 설정을 열고 닫을 때 작성 중 검토본·답변은 유지하고 오디오는 직접 다시 시작한다. 실제 API 요청은 별도 동의 시 요금·서비스 보존 정책이 적용되므로 개발 자동 검증과 구분한다. 수동 결과를 받기 전에는 성공으로 기록하지 않는다.

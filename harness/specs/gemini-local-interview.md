# Gemini 두 면접관·로컬 음성/화상 면접 — 리팩터링 설계안

상태: **Phase 0 문서 변경안 / 제품 구현 미착수**. 2026-10-22 KST 현재 채팅의 첨부 「프로젝트 방향 재정립 및 전체 리팩터링」, 중지 후 “다시 진행해” 지시가 출처다. 첫 실행은 분석·설계 문서안까지라는 요청을 따른다. 문서 검토·후속 Phase 승인 전에 제품 코드·장치 정책·의존성·자동화 큐를 바꾸지 않는다. 이 문서가 미래 기능·개인 자료 전송·실제 유료 테스트의 승인 근거가 되지 않는다.

## 현재 상태 분석

분석 기준: main **f908ca4b19a83a1d2aeb2a1e8aacab2560c0e10f**. README/이전 스펙의 완료 문구만 옮기지 않고 아래 소스·호출부·테스트와 대조했다.

| 현재 확인한 경로 | 실제 구현 | 재사용·변경 판단 |
| --- | --- | --- |
| src/main/resume.ts, renderer/src/resume/{parse,pdf,docx,resume.worker}.ts | 선택한 PDF/DOCX 제한 읽기·격리 추출·페이지/단락 근거·검토 | 유지. OCR·스캔 PDF는 새 기능으로 섞지 않음 |
| src/main/ai-question-provider.ts | 질문 번호별 experience/technical/follow-up, 허용 근거 id와 snapshot 검증, 30초·취소 | 근거·실패 처리 재사용. 현재 JSON은 text/evidenceId뿐이며 speaker·성격 없음 |
| src/main/external-ai.ts | main native fetch, OpenAI/Claude/Gemini 고정 endpoint, header 키, 구조화 응답 | Gemini adapter 재사용. 현재 usageMetadata를 반환·저장하지 않음 |
| InterviewProviderRouter.next | 첫 질문에 선택한 180자 구절, 짝수 후속 질문에 직전 답변, 일반 기술 질문에 번호만 전송 | 전체 대화·원문을 이미 공유한다고 표현하지 않음. 두 역할의 제한된 공유 문맥을 새로 설계 |
| src/main/interview-service.ts | 외부 생성은 DB transaction 밖에서 대기; 중복 promise·취소·늦은 응답 폐기 | 유지·확장. 독립 실시간 음성 상태 머신은 없음 |
| src/main/interview-store.ts, src/shared/interview.ts | schema 2, 질문/답변 순서·12개 답변·100세션·복원/삭제·엄격한 JSON 검증 | schema 1/2 호환 유지. speaker·프로필·사용량·리포트 없음 |
| src/main/voice.ts, renderer/src/voice-recorder.ts, VoiceInput.tsx | 한시적 audio-only 권한·WebM/Opus 녹음·OpenAI 전사·검토 후 적용 | 녹음·수명주기·검토 UI 재사용. 전사 engine과 OpenAI 키 요구를 분리 |
| src/main/speech.ts, renderer/src/speech-player.ts, SpeechOutput.tsx | OpenAI speech → 검증된 MP3 → 메모리 Blob 수동 재생·중지/폐기 | 서비스·키 의존 분리. player는 현재 MP3 전용이어서 Windows PCM/WAV를 그대로 넣을 수 없음 |
| InterviewAudio.tsx, InterviewWorkspace.tsx | 수동 듣기/녹음/텍스트 전환, 답변·전송 동의, 기록 | 자동 진행 아님. 오디오 상호 배제·이탈 정리·입력 보존을 유지 |
| src/main/index.ts, policy.ts, src/preload/index.ts | 정확한 창/프레임/URL, 좁은 IPC, sandbox·CSP·기본 장치 거절 | 카메라·모델/WASM/이미지 자산 허용 경로는 새 검토 대상 |
| src/main/local-settings.ts, renderer/src/AIOptions.tsx | OS 보호 키, 원자적 설정 저장, 한국어 modal·테마 | Gemini 중심 신규 설정을 추가하되 이전 키·세션을 삭제하지 않음 |
| tests/unit/, tests/smoke/, .github/workflows/{ci,windows-build,pr-policy}.yml | 단위/정책 검사, 합성 API·오디오와 실제 Windows Electron source/packaged smoke | 기존 회귀 유지. 실제 음질·전사 정확도·사용자 장치 검증을 대신하지 않음 |

미구현: 두 면접관 역할·speakerId·공유 대화, 로컬 TTS/STT, 모델 관리, 아바타/립싱크, 웹캠·얼굴 관찰, VAD/끼어들기, Gemini 결과 리포트·비교/export. 기존 로컬 연습은 비모델 질문이며 AI 평가가 아니다.

### 이번 기준 검사

- 위 main을 별도 작업 브랜치에서 검사했다. Node 24.19.0 / npm 11.9.0. 동일 package.json/lockfile의 기존 설치 의존성을 재사용했고 새 패키지는 설치하지 않았다.
- 최초 npm run check: 타입·lint 성공, 단위 501/502 성공. connected-controller.test.ts의 실제 CLI 하위 프로세스 spawnSync EPERM으로 1개 실패하여 정책 단계는 실행되지 않았다.
- 실행 도구의 추가 권한으로 같은 npm run check 재실행: 종료 0, **24개 파일·단위 502개, 정책 41개, 타입·lint 모두 성공**. 소스·테스트·시간 상한·Electron sandbox를 바꾸지 않았다. 첫 실패를 제품 결함으로 단정하거나 기록에서 지우지 않는다.
- 이번은 문서 작업이다. 앱 build/Windows 패키징/장치 smoke를 별도로 수동 재실행하지 않았다. 문서 PR의 저장소 트리거 CI는 별도 실행 링크로 확인한다.
- 앱 UI 기준 [latest.md](../testing/latest.md)의 220/40은 PR #34 당시 기록이다. 현재 전체 502/41에는 개발 자동화 테스트가 포함되므로 새 제품 기능 282개가 생겼다는 뜻이 아니다. 현재 실행 수치로 과거 앱 기록을 덮어쓰지 않는다.

### 자동화의 현재 관측

2026-10-22 KST 연결 GitHub API 조회 기준이다. 다음 문구는 운영 규칙 변경이나 성공 상태를 만들어내는 입력이 아니다.

- PR #39는 검증 전용으로 **머지 없이 닫힘**, PR #52도 **머지 없이 닫힘**이며 needs-user는 남아 있다. 새 제품 작업을 위해 과거 PR을 재개하거나 머지할 필요는 없다.
- v1 automation/event-ledger ref=54e6f79d156ac8c99b337c6cc7a116cba6066119를 보존한다. task39의 ambiguous_delivery와 과거 lease/요청 이력은 그대로이며 재발신·완료 처리하지 않았다.
- v2 automation/approved-loop ref=80a451fbe5a1d51f1f3cf70b66884192a833d78c의 revision 163에서 A(#58)=completed/cycles3, B(#59)=completed/cycles1, lease=null이다. main의 승인 큐는 기존 A/B 두 개뿐이다.
- 최근 [Event worker 39610563655](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39610563655)와 [조정자 39610564033](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39610564033)는 success다. job 성공 자체를 전체 무인 개발 성공으로 해석하지 않는다.
- [#35의 최종 검증 기록](https://github.com/silverThunder09/ai-interview-studio/issues/35#issuecomment-6317316296)은 A 자동 머지/main CI→B 실제 자동 개발·patch·CI와 B의 사용자 요청에 따른 직접 AI 검토·머지를 구분한다. **B 공식 native 리뷰 완료→무인 머지 경로는 미검증**이므로 #35는 open이다.
- approved-loop.yml의 조정자는 contents/pull-requests/issues 쓰기, checks 읽기, 제한된 검증 dispatch용 actions 쓰기를 가진다. PR 테스트 job과 역할이 다르다. main만 실행·체크아웃 credential 미보존·기존 리뷰/증거 검증을 유지한다. 새 Phase 작업은 큐에 추가하지 않았다.
- API rulesets 목록은 빈 배열이었다. main branch protection 조회는 **403 Resource not accessible by integration**으로 차단돼 설정 전체를 확인하지 못했다. 보호가 없거나 안전하다고 단정하지 않는다. 실제 머지의 권한·보호 규칙은 우회하지 않는다.
- event-loop/context-session 등 일부 문서는 이전 오프라인/미해결 상태 설명이 남아 있다. 자동화 지침·권한 변경은 이번 제품 설계 PR에 섞지 않고 위 API 관측과 #35를 현재 상태로 구분한다.

## 목표 구조와 변경 후보

기존 Electron main/preload/renderer/shared와 SQLite를 유지한다. 별도 배포 backend·localhost 추론 서버·새 유료 음성 API를 만들지 않는다. 다음 경로는 **구현 시 후보**이며 이번에 생성하지 않는다. 인터페이스는 필요한 Phase에서 실제 호출부와 함께 도입한다.

| 유지·수정할 기존 파일 | 신규 후보와 책임 | 도입 단계 |
| --- | --- | --- |
| ai-question-provider.ts, external-ai.ts, shared/ai.ts | main/gemini-interview-provider.ts, shared/interviewer.ts: 두 역할·speaker·공유 문맥 계약 | 1 |
| interview-service.ts, interview-store.ts, shared/interview.ts, local-settings.ts | main/ai-usage.ts: 요청 id·숫자 사용량·가격 버전; schema migration/프로필 snapshot | 1 |
| speech.ts, shared/speech.ts, speech-player.ts, SpeechOutput.tsx | main/local-speech.ts: SpeechSynthesisProvider·Windows helper | 2 |
| InterviewWorkspace.tsx, styles.css | renderer/src/InterviewerAvatar.tsx: AvatarRenderer, 두 면접관·실패 격리 | 3 |
| voice.ts, shared/voice.ts, voice-recorder.ts, VoiceInput.tsx | main/local-transcription.ts: SpeechRecognitionProvider, main/model-catalog.ts: 검증된 모델 | 4 |
| index.ts, policy.ts, preload/index.ts, shared/contracts.ts | renderer/src/camera-service.ts: CameraService; face-analysis.worker.ts: FaceLandmarkAnalyzer | 5 |
| interview-service.ts, InterviewAudio.tsx | main/interview-orchestrator.ts, shared/interview-state.ts: 상태 전이·turn epoch·자원 소유 | 6 |
| interview-store.ts, InterviewHistory.tsx | main/interview-report-service.ts, shared/interview-report.ts, renderer 결과 화면 | 7 |

Phase 1부터 기존 adapter를 일괄 삭제하지 않는다. 신규 Gemini 모드를 기본 제품 방향으로 만들되 기존 OpenAI/Claude·로컬 연습 세션 읽기/이어하기·키 삭제와 실패 처리를 유지한다. 구기능 제거는 신규 경로의 회귀·migration을 확인한 별도 변경이다. React에서 SQL·외부 API·native 실행을 직접 하지 않는다.

## Gemini 두 역할과 비용 최소화

- A: Java/Spring/DB/네트워크/시스템 설계의 기술 근거·선택 이유를 묻는 엄격하고 논리적인 면접관. B: 프로젝트 역할·성과·협업·문제 해결의 구체성을 묻는 친절한 면접관. 별도 키·두 개의 병렬 AI 세션을 만들지 않는다.
- 성격 프리셋은 엄격한 기술 면접관·친절한 실무 면접관·차분한 시니어·압박 질문 중심·사용자 지정으로 구분한다. A/B가 각각 선택하며 얼굴·남성형/여성형/중성형 스타일·의상/배경·음성/속도와 논리 역할은 독립적이다. 사용자 지정 지침은 길이/허용 필드를 검증한 비신뢰 설정이며 기술 정확성·근거·공통 rubric을 덮어쓸 수 없다.
- main의 단일 요청 큐가 다음 발언자를 결정하고 같은 키/모델을 사용한다. 응답은 speakerId(A/B), text, 허용 evidenceId를 검증한다. 유효하지 않은 speaker·근거·과대 출력은 턴을 진행하지 않는다. 성격·난이도는 질문 표현을 바꾸며 평가 rubric을 바꾸지 않는다.
- 공통 문맥은 앱 안에서 한 번 관리한다. 선택한 이력서 근거·직전 답변·최근 질문 식별자를 한 번의 bounded payload로 구성해 A/B 중복 질문을 줄인다. 초기에는 결정적인 문맥 축약을 사용하며 요약을 위한 숨은 Gemini 호출을 만들지 않는다. 요약/파생 근거를 원문 인용으로 표시하지 않는다.
- 앱에 문맥을 저장한 것만으로 Gemini가 이전 요청을 무료로 기억하지 않는다. generateContent에서 필요한 문맥은 다시 전송·과금될 수 있다. 안정된 공통 prefix와 모델의 implicit cache를 활용할 수 있으나 적중·절약을 보장하지 않는다. explicit cache는 원격 보존·최소 토큰·저장비/TTL·삭제 계약이 추가되므로 초기에는 만들지 않는다.
- 현재 12문항·실행당 36요청·질문 1,500자·출력 최대 600토큰·30초 상한을 기본 출발점으로 유지한다. 공유 문맥 확장은 Phase 1에서 승인할 제안: 선택 근거 합계 2,000자, 최근 질문 제목 합계 1,500자, 직전 답변 2,000자, 전체 요청의 모델별 입력 예산. 초과 시 선택/문맥 축소를 안내하고 몰래 원문 전체를 보내지 않는다.
- 요청당 usageMetadata의 입력·출력·캐시·thinking·전체 토큰을 제공된 필드별로 보존한다. 누락은 0이 아니라 unknown이다. 텍스트·키·개인 자료를 계측 로그에 남기지 않는다. model·요청 id·목적·시각·숫자 사용량·상태·가격표 출처/유효일만 저장한다. 실패/취소도 시도 수에 포함하며 같은 응답의 재처리로 합산하지 않는다.
- 예상 비용은 실제 모델·Standard 요금·캐시 할인·thinking 포함 규칙에 맞춰 계산한다. 일반식은 (비캐시 입력×입력단가 + 캐시 입력×캐시단가 + 과금 출력×출력단가)/1,000,000이다. 이미 출력에 포함된 thinking을 다시 더하지 않는다. 응답 필드 의미가 불명확하거나 가격 유효일이 지났으면 추정 불가로 표시한다. 청구액·세금·환율·확정 예산 보장으로 표현하지 않는다.
- 2026-10-22 KST 공식 가격표의 예: gemini-3.8-flash Standard는 2026-12-31까지 입력 $0.75/출력(thinking 포함) $3.75 per 1M tokens, gemini-3.5-flash-lite Standard는 $0.30/$2.50이다. 캐시 없는 입력 2,000/과금 출력 600토큰이면 전자는 $0.00375, 후자는 $0.00210의 산술 예시다. 이는 실제 청구·품질 비교·모델 자동 교체 근거가 아니다. 모델/가격은 구현 시 재확인한다.
- 기존 코드 예시와 사용자의 모델 선택은 gemini-3.8-flash다. Phase 1의 호환 우선 후보로 유지하고 Flash-Lite는 합성 형식 검사 뒤 별도 승인된 품질 평가 대상으로만 제안한다. 이 세션에서 계정/Tier 1·실제 키/모델 접근·요금을 조회하거나 유료 요청하지 않았다. 키 등록도 인증 호출로 바꾸지 않는다.

출처: [모델 API ID](https://ai.google.dev/gemini-api/docs/models), [generateContent/usageMetadata](https://ai.google.dev/api/generate-content), [공식 가격](https://ai.google.dev/gemini-api/docs/pricing), [generateContent 캐시](https://ai.google.dev/gemini-api/docs/generate-content/caching). 지원 모델·가격표는 영구 고정값이 아니다.

## 로컬 기술 비교와 선정 조건

외부 기술의 공식 문서·게시자 model card·패키지 메타데이터를 조사했다. 코드·모델·binary를 복제/설치/실행하지 않았다. 아래는 설계 후보이며 **특정 배포 파일의 라이선스·Windows 동작을 모두 승인했다는 뜻이 아니다**.

| 영역·후보 | 확인한 근거·장점 | 한계와 선정안 |
| --- | --- | --- |
| Windows SpeechSynthesizer | Microsoft 문서상 설치된 Microsoft 서명 음성을 열거·선택; 추가 API 키 없음 | Phase 2 첫 검증 후보. 한국어 음성 설치 여부·서로 다른 두 voice·offline PCM 출력·Electron helper/portable을 실측해야 함. 미설치 시 자동 다운로드/클라우드 전환 없음 |
| Piper | PyPI piper-tts의 현재 라이선스 GPL-3.0-or-later | 로컬 실행 후보이나 기존 UNLICENSED 앱과 배포 의무·전이 의존성·한국어 모델별 허가가 미확인. 단순 subprocess 분리로 의무가 사라진다고 가정하지 않음. 초기 기본 엔진 확정 제외 |
| MeloTTS | 게시자 MeloTTS-Korean card는 Korean/MIT 표기 | 한국어 대안 후보. Python/PyTorch 등 runtime 크기·CPU·전체 의존성·모델 파일 라이선스·Windows portable 검증 전 도입하지 않음 |
| Whisper.cpp | ggml 모델 배포 card의 MIT 표기, tiny/base/small 다국어 후보 | Phase 4의 엔진 방향. 배포 card별 라이선스가 다를 수 있으며 OpenAI whisper-base card는 Apache-2.0 표기다. 엔진 이름만으로 전체 모델 MIT로 단정하지 않고 고정 binary/원본 모델/변환본 각각 검증 |
| 자체 2D React/SVG·CSS | 기존 React/CSS 재사용, 직접 제작한 로컬 도형·프리셋 | Phase 3 우선. 외부 이미지 생성 호출 없음. 초깃값은 진폭 기반 입 벌림이며 음소 정밀 립싱크로 과장하지 않음. 3D/VRM·REA 에셋 복제 제외 |
| MediaPipe Face Landmarker Web | 공식 가이드에 landmark·얼굴 변환 행렬, detectForVideo의 동기 처리·worker 권고 | Phase 5 후보. 패키지와 .task/WASM 배포물의 버전·라이선스·모델 카드 확인 필요. 로컬 번들·worker에서 실행하고 감정/표정 점수·신원 추론은 사용하지 않음 |
| VAD | 초기 Web Audio 기반 에너지·침묵 감지는 추가 모델 불필요 | Phase 6의 경량 후보. 에너지는 사람 발화·에코 구별 보장이 아님. 실패하면 수동 종료를 유지; 신경망 VAD는 품질·모델 라이선스 확인 후 별도 도입 |

출처: [Windows 음성 엔진](https://learn.microsoft.com/en-us/uwp/api/windows.media.speechsynthesis.speechsynthesizer), [설치 음성 목록](https://learn.microsoft.com/en-us/uwp/api/windows.media.speechsynthesis.speechsynthesizer.allvoices), [Piper 패키지](https://pypi.org/project/piper-tts/), [MeloTTS 한국어 card](https://huggingface.co/myshell-ai/MeloTTS-Korean), [Whisper ggml card](https://huggingface.co/ggerganov/whisper.cpp/blob/main/README.md), [Whisper 원본 card](https://huggingface.co/openai/whisper-base), [MediaPipe Web 실행](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js). 라이선스는 구체적 파일·버전·전이 의존성을 고정한 뒤 notices에 반영한다.

### 품질·리소스 결정 방법

- STT는 tiny/base/small의 **다국어** 모델로 동일한 합성/사용 허가된 한국어·Java/Spring 용어·숫자 문장을 검사한다. 오탈자율·기술 용어 정확도·첫 결과/전체 처리 시간·RTF·peak RSS·취소 후 프로세스 종료를 비교한다. .en 모델을 한국어 기본으로 쓰지 않는다.
- base는 비교의 출발 후보이며 기본값 확정이 아니다. 저사양 경량 모드는 tiny/분석 빈도 축소/아바타 정지 선택을 제공한다. small은 사용자 기기 메모리·지연 검증 후 선택한다. 모델 크기·RAM·속도 수치를 미측정 상태에서 고정하지 않는다.
- TTS는 한국어·기술 용어 발음, 두 voice 구분, 첫 소리 지연·60초 재생·중지/반복·오프라인·메모리를 검증한다. 설치 voice가 하나면 두 성별/억양을 제공한다고 주장하지 않는다. 미지원 pitch/억양 설정은 비활성 이유를 표시한다.
- Phase 2/4 전에 대상 PC의 CPU·RAM·GPU 유무·설치 한국어 voice를 사용자에게 확인한다. 실제 Windows 음질·정확도·장치 시험은 CI 합성 성공과 별도다. 설치/다운로드가 필요한 경우 크기·출처·라이선스·checksum을 제시한다.

## Phase별 AC와 검증 순서

모든 Phase는 별도 구현 승인·작은 Draft PR·관련 타입/lint/unit·필수 CI·현재 head/base AI COMMENT·원본 reviews/증거·expected-head squash·main 검사 순서를 따른다. 자동화 자체의 정책/권한/큐 수정은 이 제품 스펙에 포함하지 않는다.

| Phase | 사용자에게 보이는 결과·AC | 필요한 테스트·멈추는 조건 |
| --- | --- | --- |
| 0 | 실제 상태·유지/교체·목표 구조·비용·라이선스·보안·단계별 AC 문서안 | 기존 check, 문서 링크/diff·상태/계산 검토. 결과 확인 전 대규모 구현 금지 |
| 1-A | 두 역할·성격/난이도 프로필, main의 다음 speaker 결정·엄격한 응답 계약 | 허용 speaker·문서 명령 분리·중복 질문·취소·늦은 응답·동의 누락 거절. 실제 Gemini 유료 호출 없음 |
| 1-B | Gemini 동일 키의 한 요청 큐, 공유 근거·수치 사용량·기록 복원 | usage 누락 unknown·thinking 중복 계산 방지·시도 예산, schema 1/2 복원·migration rollback·중복 답변·키 비노출. 원본/패키지 합성 흐름 |
| 2 | local TTS 기본 경로, 설치 음성 선택·생성/재생/중지 | 키 없이 offline·WAV/PCM 검증·중복 캐시·다른 speaker voice·출력 한도·helper crash/cancel/종료. OpenAI로 자동 fallback 금지 |
| 3 | 두 로컬 2D 아바타·5개 성격 프리셋·발언 강조·립싱크 | speaker/audio 일치·끝/중지 후 대기·재생 없는 입 움직임 방지·렌더 실패 후 텍스트 진행·경량/모션 감소·테마/키보드 |
| 4 | 장치 선택·녹음·Whisper 로컬 전사·검토/수정·직접 적용 | WebM/Opus→mono PCM 변환·모델 위조/불일치·미설치·과대 출력·busy/late/cancel/종료·저장/전송 없음·한국어 benchmark |
| 5-A | 카메라 별도 시작·장치 선택/전환·미러·중지 | 다른 창/프레임·혼합 권한 거절·권한 대기 중 이탈/늦은 허용·장치 제거·중복 시작·끝의 track.stop, source/packaged synthetic camera |
| 5-B | 선택적 얼굴 존재·크기·위치·head pose 안내 | .task/WASM 손상·worker 실패·분석 빈도/메모리 상한·다중 얼굴/미검출·조명 한계·외부 요청/프레임 저장 없음. 감정/자신감/역량 필드 부재 |
| 6 | 질문 로컬 자동 읽기·VAD 종료 제안·수동 종료/검토·끼어들기·일시정지 | 상태 전이·재생 에코·동시 녹음/재생·중복 제출·모델 crash·이전 epoch 결과 무시·재개 시 새 동의·종료 자원 정리 |
| 7 | 면접관별 기록·근거 있는 피드백/학습 항목·비교·선택적 export | 허구 인용/불충분 근거 평가 불가·별도 전송 동의·AI 의견 표시·리포트 idempotency·DB rollback·export 취소/경로/실패·삭제 |

Phase 1-A/B는 검토 가능한 분할안이다. 계약 정의만 사용하지 않는 프레임워크로 대량 생성하지 않으며 각 PR에 호출부·회귀를 함께 묶는다. 자동 큐를 사용하려면 별도로 승인된 goal/allowed_paths/완료 조건을 등록하고 #35의 미검증 무인 경로와 운영 결과를 구분한다.

## 상태·UI·실패 경로

제안 상태: IDLE → PREPARING → GENERATING → INTERVIEWER_SPEAKING → USER_SPEAKING → TRANSCRIBING → REVIEWING → GENERATING … → COMPLETED. PAUSED/ERROR는 모든 진행 상태에서 진입하며 종료는 취소·트랙/child/worker/player 정리 후 완료한다. 첫 질문에도 GENERATING을 적용한다. phase/operationId/sessionId/questionId/epoch와 단일 자원 소유자를 main에서 검증한다.

침묵 감지는 답변 종료를 **제안**하며 자동 저장/전송·유료 Gemini 요청을 만들지 않는다. 전사 검토·명시 제출을 기본으로 유지한다. 매 턴 자동 제출 모드는 별도 데이터 전송·비용 계약을 승인받기 전 구현하지 않는다. 끼어들기 시 TTS를 즉시 중지하고 이전 epoch의 재생/전사/질문 결과를 폐기한다. 에코 제거를 보증하지 않으며 헤드셋·수동 종료 경로를 유지한다.

- 준비 화면: 문서 검토, Gemini 키 등록 여부/모델(등록과 실제 연결 성공 구분), A/B 성격·스타일·음성, 마이크/카메라 개별 테스트, 모드·난이도·한도. 테스트 버튼이 유료 인증 호출을 몰래 보내지 않음.
- 진행 화면: 면접관 두 명과 현재 발언자, 사용자 웹캠 opt-in, 질문·자막·진행도/시간·상태, 로컬/외부 처리 표시, 일시정지/종료, 텍스트 대체.
- 결과 화면: 질문/답변·면접관·근거와 AI 의견·학습 항목·과거 비교. 얼굴 관찰은 별도이며 기술 점수에 합산하지 않음.
- 한국어·라이트/다크·키보드·초점·상태 알림·모션 감소를 유지한다. voice/3D/style·의상·배경은 엔진/에셋 capability로 구분하며 미구현 선택지를 동작하는 기능처럼 표시하지 않는다.

## 위험·보안·난이도와 착수 결정

세부 통제는 [security 목표 설계](../security.md#로컬-음성화상-면접의-목표-보안-설계--미활성)가 소유한다.

| 위험·병목 | 영향과 대응 | 상대 난이도 |
| --- | --- | --- |
| 두 역할·공유 문맥·DB 호환 | 이전 한 구절/직전 답변보다 전송 범위가 늘어남. 미리보기·본문 한도·동의·migration AC 승인 필요 | 중간 |
| 한국어 TTS·두 voice·portable | Windows 설치 상태마다 다름. helper capability 검증, 모델 엔진 도입은 라이선스·배포 근거 후 결정 | 높음 |
| Whisper WebM 디코딩·native 모델 | 현재 WebM 검증이 PCM 변환은 아님. 제한된 decoder/helper·모델 manifest·취소/child tree·CPU/RAM 검증 | 높음 |
| 카메라·MediaPipe·WASM/CSP | 현재 deny/정적 자산 whitelist와 충돌. 개별 권한과 고정 번들 자산 경로만 추가 검토; renderer 네트워크/sandbox 유지 | 높음 |
| 실시간 상태·스피커 에코 | 끼어들기·장치 제거·늦은 결과·자동 과금 가능성. 단일 턴·epoch·수동 검토·상한·실패 격리 | 가장 높음 |
| 보고서·평문 개인정보 | 현재 DB 암호화 없음. 로그/usage 비민감화·보존/삭제·별도 평가 동의, 암호화 설계는 별도 결정 | 중간~높음 |
| 자동화 | A/B 상태 완료와 완전 무인 증명은 다름. #35를 별도 추적하고 제품 PR의 스펙으로 보호 검사 우회하지 않음 | 별도 운영 과제 |

날짜·성능·정확도·개발 기간을 실측 없이 보장하지 않는다. 다음 착수 제안은 **Phase 1-A/B의 스펙·전송 범위 검토**다. 로컬 음성/카메라 도입과 외부 전송 확대를 포괄 승인으로 묶지 않는다. Phase 0 문서 PR은 검토용 Draft로 제시하고 사용자 결과 확인 전 머지·제품 구현·큐 활성화를 하지 않는다.

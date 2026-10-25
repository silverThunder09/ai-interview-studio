# 아키텍처와 제품 로드맵

## 현재 작업: Phase 1 3D 복구 흐름과 모델별 상태 안내

2026-10-26 KST 현재 채팅의 “왜 대기중이야 다른 작업 돌려야지”, “계속 진행해” 요청에 따라, 완료된 Gemini 역할/발언자 작업 A(#86)·B(#95) 다음에 기존 승인 Phase 1의 남은 복구 흐름을 이어간다. 일시정지 중 모델 교체 화면 갱신 결함은 #102/PR #103에서 먼저 수정·검증한다. 이어서 **3D 오류 후 명시적 화면 재시작 → A/B 저장 모델의 복원 상태·실패·개별 재시도** 두 작업을 기존 큐 끝에 추가한다. 새로운 권한·의존성·외부 전송·비용 없이 현재 로더/IPC/renderer 수명주기를 사용하며 이전 완료 이력과 검사·리뷰 조건을 보존한다. 이 요청으로 후속 로컬 음성·웹캠·리포트·공유 문맥 범위를 활성화하지 않는다. 상세 AC는 제품 스펙 4.1, 실제 상태는 #35와 각 PR/CI에서 확인한다.

2026-10-22 KST 최종 제품 첨부를 정리한 문서 PR #72를 사용자 요청으로 머지했다. 이후 Phase 1 실제 3D 화면·모델 교체·움직임·테스트·PR 진행을 안내하자 사용자가 “일단 진행해 봐. 진행하고 뭐 가져와야 되거나 파일이 필요하면 그때 말해”라고 승인했다. 이후 원격 반영 심사 거절에 대해 사용자가 코드·의존성·테스트·관련 문서의 push→PR→Windows 검증→조건 충족 시 머지를 명시 승인했다. 현재는 **Phase 1의 3D 기반 구현·검증 중**이며 전체 제품 구현 완료가 아니다. Three.js/타입·관련 좁은 IPC·모델 로컬 저장·단위/Electron 검증과 영향 문서를 범위에 포함한다. 후속 범위의 활성 상태는 아래 승인 기록을 따른다. 로컬 TTS/STT·웹캠·리포트·새 CI 권한·공개 배포는 활성화하지 않는다.

목표는 **한국인 스타일의 실사형 3D 면접관 두 명 + 기존 Gemini 텍스트 API + 무료 로컬 TTS/STT + 웹캠 + Gemini 면접 분석 리포트**를 사용하는 독립 실행형 Windows 앱이다. Electron·React·strict TypeScript·Vite·SQLite를 유지하고 별도 배포 backend/DB/추론 서버를 기본 구성에 추가하지 않는다. 외부 AI 비용은 사용자가 선택한 기존 Gemini에 한정하며 개발 중 유료 호출·개인 자료 전송은 별도 승인 없이는 하지 않는다.

요구사항·상태별 화면·참고 자료·AC는 [제품 스펙](specs/gemini-local-interview.md), 데이터/모델/실행·라이선스 경계는 [security](security.md#실사형-3d-제품-전환의-목표-보안-설계--미활성)가 소유한다. 이전 [MVP 1](specs/mvp-01.md)·[MVP 2](specs/mvp-02.md)는 당시 구현·승인·한도 기록으로 보존한다.

### 2026-10-24 KST — Phase 2 첫 두 작업 구현 승인

사용자는 #35의 두 작업 제안에 대해 현재 채팅에서 “승인할게”라고 답했다. 승인 범위는 (A) 기존 Gemini 질문 경로의 기술/경험·협업 역할과 검증된 발언자 ID, (B) 그 ID를 3D 강조·질문/역할 표시에 연결하는 두 작업의 승인 큐 등록·구현·테스트·PR·CI·조건부 머지와 A 뒤 B 자동 시작 검증이다. 두 역할은 기존 키 하나와 단일 요청 경로를 재사용한다. 현재 전송 데이터·12문항/36요청·600 출력토큰·30초 상한을 유지하며 개발/CI는 합성 응답만 사용한다.

이 첫 범위는 Phase 2 전체 완료 승인이 아니다. 공유 문맥 전송 확대·사용량 저장·사용자 지정 personality·로컬 음성·웹캠·리포트·실사 에셋·실제 유료 호출은 후속 승인/검증 대상으로 둔다. 기존 Phase 1 구현·기록과 완료된 자동화 receipt를 보존한다. 실행 도구의 정식 권한 승인은 사용할 수 있으나 Chromium sandbox·TLS·proxy·CI·리뷰·정확한 SHA 조건을 완화하지 않는다.

## 현재 구현과 재사용 — main f908ca4 기준

| 영역 | 현재 실제 구현 | 목표와 차이 |
| --- | --- | --- |
| 기반 | main·sandbox CJS preload·React renderer 분리, Windows portable, 한국어·테마·설정 dialog | 유지, 화면 정보 구조만 단계적으로 확장 |
| 이력서 | native dialog의 PDF/DOCX 한 개 제한 읽기 → sandbox worker 추출·근거·사용자 검토 | 재사용; 원문 전체 자동 전송·OCR 추가 아님 |
| 질문 | OpenAI·Claude·Gemini 고정 REST adapter, 질문/근거 id 검증·30초·취소 | Gemini 두 역할·speakerId·공유 문맥·사용량 미구현 |
| 기록 | node:sqlite schema 2, 12문항·100세션, 순서·중복·rollback·복원·삭제 | profile/speaker/usage/report용 보존형 migration 필요 |
| 음성 | OpenAI 전사·질문 MP3, 명시 동의·검토·수동 적용/제출 | 로컬 TTS/STT·오디오 기반 립싱크·대화 상태 전환 미구현 |
| 모델·장치 | 한시적 audio-only 마이크, 카메라 기본 거절 | 3D/GLB/glTF·실사 에셋·웹캠·MediaPipe 미구현 |
| 자격증명 | 선택한 키의 OS 보호 저장·테마/공급자별 모델 보존 | 면접관 모델/목소리·프로필 보존은 새 버전 계약 필요 |

PR #72에서는 실험 코드를 모두 원복하고 문서만 반영했다. 이후 승인된 Phase 1 작업 브랜치에서는 3D 코드·관련 테스트·Three.js/타입과 번들 라이선스 목록을 추가한다. 기존 이력서·음성·AI·DB·workflow 통제는 유지한다. 과거 앱 테스트 수와 전체 자동화 테스트 수·실제 사용자 장치 검증을 합산하지 않는다.

## 확정한 제품 운영 방향

2026-10-22 KST 사용자 선택: 목표 기기는 **갤럭시북3 360 15인치**, 작은 앱 설치 후 최초 설정에서 용량/출처/라이선스를 안내하고 필요한 모델만 선택 다운로드한다. 세부 SKU·CPU·RAM·GPU·Windows 버전은 미확인이므로 성능/기본 STT 모델을 확정하지 않는다. 경량 품질을 초기 기준으로 실제 동시 실행을 측정한다. Windows 설치 음성을 우선 활용하고 이미 설치/검증한 모델을 재사용한다. 자동 startup 다운로드나 전체 모델 동봉은 기본이 아니다.

**실전 면접 단일 모드**로 설계하고 별도 연습 모드는 제거한다. 전사는 실전 모드 안에서 확인/수정하며 **‘답변 완료’ 버튼**으로 제출한다. 침묵/VAD만으로 Gemini 요청을 시작하지 않는다. 종료 후 기존 Gemini 키로 질문별 근거·강점/보완점·개선 예시를 분석하는 리포트를 핵심 범위에 포함한다. 리포트는 전송 미리보기/별도 동의 후 생성하고 실패해도 원래 기록을 보존한다. 상세 계약은 제품 스펙이 소유하며 현재 구현/전송 동의를 바꾸지 않는다.

## 목표 프로세스 경계

| 경계 | 유지할 책임 | 확장할 책임 |
| --- | --- | --- |
| src/main | 수명주기·정확한 창/프레임/URL IPC·고정 API·SQLite·OS 보호 키 | Gemini 턴 조정/프로필·허용 모델 선택/카탈로그·제한된 로컬 음성 실행·리포트 |
| src/preload | 기능별 window.studio API, 범용 invoke/shell/파일 접근 없음 | 모델·장치·음성·상태·취소의 좁은 계약 |
| src/renderer | 한국어 UI·문서 worker·메모리 녹음/재생·테마/접근성 | Three/R3F의 공유 3D 장면·애니메이션·립싱크·웹캠·로컬 분석 worker |
| src/shared | 순수 타입·한도·입력 검증 | speaker/profile·avatar capability·모델 manifest·상태·사용량/보고서 계약 |

GeminiQuestionProvider·InterviewOrchestrator·InterviewerProfileService·AvatarModelLoader·AvatarAnimationController·LipSyncController·LocalTTSProvider·LocalSTTProvider·CameraService·FaceAnalysisService·InterviewReportService·InterviewStore로 책임을 구분한다. 기존 클래스/호출부가 충분하면 재사용하며 선언만 있는 범용 프레임워크를 미리 만들지 않는다. 무거운 추론·decoder는 UI thread에서 분리한다.

production은 app://studio와 한정 번들 자산만 제공한다. renderer Node·외부 네트워크·탐색·webview 차단, sandbox/context isolation, 정확한 IPC 송신자 검사를 유지한다. 모델/텍스처/WASM을 위해 디렉터리 전체나 임의 URL을 공개하지 않는다.

## 모델과 완료 기준

**기본 모델 형식은 GLB / glTF 2.0이다. VRM은 필수가 아닌 후속 선택 호환이다.** Three.js·React Three Fiber·GLTFLoader·AnimationMixer·morph targets/blend shapes·Web Audio를 우선 검토한다. 구체 버전·peer·라이선스·Windows 호환성은 구현 착수 때 검증한다. Phase 1 기반에는 Three.js 0.186.1(MIT)·@types/three 0.186.0을 고정한다. 기존 React 19와 renderer 수명주기에 맞춰 직접 Three.js를 제어하고 R3F/drei·VRM은 아직 추가하지 않는다. renderer에만 쓰는 Three.js는 devDependency에서 번들하고 원문 라이선스를 수집해 불필요한 npm 런타임 중복을 줄인다.

렌더러/로더가 동작하는 것과 실사형 한국인 스타일의 성인 남성·여성 에셋을 확보한 것은 별도 완료 조건이다. geometry 인물은 개발/모델 부재/오류 대응용이다. 그것만으로 고품질 면접관 완료를 선언하지 않는다. 최종 외형은 허가된 사람 모델 두 개의 실제 로딩·피부/헤어·복장·리깅·표정·입 동작·성능을 검증해야 한다. 모델이 없으면 에셋 미확보를 명시하고 로더/교체 기반까지만 보고한다.

## 목표 데이터 흐름 — 아직 미구현

```mermaid
flowchart LR
  R[이력서 로컬 추출·검토] --> C[동의한 근거·공유 텍스트 문맥]
  C --> O[main 면접 조정자]
  O --> G[기존 Gemini 요청 큐]
  G --> Q[질문·speakerId·근거·사용량 검증]
  Q --> T[로컬 TTS 생성]
  T --> L[실제 오디오·음량 기반 립싱크]
  L --> A[발언자 3D 모델·자막·화면 강조]
  M[마이크] --> S[로컬 Whisper]
  S --> E[전사 확인·답변 완료 버튼]
  E --> O
  O --> D[로컬 SQLite]
  D --> P[미리보기·별도 동의한 Gemini 리포트]
  P --> D
  V[웹캠] --> F[로컬 미리보기·선택적 구도 관찰]
```

A/B는 같은 Gemini 키·공유 면접 기록·단일 요청 큐를 사용한다. 기본 교대, 필요한 꼬리질문은 같은 면접관 연속을 허용한다. speakerId가 모델·목소리·애니메이션·강조·자막을 함께 결정한다. 음성/영상 원본·얼굴 특징은 Gemini로 자동 보내지 않는다. 공유 문맥 확대와 평가 전송은 현재 한 구절/직전 답변 동의에서 자동 승계하지 않는다.

## 스펙 구현 순서 — 단계별 승인·검증

| 단계 | 범위 | 완료 기준 |
| --- | --- | --- |
| Phase 1 | 실제 3D 면접관 두 명·GLB/glTF 로더/사용자 교체·대기/발언 애니메이션·강조/레이아웃 | Electron에서 실제 모델 두 개·발언 상태 전환·실행/교체 검증. 실사 에셋 품질은 별도 gate |
| Phase 2 | Gemini 두 역할·개별 personality·공유 문맥·질문/답변 턴·사용량 | 기존 이력서/기록을 유지하며 A 기술/B 경험 질문·speaker 검증·중복/취소·사용량 기록 |
| Phase 3 | 무료 한국어 로컬 TTS·개별 목소리·실제 음량 립싱크·질문 후 답변 상태 | 새 Gemini 질문을 추가 유료 API 없이 읽고 입과 오디오가 연동; 실패 시 텍스트 지속 |
| Phase 4 | 사용자 웹캠·장치/권한·질문/답변 화면 전환·해제 | 두 모델/웹캠 동시 표시, 거절/장치 제거/종료의 모든 track 정리 |
| Phase 5 | Whisper.cpp 로컬 전사·명시 답변 제출·후속 질문·텍스트 대체·Gemini 분석 리포트 | 실전 음성 면접→답변 완료→종료→동의한 리포트 생성/재조회까지 검증; 실패/취소 시 기록 보존 |
| Phase 6 | MediaPipe 관찰·리포트 비교/시각화·커스터마이징 확장·끼어들기·성능/모델·음성 설치 관리 확장 | 세부 항목을 작은 작업으로 분리·각 권한/에셋/전송/성능·삭제 AC 검증 |

성능/리소스 정리·관련 unit/Electron smoke·Windows source/packaged·실제 화면 기록은 각 Phase에서 수행한다. Phase 6까지 미루지 않는다. 선택 모델의 최초 설치/검증은 이를 사용하는 Phase에서 제공하며 설치 관리 확장만 후속으로 둔다. VAD/발화 종료는 녹음 종료를 제안하고 외부 전송은 답변 완료 버튼으로만 한다. 전이/취소가 명확한 턴 기반 음성 면접을 먼저 완성하고 끼어들기는 후속이다.

## 보존·설정·자동화

기존 이력서·질문/답변·키·기록을 삭제하거나 OpenAI/Claude 세션을 Gemini로 몰래 전환하지 않는다. 신규 기본 흐름은 Gemini+로컬 음성이지만 기존 adapter 제거는 호환성/복원·키 삭제와 별도 검토 후 결정한다. DB는 현재 평문이며 secure_delete/DELETE journal·profile ACL이 전체 암호화를 뜻하지 않는다. schema 1/2·요청 hash·미답변 순서를 보존하고 migration 실패는 rollback한다.

선택한 모델·voice·허용 personality·외형 capability 설정을 로컬에서 버전 관리한다. 지원하지 않는 외형/음성 설정은 비활성 이유를 표시한다. 기록·settings·3D 모델·음성 모델의 경로/수명을 분리하며 모델/장치 설정 복원은 권한·녹음·카메라·외부 전송 동의를 복원하지 않는다.

개발 자동화와 제품 완료는 분리한다. 기존 [#35](https://github.com/silverThunder09/ai-interview-studio/issues/35)·v1 ledger·승인 큐·리뷰 정책·CI 권한·브랜치 보호를 이 설계로 변경하지 않는다. [운영 관측](specs/gemini-local-interview.md#자동화와-검증-기록)을 참고하되 현재 상태는 실제 API로 확인한다. REA는 제품에 통합/번들하지 않고 별도 승인된 공개 UX 조사 도구로만 검토한다.

## Phase 1 기반의 범위와 남은 완료 조건

하나의 WebGL context에서 자체 geometry 캐릭터 두 명·시점 회전/확대·눈/고개/대기·무음 발언 동작 미리보기·발언 표시·경량/DPR/30FPS 상한·숨김/설정 시 정지·자원 해제를 구현한다. 기존 질문의 유형을 A/B 화면 강조에만 연결하고 실제 Gemini personality/speaker 계약이나 TTS 립싱크로 표현하지 않는다. 별도 3D 설정 화면은 API 키/이력서 없이 연다.

초기 가져오기는 **자기 포함 GLB/glTF 2.0**으로 제한한다. 외부 .bin/texture 파일 묶음·원격 URL·압축/미검토 확장은 명시 오류로 거절한다. native dialog에서 고른 파일만 제한 읽기하고 실제 parser 로딩 성공 후 슬롯별 앱 사본을 원자 저장한다. 재시작 복원·기본 모델 전환은 이 사본만 다루며 원본을 삭제하지 않는다. 여러 파일 glTF 묶음 지원은 후속이다.

현재 실사형 한국인 스타일 남성/여성 에셋과 배포 라이선스는 미확보다. geometry·합성 GLB/glTF 테스트를 실사 품질 완료로 표시하지 않는다. 사용자 기기 GPU/FPS·실사 모델 품질·실제 음성 립싱크는 미검증이며, Windows CI와 실행 화면 증거를 확인하기 전 Phase 1 전체 완료를 선언하지 않는다.

# AI Interview Studio

개인용 Windows AI 면접 데스크톱 앱이며 Codex Cloud에서 개발합니다. PDF/DOCX 이력서 검토, 텍스트 연습·로컬 기록, OpenAI·Claude·Gemini 질문 생성, 선택한 음성의 OpenAI 전사와 현재 질문의 음성 읽기를 제공합니다. 실시간 음성 대화·카메라는 아직 제공하지 않습니다.

**문서로 검토 중인 새 목표:** 한국인 스타일의 실사형 3D 면접관 두 명, **GLB/glTF 2.0 기본 로딩·교체**, 기존 Gemini 한 키, 로컬 TTS/STT·웹캠과 Gemini 면접 분석 리포트를 사용하는 독립 실행형 면접 앱입니다. 목표는 실전 단일 모드·답변 완료 버튼 제출이며 모델은 최초 설정에서 안내 후 선택 다운로드합니다. **VRM은 선택 호환**이며 geometry 인물은 개발/오류 대체입니다. [로드맵](harness/architecture.md)·[최종 제품 스펙](harness/specs/gemini-local-interview.md)을 수정하며, 사용자 지시에 따라 **이번 변경은 문서만**입니다. 현재 앱에 이 3D 기능이 구현됐다는 뜻이 아닙니다.

검증 결과는 **[최신 테스트 기록](harness/testing/latest.md)**, 과거 결과와 검색 방법은 **[테스트 색인·아카이브](harness/testing/README.md)**에서 확인합니다. 자동 테스트 성공과 실제 사용자 기기/API 확인은 구분합니다.

## Windows에서 사용

1. [Windows build](https://github.com/silverThunder09/ai-interview-studio/actions/workflows/windows-build.yml)에서 **Run workflow → Branch: main → Run workflow**를 눌러 다운로드 빌드를 실행합니다.
2. 성공한 수동 실행을 열어 하단 **Artifacts → ai-interview-studio-windows-x64**를 내려받아 압축을 풉니다. 파일은 3일 보관되며 GitHub 로그인이 필요할 수 있습니다. 자동 PR/main 검사는 같은 빌드·테스트를 수행하지만 설치 파일을 업로드하지 않습니다.
3. `AI-Interview-Studio-0.1.0-win-x64.exe`를 실행합니다. 별도 Node.js·DB 서버·웹 서버는 필요 없습니다. 준비된 질문으로 연습할 때는 API 키가 필요 없으며 외부 AI/전사는 본인 키·인터넷·전송 동의가 필요합니다.
4. 설정에서 서비스·모델과 API 키를 등록합니다. **이 기기에 키 저장 (OS 암호화)**을 선택하면 다음 실행에서 복원합니다. 화면 테마도 자동 보관됩니다.

현재 빌드는 미서명 portable이며 Windows에서 실행 경고가 나올 수 있습니다. 신뢰하는 저장소의 CI artifact와 동봉 SHA-256을 확인하세요. 공개 release·자동 업데이트는 없습니다. CI 성공과 실제 사용자 Windows 기기 검증은 별도로 기록합니다. portable 추출/경로·권한과 실제 화면 확인은 수동 확인 항목입니다.

기본 화면·문서 검토·준비된 질문 연습은 인터넷 없이 실행됩니다. 동의 후 시작한 면접은 이력서 검토 내용과 질문·답변을 암호화되지 않은 로컬 SQLite 파일에 보관하며 기록 화면에서 삭제할 수 있습니다. 외부 AI/음성 전사는 사용자가 고른 내용만 별도 동의 후 전송하고 서비스 요금·보존 정책이 적용됩니다. 화면 테마·선택 서비스·모델은 로컬 설정 파일에 보관합니다. API 키는 선택 시 OS 암호화로 저장하며, 암호화를 사용할 수 없거나 저장을 해제하면 이번 실행에만 등록합니다. 설정에서 서비스별 키를 삭제할 수 있습니다. 전송 동의는 보관하지 않습니다. 마이크는 명시적 음성 입력 시작 후에만 사용하며 카메라는 차단합니다.

## 외부 AI 연결 설정

- 왼쪽 **설정** 또는 면접 화면의 **API 연결 설정**을 엽니다. 작성 중인 이력서·답변은 설정 창을 열고 닫아도 유지됩니다. 진행 중 녹음·재생은 정리하며 닫은 뒤 직접 다시 시작합니다.
- 서비스와 JSON 응답 모델의 API ID를 입력하고 **서비스·모델 저장**을 누릅니다. 서비스마다 모델 ID를 따로 보관합니다.
- API 키를 입력하고 **이 기기에 키 저장 (OS 암호화)** 여부를 선택한 뒤 등록합니다. 입력란은 즉시 비우며 키를 다시 표시하지 않습니다. 등록 자체는 실제 인증·과금 요청을 하지 않습니다.
- Windows에서는 현재 OS 계정의 DPAPI로 키를 보호합니다. 같은 계정의 악성 프로그램·OS 백업까지 보호/삭제한다고 보장하지 않습니다. **선택 서비스 키 삭제**는 로컬 저장본과 실행 중 키를 함께 지웁니다.
- 테마와 연결 설정은 사용자 profile의 `settings.json`에 저장합니다. 이력서·답변·전송 동의는 이 파일에 넣지 않습니다. 손상/지원하지 않는 설정은 자동 덮어쓰기하지 않고 오류를 표시합니다.

## 질문을 듣고 음성으로 답변하기

1. 이력서 검토·로컬 저장 동의 후 연습을 시작하거나 저장된 기록을 이어갑니다.
2. **설정**에서 OpenAI 키를 등록한 뒤 **1. 질문 듣기**에서 지원 모델·음성을 선택하고 질문 전송에 동의한 뒤 음성을 만들고 직접 재생합니다.
3. **답변 녹음 단계로 이동** 또는 **2. 답변 녹음·전사**를 선택합니다. 마이크 동의 후 녹음을 시작/중지하고, 별도 전송 동의 후 전사합니다.
4. 전사를 검토·수정하고 **답변 입력에 적용**합니다. 기존 답변이 있으면 교체 확인이 필요합니다. 검토 입력란으로 이동해도 아직 저장되지 않습니다.
5. 답변을 확인하고 제출 버튼을 직접 누릅니다. 외부 AI 질문을 사용하는 세션은 다음 요청의 전송 범위도 별도로 확인합니다.

**3. 답변 검토·제출**로 언제든 텍스트 입력에 돌아갈 수 있습니다. 단계 이동은 재생/녹음/요청을 정리하고 음성·미적용 전사를 폐기하며 입력한 답변은 유지합니다. 다음 질문에서는 새로 단계를 선택합니다. 단계 선택만으로 녹음·전송·저장을 시작하지 않습니다.

## 클라우드 개발과 검증

사용자의 Windows PC는 내려받은 앱 실행/확인용입니다. 아래 명령은 **Codex Cloud 또는 CI**에서 사용합니다. Node.js 24.19.x와 npm, Linux에서 Electron 실행에 필요한 시스템 라이브러리·디스플레이·작동하는 OS sandbox가 필요합니다.

```sh
npm ci
npm run check
npm run build
npm run test:smoke
```

Linux 디스플레이가 없는 환경은 `xvfb-run -a npm run test:smoke`를 사용합니다. sandbox를 끄지 않습니다. Windows runner에서는 `npm run package:win`으로 portable exe를 생성합니다. `release/`에 출력하며 publish하지 않습니다. smoke는 기본적으로 빌드된 main을, `SMOKE_EXECUTABLE` 환경변수가 있으면 지정된 패키지 실행 파일을 검증합니다.

개발 UI: `npm run dev` (cloud GUI가 있는 경우). Vite의 `127.0.0.1:5173`은 개발 전용이고 production은 `app://studio` 내부 리소스로 실행합니다. `npm run preview`는 빌드한 앱을 실행합니다.

| 명령 | 역할 |
| --- | --- |
| `npm run check` | strict typecheck + lint + unit tests + 리뷰 정책 부정 테스트 |
| `npm run build` | main/preload/renderer 번들 |
| `npm run test:smoke` | 실제 Electron UI·보안·IPC smoke |
| `npm run licenses` | 실제 production npm dependency 라이선스 수집 |
| `npm run package:win` | build + notices + unsigned Windows x64 portable |

## 구조와 개발 규칙

진입점은 공통 규칙만 담은 [AGENTS.md](AGENTS.md)입니다. main·preload·renderer·shared·tests·CI·harness의 하위 `AGENTS.md`는 해당 작업 영역에서만 읽습니다. [workflow](harness/workflow.md)는 작업/검증/PR 절차, [architecture](harness/architecture.md)는 경계와 MVP 0–4 로드맵, [security](harness/security.md)는 개인정보·Electron·REA·라이선스 검토를 소유합니다. 기능 범위는 [MVP 1](harness/specs/mvp-01.md)·[MVP 2](harness/specs/mvp-02.md)를, 실제 성공/미검증 기록은 [테스트 색인](harness/testing/README.md)을 참조합니다.

`src/main`은 권한·수명주기·SQLite·외부 AI/전사 adapter, `src/preload`는 좁은 IPC, `src/renderer`는 React UI, `src/shared`는 검증 계약입니다. REA는 문서만 검토했으며 설치/활성화되지 않은 개발 도구입니다.

개발 작업의 재개·컨텍스트 압축·승인 보존과 세션 인수인계는 [컨텍스트·세션 관리](harness/context-session.md)를 따릅니다. root AGENTS에는 안내만 두고 상세 규칙과 인수인계 양식은 해당 문서에서 관리합니다.

Validation workflow는 PR/push에 check와 build를 실행합니다. Windows build workflow는 Windows에서 같은 검증과 실제 Electron smoke를 실행하고, 패키징한 unpacked exe를 다시 검사합니다. 저장공간을 줄이기 위해 portable exe·체크섬·notices 업로드는 수동 실행에만 수행하고 3일 보존합니다. 실패 시 smoke 진단은 1일 보존합니다. 기존 artifact의 보관 기간은 자동 변경하거나 삭제하지 않습니다. 실제 마이크·webcam·Windows 사용자 기기 테스트를 대신하지 않습니다.

코드/PR 리뷰에는 저장소의 `.agents/skills/code-review`와 `.agents/skills/pr-review`를 사용합니다. 새 PR은 PR 템플릿을, 버그·리뷰 finding은 Issue Forms를 따릅니다. PR policy 검사는 본문과 머지 판정의 실패 경로를 확인합니다. 매시간 PR 점검 예약은 사용자 요청으로 일시정지했습니다. [이벤트 기반 개발 루프](harness/event-loop.md)는 GitHub 이벤트 수신·영속 outbox·기존 Codex Cloud 요청을 구현합니다. 별도 모델 API 키나 시간 예약을 쓰지 않으며, 실제 Cloud 종료·수정·머지의 성공은 Actions와 PR/이슈의 검증 결과로 확인합니다. 연결 미확인·중복 가능성·한도는 보류합니다. 활성 대화의 승인 작업도 현재 head/base의 리뷰·필수 CI·기존 머지 정책을 따라야 합니다. 보호 영역·범위 확대·실패/불명확한 증거는 보류합니다. [운영 정책](harness/review-automation.md)에 실행 의존성과 중지 조건을 기록했습니다.

앱 소스는 비공개 `UNLICENSED`입니다. 사용한 오픈소스 의존성의 원문 notices는 패키지에 포함하고 Electron/Chromium notices를 보존합니다. 실제 이력서·녹음·자격증명을 Git에 추가하지 마세요.

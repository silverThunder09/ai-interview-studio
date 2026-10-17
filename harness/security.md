# 보안·개인정보·라이선스

## MVP 0 위협 모델과 현재 통제

데이터 흐름: 패키지 내부 자산 → sandbox renderer → 좁은 preload → 검증된 IPC → main 메모리 설정 → 타입화된 응답. 이 절은 초기 기반의 통제이며 현재 외부 API 전송은 아래 별도 경계를 따른다. 녹화는 없다. 로컬 문서·명시적 동의 후 기록 흐름은 아래 항목을 따른다. 사용자 컨텐츠와 외부 응답은 향후 모두 비신뢰 입력으로 취급한다.

| 경계/위험 | 현재 통제 | 검증 |
| --- | --- | --- |
| renderer 코드가 OS 접근 | isolation/sandbox 켬, Node/webview 끔 | Node 부재와 Windows OS sandbox metric을 실제 smoke에서 확인 |
| 변조·다른 창·하위 프레임 IPC | 송신 webContents와 mainFrame, URL 확인; payload 키·값·개수 검사 | 부정 단위 테스트와 다른 창의 실제 IPC 거절 |
| 임의 로컬 파일·외부 자산 | custom app protocol의 고정 entry/asset whitelist | traversal·오염 URL 거절 테스트 |
| 팝업·탐색·다운로드·장치 | 기본 deny; 승인된 음성 입력의 한시적 audio-only 허용은 아래 경계 참조; 외부 shell 링크 미제공 | smoke·부정 테스트 및 코드 검토 |
| renderer 외부 전송 | production CSP connect/frame/default none; media는 메모리 blob만 허용; 자체 script/style만 허용 | CSP 응답과 실제 fetch/외부 오디오 차단 smoke |
| 민감정보 유입 | 선택한 문서만 메모리 검토; 녹음 없음; 키 입력은 아래 외부 API 경계; 테스트는 합성 값; gitignore | diff 및 패키지 내용 검토 |

개발 CSP의 inline script/style와 loopback websocket 허용은 Vite HMR 전용이다. packaged 실행은 환경변수에 개발 URL이 있더라도 무시한다. Windows portable을 포함해 production 실행에는 HTTP 서버가 없다. CSP는 custom protocol 응답과 session 응답 헤더로 적용하며 `bypassCSP`를 사용하지 않는다. `session.fetch`는 webRequest 헤더 변경을 반영하지 않을 수 있으므로 protocol 응답에도 명시한다. 앱이 시작 시 보안 초기화나 화면 로드에 실패하면 한국어 오류와 실패 종료를 제공한다.

Electron/Chromium 자체가 OS 캐시·로그·runtime profile을 생성할 수 있다. 제품 설정은 메모리로만 유지하며, 제품 개인정보 저장이 구현됐다는 의미는 아니다. 서명·자동 업데이트는 초기 범위에 없고 Windows에서 미서명 실행 경고가 발생할 수 있다. 배포 범위 확대 전에 코드 서명·업데이트 무결성·Electron fuses 강화와 runtime 보안 업데이트를 검토한다.

API 키의 디스크 보존은 이번 범위에 없다. 향후 보존할 때 OS 보호 저장을 우선 검토하며 평문 fallback은 두지 않는다. 저장된 키를 renderer에 반환하거나 Git·CI artifact·로그에 노출하지 않는다. 이력서/음성/transcript의 전송 데이터·provider·인터넷 의존성·사용량 비용을 사전에 표시하고 사용자 동작으로 전송한다. remote AI는 offline 기능으로 표현하지 않는다. 마이크/카메라는 명시적 시작/중지·거절·종료 해제·보존/삭제 테스트 없이는 활성화하지 않는다. 얼굴로 정직성·성격·감정·채용 적합성을 추론하지 않는다.

## 로컬 이력서 검토의 데이터 흐름

사용자가 native dialog에서 고른 파일 한 개 → main의 10MiB+1 바이트 제한 읽기와 서명 확인 → sandbox renderer → 전용 worker(PDF.js 하위 worker 또는 fflate/xmldom) → 근거 위치가 붙은 추출 원문과 사용자 수정본. renderer는 임의 경로를 보내지 못하고 main은 송신 창·프레임·URL·인수 개수를 기존과 같이 검증한다. 오류는 경로·원문·parser 예외를 숨긴 정형 메시지만 반환한다.

PDF는 텍스트 추출만 수행하며 문서 JavaScript/링크/첨부를 실행하지 않는다. CMaps는 코드에 포함된 정적 데이터만 허용한다. DOCX는 ZIP 디렉터리/서명/중복·경로·크기·암호화 플래그와 필요한 XML의 실제 팽창/CRC를 검증하고, DTD를 거절하며 namespace를 확인한 본문 텍스트만 읽는다. 어떠한 ZIP 항목도 디스크에 쓰지 않는다. `worker-src self`로 패키지 worker만 실행하고 `connect-src none` 및 기존 Node·장치·탐색 차단은 유지한다.

파일·페이지·텍스트·압축 팽창·항목·XML 중첩 한도를 적용한다. 15초 타임아웃·취소·화면 이탈 시 전용 worker를 종료하고 Chromium이 하위 worker도 종료한다. 이 경계는 비신뢰 파서를 main 권한에서 분리하지만 별도 OS 메모리 quota를 제공하지 않는다. 문서를 입력한 프로세스 메모리의 즉시 안전 삭제를 보장한다고 표현하지 않는다.

검토만 하는 동안 제품은 파일 내용·추출 결과·수정본을 저장/로깅/외부 전송하지 않는다. 연습 시작 후 동의한 보존은 아래 기록 정책을 따른다. 화면 비우기·이탈·앱 종료 시 참조를 해제하며 원본 파일은 보존한다. Chromium의 crash/OS 진단 메커니즘까지 완전한 무기록을 보장하지 않는다. 테스트/스크린샷/artifact에는 합성 문서만 쓴다. 검토 화면 자체는 외부 전송하지 않는다. API 키의 디스크 저장은 제공하지 않으며 외부 API 단계는 아래 명시적 동의 경계를 따른다.

## 로컬 텍스트 연습·기록

사용자가 검토 완료한 내용/추출 원문 → 평문 로컬 저장 안내/체크 동의 → 검증된 기능별 IPC → main의 로컬 질문 공급자/SQLite transaction → 질문과 답변 → 기록 조회/이어하기/삭제. renderer에 SQL·파일 경로·범용 쿼리를 노출하지 않는다. 기존 송신 창·프레임·정확한 URL 검사에 이어 인수 수·허용 키·UUID·본문/배열 길이·동의/삭제 확인을 검증한다. 질문·완료 상태는 main에서 생성하며 클라이언트가 임의 지정하지 못한다.

DB는 Electron 내장 `node:sqlite`로 사용자 profile의 `interviews.sqlite`에 지연 생성한다. 0700 디렉터리/0600 파일(지원 OS), foreign key cascade, STRICT schema, 매개변수 SQL, 원자적 transaction, secure_delete/DELETE journal을 사용한다. Windows 접근 통제는 사용자 profile ACL을 따른다. 로컬 파일은 암호화하지 않으며 공유 PC/백업 접근 위험과 저장 위치를 사용자가 볼 수 있다. 세션 삭제는 연계된 근거·수정본·질문·답변을 함께 제거하며 원본 문서·OS 백업까지 삭제한다고 주장하지 않는다.

빈 값/NUL·10만 자 이력서·1만 자 답변·100개 세션·12개 turn 한도를 적용한다. 동일 시작 요청/답변은 중복 생성하지 않고 서로 다른 내용의 충돌 재시도는 거절한다. 실패는 transaction을 rollback하고 입력/기존 기록을 보존하며 원인 예외/원문/SQL/경로를 로그나 일반 오류에 노출하지 않는다. 저장 레코드도 renderer에 반환하기 전에 원문/질문/답변의 JSON 형태·ID·순서·미답변 상태를 검증한다. 손상/미래 schema DB를 자동 삭제/재생성하지 않는다. 실제 기록으로 진단하거나 fixture를 만들지 않는다.

기본 로컬 연습은 실제 AI에 연결하지 않는다. 원문/수정본/답변 인용과 일반 기술 질문을 명확히 구분하고 문서 지시문은 실행하지 않는다. 준비된 후속 질문은 사용자 답변 인용일 뿐 AI 추론·사실 검증·독립 평가가 아니다. 네트워크 CSP·장치·sandbox 통제는 유지한다. Windows smoke는 제품 API를 사용하되 별도 임시 userData에서 합성 문서/기록만 저장/삭제한다.

## AI 공급자 공통 계약과 외부 API 경계

초기에는 main 전용 공통 계약만 모의 검증했다. 사용자 요청으로 OpenAI·Claude·Gemini REST adapter와 명시적 동의 UI를 연결하며 개발 검증은 계속 합성 응답만 사용한다. 선택된 짧은 근거와 직전 답변만 허용하고 원문 전체/파일 경로/임의 필드는 거절한다. 생성 응답은 질문과 근거 id만 받으며, id는 main이 유지한 입력 snapshot의 구절/위치/출처와 결합한다. transport가 자기 payload를 변경해도 snapshot을 바꿀 수 없다. 문서 명령을 system 규칙으로 사용하지 않으며 이력서 없는 경험 금지·질문 전용 지시를 데이터와 분리한다. 이 통제는 AI의 의미적 환각 방지를 보증하지 않는다.

한 요청에 한 번만 transport를 호출하고 자동 재시도/로컬 질문으로의 조용한 대체를 하지 않는다. 취소/시간 초과는 transport에 abort를 보내고 늦은 응답을 반영하지 않으며 timer/listener를 해제한다. 실제 서비스가 취소를 처리하기 전에 수행한 연산/요금을 되돌린다고 보장하지 않는다. adapter가 던진 예외나 서비스 원문 오류는 정형 오류로 바꿔 API 키/URL/이력서가 반환되지 않게 한다. 연결 전 별도 AC에 전송 미리보기·동의·자격증명·비용/보존 안내·SQLite와 비동기 작업의 분리·취소 후 상태 보존을 포함한다.

### 현재 외부 API 데이터 흐름

사용자 비밀번호 입력 → 같은 창/메인 프레임/URL 검사 + 키 형식/인수 개수 검사 → main 메모리 키 보관. 입력 직후 DOM을 비우며 React state·브라우저 storage·SQLite에는 키를 넣지 않는다. 상태 API는 등록 여부와 남은 요청 수만 반환한다. 설정 변경/키 비우기는 진행 중 생성을 취소하고, 창 닫기/종료 시 모든 키 참조를 해제한다. JS/OS 메모리의 즉시 안전 삭제는 보장하지 않는다. 키 등록은 인증 확인이나 외부 호출을 하지 않는다.

검토본에서 사용자가 직접 복사한 180자 이하 구절 → main이 실제 검토본 substring과 동의 확인 → 서비스·모델/수신 endpoint·데이터·과금·서비스 보존 고지 → 사용자 시작 → main 고정 HTTPS 요청. 첫 요청은 선택 구절 1개, 원문과 다를 수 있는 수정본 출처/위치, 질문 번호와 비신뢰 데이터/질문 생성 지시만 전송한다. 후속 질문은 명시적으로 확인한 직전 답변 최대 2,000자와 그 처음 180자의 인용만 전송한다. 일반 기술 질문에는 이력서·답변·과거 대화를 보내지 않는다. 마지막 12번 답변은 로컬 저장만 한다. 각각의 전송 미리보기와 동의는 내용 변경 시 해제한다. 전체 원문/파일 경로·세션 ID를 provider payload에 넣지 않는다.

호출은 OpenAI `api.openai.com/v1/chat/completions`, Anthropic `api.anthropic.com/v1/messages`, Google `generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`만 허용한다. 모델은 100자 이하 영문자·숫자·점·밑줄·하이픈 ID만 받으며 URL/경로를 받지 않는다. 키는 인증 header만 사용하고 query·body에 넣지 않는다. redirect error, cookie 생략, cache no-store, 도구/웹검색/stream 비활성, 출력 토큰 한도, JSON 구조화 출력과 응답 64KiB 제한을 적용한다. OpenAI store=false는 서비스 자체 보존/이용 정책 부재를 뜻하지 않는다. 부분 출력·거절·tool call·허구 근거·비JSON/과대 응답은 반영하지 않고 원문 오류는 반환하지 않는다.

키나 모델을 자동 선택/검증하지 않으며 사용 가능한 JSON 출력 모델의 ID를 직접 입력한다. 타임아웃·취소·실패도 발생 비용을 되돌리지 못한다. 매 수동 제출은 최대 1회 요청, 실행당 36회 공통 상한이며 키를 비우거나 재등록해도 초기화하지 않는다. 앱 재시작 시 한도는 초기화되므로 화폐 예산 보장으로 표현하지 않는다. 사용자에게 서비스 콘솔의 요금·예산·보존 정책 확인을 안내한다. 테스트 transport는 외부 호출을 대체하며 실제 키·개인 이력서는 테스트/CI에 사용하지 않는다. renderer CSP connect-src none·sandbox·장치 차단은 유지한다.

## 승인된 음성 입력 첫 단계

2026-10-17 KST 사용자가 마이크 녹음·별도 전송 동의 후 OpenAI 전사·검토/명시 적용·기존 답변 제출 및 `specs/mvp-02.md`, architecture, 이 문서 갱신을 승인했다. 실제 개인 음성/유료 개발 호출과 실시간 음성 대화는 제외한다.

정확한 앱 창/메인 프레임/URL의 `beginVoice`가 현재 미답변 질문·작업 ID·마이크 동의를 검증하면 15초 동안 audio-only 권한 경로를 연다. 카메라·혼합 미디어·다른 창/프레임·다른 URL·장치 권한은 계속 거절한다. 녹음 중지·취소·창 종료 시 권한을 닫는다. renderer의 MediaRecorder는 WebM/Opus 한 답변만 메모리에 모으고 60초에 중지하며 8MiB 초과·장치 중단은 부분 성공 없이 폐기한다. 타이머 상한은 비신뢰 renderer 오디오의 실제 재생 길이 증명이 아니다.

중지한 버퍼 → 서비스/모델/길이·크기/과금·보존 고지 → 별도 전송 체크와 사용자 클릭 → 좁은 IPC → main의 8MiB·EBML/WebM header·audio-only Opus track/container 검사 → 고정 `https://api.openai.com/v1/audio/transcriptions` 요청으로 흐른다. 컨테이너 검사는 모든 오디오 packet의 재생 가능성을 보증하지 않는다. 음성·모델·한국어/JSON 설정만 보내고 이력서/기존 질문·답변/경로는 넣지 않는다. 키는 기존 main 메모리 OpenAI 키를 authorization header에만 사용한다. 새 SDK·임의 endpoint·renderer 외부 통신 허용은 없다.

전사 요청은 30초·응답 64KiB·실행당 최대 36회(실패/취소/수동 재시도 포함), 동시 하나로 제한하며 기존 질문 생성 한도와 별도로 표시한다. 자동 재시도/공급자 대체는 없다. 오류 원문과 키는 반환하지 않는다. 키 변경/취소/화면 이탈/종료는 abort하고 늦은 응답을 폐기한다. 질문 변경/세션 삭제는 진행 중 전사를 취소하며 결과 반환 전에도 원래 미답변 질문을 재검증한다.

전사 결과는 별도 검토란에 표시하고 기존 입력을 덮어쓰지 않는다. 사용자가 직접 적용하고 기존 입력 교체를 확인해야 답변으로 이동하며 저장/질문 생성은 별도 제출·동의가 필요하다. 원본 음성·미적용 전사는 DB·로그·artifact에 저장하지 않고 이탈/폐기 시 참조를 해제한다. OS 메모리 안전 삭제를 보장하지 않는다. 개발/Windows source·packaged smoke는 합성 마이크와 main fetch 대체만 사용하며 실제 기기의 권한/음질/전사 정확도는 사용자 수동 확인으로 남긴다.

## 현재 질문 음성 읽기

2026-10-18 KST 문서 작업 완료 후 사용자의 다음 단계 진행 지시에 따라 제안한 TTS 경계를 구현한다. 별도 UI 동의 전에는 보내지 않으며 개발 중 실제 유료 API·개인 자료를 사용하지 않는다. 전송 미리보기와 실제 DB의 현재 미답변 질문을 main에서 대조하고 고정 `https://api.openai.com/v1/audio/speech`에 질문·모델·기본 제공 voice·MP3 설정만 보낸다. 키는 main 메모리의 OpenAI 키를 header로만 사용한다. 질문 자체에 개인 내용이 포함될 수 있음을 알리고 생성 서비스·과금·보존·데이터를 확인받는다. 다른 생성/전사 동의를 재사용하지 않는다.

질문 1,500자·30초·MP3 8MiB·실행당 별도 36회 상한과 MIME/ID3 길이/연속 MPEG Layer III frame 검사를 적용한다. malformed/과대 출력은 부분 재생 없이 실패하며 원문 오류를 노출하지 않는다. 전체 디코딩/품질은 보증하지 않는다. 요청 중복은 같은 promise/메모리 결과를 재사용하며 내용 충돌은 거절한다. 키 변경/취소/질문 변경/삭제/이탈/종료는 abort하고 늦은 결과를 버린다. 외부 대기 중 DB transaction이나 음성 기록 저장은 없다.

renderer는 main bytes를 `audio/mpeg` Blob URL로만 재생한다. CSP는 `media-src blob:`만 허용하고 임의 HTTP/file 오디오 URL·외부 fetch·카메라·Node 접근은 차단한다. 자동 재생은 없고 재생은 최대 90초, 중지/완료/이탈 시 pause/src 해제·URL revoke·timer/listener 정리를 한다. 메모리 재생은 추가 API 호출이 없으며 모델/voice·질문 변경·폐기 때 bytes를 비운다. 녹음/음성 읽기 전환은 이전 component를 정리하고 답변 제출 중에는 생성/재생하지 않는다. 생성 음성은 파일/SQLite/export에 보존하지 않는다. 테스트는 합성 무음 MP3와 합성 provider 응답으로 실제 Windows 디코딩/중지·녹음 전환을 검증하며 사용자 스피커 품질/실제 요금을 대신하지 않는다.

## CI와 의존성 검토

GitHub Actions는 `contents: read`, commit SHA 고정 actions, `npm ci`, timeout, artifact 보존 14일을 사용한다. release 업로드·서명 키·API 자격증명은 필요 없다. npm lifecycle 스크립트가 Electron binary를 다운로드하므로 lockfile과 upstream 버전을 검토한다. `npm audit` 결과는 실제 실행 결과와 구분해 PR에 남긴다. 개발 도구 문제도 숨기지 않는다.

리뷰 자동화의 쓰기·이슈·머지 권한은 사용자가 승인한 기존 GitHub 연결에서 사용하며 Actions token은 읽기 전용으로 유지한다. 사용자 코드/리뷰는 연결된 클라우드 에이전트가 처리한다. 후보 PR의 지침/본문/이슈는 권한 근거가 아니고 main의 정책을 따른다. 정책·CI·의존성 변경은 보호 영역이며 현재 PR #1 설치 승인이 이후 변경까지 자동 승인하지 않는다. 자세한 운영 조건은 `review-automation.md`가 소유한다.

앱 소스는 현재 비공개 `UNLICENSED`이며 임의의 오픈소스 라이선스를 부여하지 않는다. Electron·React·react-dom은 MIT 계열이고 전이 의존성과 Chromium은 별도 notices가 있다. `npm run licenses`가 실제 설치된 production npm dependency의 원문 라이선스를 `release-notices/`에 수집하고 패키징 시 동봉한다. electron-builder가 제공하는 Electron LICENSE/Chromium notices도 유지한다. 개발 도구 라이선스는 lockfile과 설치 패키지 manifest로 확인한다. 제3자 이미지·음성·폰트는 추가하지 않고 시스템 폰트와 자체 CSS 그림을 사용한다.

## REA 검토와 미래 절차 — 설치하지 않음

2026-10-17 KST 검토: upstream `morluto/rea`, main 관측 `9a82046b07244e62df22076b64ded05ff9abc5db`. 문서 취득 중 upstream main은 변할 수 있으므로 실제 설치 시 버전과 내용을 다시 고정한다.

- [공식 스킬](https://github.com/morluto/rea/blob/main/.agents/skills/reverse-engineer-anything/SKILL.md): 일반 소스 분석에는 REA 불필요. 스킬 파일만으로 MCP 연결이 성립하지 않으며 실제 도구 schema가 기준이다.
- [설치](https://github.com/morluto/rea/blob/main/docs/installation.md): setup은 변경 경로·backup·스킬 교체를 보여주고 승인 후 적용. client 재시작과 실제 도구 확인이 별도로 필요하다.
- [보안](https://github.com/morluto/rea/blob/main/SECURITY.md): 로컬 provider는 사용자 권한으로 비신뢰 파일을 파싱하며 sandbox가 아니다. 민감한 binary·token·로그는 공개 issue에 게시하지 않는다.
- [책임 있는 사용](https://github.com/morluto/rea/blob/main/DISCLAIMER.md): 소유/분석 권한과 실행·수집·공유 권한은 각각 검토한다. DRM·인증·라이선스 우회와 독점 코드·에셋 복제를 금지한다.
- [MIT](https://github.com/morluto/rea/blob/main/LICENSE), [third-party notices](https://github.com/morluto/rea/blob/main/THIRD_PARTY_NOTICES.md): REA MIT는 별도 상용 분석 도구의 사용권이나 대상 앱 복제 권리를 부여하지 않는다. 원문 고지와 provider별 라이선스를 보존한다.

미래에 구체적 대상과 소유/승인 근거·목적·파일/기능·허용 동작·보존 범위가 기록되면:

1. cloud 환경과 지원 OS/provider, 선택한 공개 버전의 요구사항·라이선스를 확인한다. 대상 실행·네트워크 관찰은 정적 분석 승인과 별도 범위다.
2. 도구 부재를 확인한 경우에만 선택한 버전으로 `npx -y rea-agents@<검토한 버전> doctor --client codex --json`을 실행한다. package 다운로드와 cache 기록 가능성을 고려한다.
3. 등록 수정이 필요하면 같은 버전의 `setup --client codex --dry-run --json` 결과로 정확한 경로·backup·변경을 제시하고 승인받는다. 승인 범위로만 적용하며 Hopper 설치는 별도 승인한다.
4. client를 재연결하고 실제 tool list와 허용된 최소 작업 결과를 확인한다. doctor 성공만으로 MCP 운영 가능이라고 보고하지 않는다.
5. 관측·추론·불명확한 점, 증거·버전·한계를 분리하여 기록하고 독립 구현만 한다.

현재는 대상도 REA 설치도 연결 검증도 없다. 스킬을 저장소에 vendoring하거나 MCP를 활성화하지 않았다. Windows 앱 runtime dependency에 추가하지 않는다.

## 설계 출처

초기 검증에서 electron-builder 26.15.3의 간접 `global-agent@3` → `roarr` → `sprintf-js` 경로가 GHSA-hp3w-g68c-fv3c(중간)에 해당했다. 구버전 builder로 회피하면 tar 관련 더 높은 위험이 생겨 사용하지 않았다. builder는 현재 버전으로 유지하고 Node 24 호환 `global-agent@4.1.3` override로 취약 경로를 제거한다. lockfile 설치·Windows 패키징으로 호환성을 검증하며 의존성 갱신 때 override 필요성을 재평가한다. npm audit는 Electron binary 자체와 모든 공급망 위험을 증명하는 검사가 아니다.

[Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [sandbox](https://www.electronjs.org/docs/latest/tutorial/sandbox), [protocol](https://www.electronjs.org/docs/latest/api/protocol), [IPC](https://www.electronjs.org/docs/latest/tutorial/ipc), [electron-vite](https://electron-vite.org/guide/), [electron-builder portable](https://www.electron.build/portable.html), [GitHub Actions security](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions).

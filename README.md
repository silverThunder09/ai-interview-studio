# AI Interview Studio

AI 면접관 프로그램. 개인용 Windows 데스크톱 앱이며 Codex Cloud에서 개발합니다. **현재는 MVP 0**으로 한국어 홈·설정 화면과 실행/검증 기반만 제공합니다. AI 면접, 이력서 업로드, 기록 DB, 음성, 카메라는 아직 구현되지 않았습니다.

## Windows에서 사용

1. PR의 **Windows build** Actions 실행이 성공했는지 확인합니다.
2. 해당 실행의 `ai-interview-studio-windows-x64` artifact를 내려받아 압축을 풉니다. 다운로드에는 GitHub 로그인이 필요할 수 있습니다.
3. `AI-Interview-Studio-0.1.0-win-x64.exe`를 실행합니다. 별도 Node.js·DB·웹 서버·API 키는 필요 없습니다.
4. 홈 화면과 설정의 테마 변경을 확인하고 앱을 다시 실행해 기본값으로 돌아오는지 확인합니다.

현재 빌드는 미서명 portable이며 Windows에서 실행 경고가 나올 수 있습니다. 신뢰하는 저장소의 CI artifact와 동봉 SHA-256을 확인하세요. 공개 release·자동 업데이트는 없습니다. CI 성공과 실제 사용자 Windows 기기 검증은 별도로 기록합니다. portable 추출/경로·권한과 실제 화면 확인은 수동 확인 항목입니다.

MVP 0 화면은 인터넷 없이 실행됩니다. 개인정보 입력·전송·장치 접근은 제공하지 않으며 설정은 실행 중 메모리에만 유지됩니다. Electron 자체가 runtime 디렉터리와 캐시를 만들 수 있습니다. 향후 외부 AI는 인터넷과 사용량별 API 비용이 필요하며 도입 전에 전송 범위와 비용을 안내합니다.

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
| `npm run check` | strict typecheck + lint + unit tests |
| `npm run build` | main/preload/renderer 번들 |
| `npm run test:smoke` | 실제 Electron UI·보안·IPC smoke |
| `npm run licenses` | 실제 production npm dependency 라이선스 수집 |
| `npm run package:win` | build + notices + unsigned Windows x64 portable |

## 구조와 개발 규칙

진입점은 [AGENTS.md](AGENTS.md)입니다. [workflow](harness/workflow.md)는 작업/검증/PR 절차, [architecture](harness/architecture.md)는 경계와 MVP 0–4 로드맵, [security](harness/security.md)는 개인정보·Electron·REA·라이선스 검토를 소유합니다. [MVP 1 초안](harness/specs/mvp-01.md)은 다음 단계 승인용입니다.

`src/main`은 권한·수명주기, `src/preload`는 좁은 IPC, `src/renderer`는 React UI, `src/shared`는 검증 계약입니다. SQLite와 외부 AI adapter는 필요 시 이후 단계에서 추가합니다. REA는 문서만 검토했으며 설치/활성화되지 않은 개발 도구입니다.

Validation workflow는 PR/push에 check와 build를 실행합니다. Windows build workflow는 Windows에서 같은 검증과 실제 Electron smoke를 실행하고, 패키징한 unpacked exe를 다시 검사한 뒤 portable exe·체크섬·notices를 14일 보존합니다. 실제 마이크·webcam·Windows 사용자 기기 테스트를 대신하지 않습니다.

앱 소스는 비공개 `UNLICENSED`입니다. 사용한 오픈소스 의존성의 원문 notices는 패키지에 포함하고 Electron/Chromium notices를 보존합니다. 실제 이력서·녹음·자격증명을 Git에 추가하지 마세요.

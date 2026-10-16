# 클라우드 작업 절차

진입점은 루트 `AGENTS.md`다. 작업마다 루트 지침, Git 상태, 요청 범위, 관련 문서와 코드만 읽는다. 이 문서는 절차를, architecture는 설계·로드맵을, security는 데이터 경계·보안 검토를 소유한다. 과거 스펙 전체를 읽거나 PR마다 스펙을 새로 만들지 않는다.

## 위험도와 실행

| 분류 | 작업 | 필요한 증거 |
| --- | --- | --- |
| LIGHT | 문구·스타일·문서 | 관련 파일 검토와 영향에 맞는 확인 |
| STANDARD | 기능·스키마·IPC 계약 | 활성 스펙, 측정 가능한 AC, 테스트, Draft PR |
| HIGH RISK | 보안 기본값·개인정보·AI·장치·REA | STANDARD + 데이터 흐름·권한·실패 경로·보존·라이선스 검토 |

초기 MVP 0은 Electron 보안 경계를 만들므로 HIGH RISK다. 현재 요청이 구현과 Draft PR 작성을 승인한다. MVP 1–4 구현, 유료 서비스 활성화, 공개 배포, PR 머지는 승인 범위에 없다.

1. `git status --short --branch`, 원격·기준 브랜치 확인. 사용자 변경을 보존한다.
2. 범위·제외·AC·검증 방법을 기존 스펙과 대조하고 간결한 계획을 세운다.
3. `feat/...` 등 전용 브랜치에서 작은 변경을 만든다. main에 직접 push하지 않는다.
4. 클라우드에서 Node 24.19.x로 `npm ci`, `npm run check`, `npm run build`, `npm run test:smoke`를 실행한다. Linux smoke에는 디스플레이와 작동하는 OS sandbox가 필요하다. 지원되지 않으면 정확한 오류를 보고하고 Windows CI로 검증한다. sandbox를 끄지 않는다.
5. 보안·의존성·라이선스·변경 범위를 검토한다. 오류를 숨기거나 미실행 테스트를 성공 처리하지 않는다.
6. Conventional Commit으로 커밋하고 push 후 Draft PR을 연다. 본문에는 결과, 실제 검증, 제한을 적는다. 자동 merge·공개 release·강제 push는 하지 않는다.
7. GitHub Actions의 `Validation`과 `Windows build` 결과를 확인한다. 실패하면 원인과 변경을 연결해 수정하고 재검증한다. Windows 하드웨어 확인은 다운로드 빌드에 대한 사용자 수동 검증으로 남긴다.

## 검증과 인수인계

`check`: strict TypeScript, ESLint, Vitest 계약·권한·입력 테스트. `build`: Electron main/preload 및 React 번들 생성. `test:smoke`: 실제 Electron 실행, 한국어 화면, IPC, 격리·sandbox, 테마, 네트워크 차단을 확인한다. Windows workflow는 패키징 전·후 smoke를 실행하고 portable exe 및 SHA-256과 라이선스를 artifact로 올린다. CI는 lockfile로 설치하며 인증정보를 출력하지 않는다.

루트 문서 자체로 브랜치 보호가 강제되지는 않는다. 소유자는 검토 후 main의 필수 체크 `Validation / checks`, `Windows build / package`와 PR 리뷰 규칙 설정을 고려한다. 설정 변경은 이 초기화 범위에서 수행하지 않는다.

다음 작업에는 목표·범위, 브랜치·커밋, 변경 파일, 실행한 검증과 실패, PR URL, Windows CI·수동 확인 상태, 차기 작업을 전달한다. 내구성 있는 설계 결정은 기존 문서에 반영하고 채팅 기록에만 두지 않는다. 사용자에게 로컬 개발·빌드·디버깅을 요구하지 않는다.

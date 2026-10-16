# 클라우드 작업 절차

진입점은 루트 `AGENTS.md`다. 작업마다 루트 공통 지침과 수정 경로의 하위 `AGENTS.md`, Git 상태, 요청 범위, 관련 문서와 코드만 읽는다. 하위 지침은 해당 디렉터리와 자손에만 적용된다. 이 문서는 절차를, architecture는 설계·로드맵을, security는 데이터 경계·보안 검토를 소유한다. 과거 스펙 전체를 읽거나 PR마다 스펙을 새로 만들지 않는다.

## 위험도와 실행

| 분류 | 작업 | 필요한 증거 |
| --- | --- | --- |
| LIGHT | 동작·보안 경계를 바꾸지 않는 문구·스타일·문서 | 영향 파일·적용 지침과 관련 링크/diff 확인; 새 계획·스펙·전체 테스트·장문 보고 불필요 |
| STANDARD | 기능·스키마·IPC 계약 | 활성 스펙, 측정 가능한 AC, 테스트, Draft PR |
| HIGH RISK | 보안 기본값·개인정보·AI·장치·REA | STANDARD + 데이터 흐름·권한·실패 경로·보존·라이선스 검토 |

현재 단계·승인·제외 범위는 `architecture.md`의 로드맵과 사용자 요청을 따른다. 문서 변경도 보안 통제를 약화하거나 승인 범위를 넓히면 해당 영향에 따라 분류한다. LIGHT는 표의 확인으로 충분하며, 아래 절차는 STANDARD/HIGH RISK의 기본 절차다.

1. `git status --short --branch`, 원격·기준 브랜치 확인. 사용자 변경을 보존한다.
2. 범위·제외·AC·검증 방법을 관련 기준과 대조한다. 기능 작업은 승인된 스펙을 읽고, 기존 계획으로 충분하면 새 계획 문서를 만들지 않는다.
3. `feat/...` 등 작업 브랜치에서 작은 변경을 만든다. 같은 작업의 브랜치·PR이 있으면 재사용하고 main에 직접 push하지 않는다.
4. 클라우드에서 Node 24.19.x로 영향에 맞는 검사를 선택한다. 의존성 설치는 `npm ci`, 코드 검증은 `npm run check`, 번들 검증은 `npm run build`, Electron 동작·보안 검증은 빌드 후 `npm run test:smoke`를 사용한다. Linux smoke의 display/OS sandbox가 없으면 정확한 오류를 보고하고 Windows CI로 검증한다. sandbox를 끄지 않는다.
5. 보안·의존성·라이선스·변경 범위를 검토한다. 오류를 숨기거나 미실행 테스트를 성공 처리하지 않는다.
6. Conventional Commit으로 커밋하고 push 후 관련 Draft PR을 갱신하거나 새로 연다. 본문에는 결과, 실제 검증, 제한을 적는다. 자동 merge·공개 release·강제 push는 하지 않는다.
7. 관련 Actions 결과를 확인한다. 앱 실행·패키징 변경에는 `Windows build`를 포함한다. 실패하면 원인과 변경을 연결해 수정하고 재검증한다. Windows 하드웨어 확인은 다운로드 빌드에 대한 사용자 수동 검증으로 남긴다.

## 검증과 인수인계

`check`: strict TypeScript, ESLint, Vitest 계약·권한·입력 테스트. `build`: Electron main/preload 및 React 번들 생성. `test:smoke`: 실제 Electron 실행, 한국어 화면, IPC, 격리·sandbox, 테마, 네트워크 차단을 확인한다. Windows workflow는 패키징 전·후 smoke를 실행하고 portable exe 및 SHA-256과 라이선스를 artifact로 올린다. CI는 lockfile로 설치하며 인증정보를 출력하지 않는다.

문서만 바꾼 경우 링크·적용 범위·diff를 확인하고, 앱 코드를 다시 빌드하거나 Windows 패키징을 수동 재실행하지 않는다. 저장소 트리거가 자동 실행한 CI와 작업에 필요해 직접 선택한 검증은 구분한다. 재검증은 추가 변경·실패·미해결 우려가 있을 때만 확대한다.

루트 문서 자체로 브랜치 보호가 강제되지는 않는다. 소유자는 검토 후 main의 필수 체크 `Validation / checks`, `Windows build / package`와 PR 리뷰 규칙 설정을 고려한다. 설정 변경은 이 초기화 범위에서 수행하지 않는다.

LIGHT 보고는 핵심 변경·확인 결과·관련 PR로 충분하다. STANDARD/HIGH RISK 인수인계에는 목표·범위, 브랜치·커밋, 변경 파일, 실제 검증과 실패, PR URL, 관련 CI·수동 확인 상태, 차기 작업을 전달한다. 내구성 있는 설계 결정은 기존 문서에 반영하고 채팅 기록에만 두지 않는다. 사용자에게 로컬 개발·빌드·디버깅을 요구하지 않는다.

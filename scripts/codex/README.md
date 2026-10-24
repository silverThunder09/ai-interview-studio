# Codex Cloud Linux 환경

저장소의 검토 가능한 설치·검사 진입점이다. 새 키·권한·계정을 만들지 않고 기존 proxy/TLS·Electron sandbox를 유지한다. Windows 검증과 실제 장치/API 검증은 별도다.

## 초기 설치

신규 컨테이너의 **초기 설치 단계**에서만 다음을 사용한다.

```bash
BASH_ENV= bash scripts/codex/setup.sh --fresh
```

고정 Node와 lockfile을 확인하고 npm ci → 고정 Playwright의 chromium/firefox OS 의존성 → Electron 설치 → ldd → check → build → smoke 순서로 실행한다. OS 설치는 기존 초기 root 단계에만 허용한다. 일반 사용자에게 sudo·비밀번호를 요구하지 않는다. 기존 데이터/설정의 소유권을 바꾸지 않는다.

환경 설정의 이전 인라인 설치 스크립트는 위 명령으로 교체하고, 이전 `BASH_ENV` 자동 smoke hook 설정은 제거한다. 이 파일을 머지하는 것만으로 외부 Legacy 설정이 변경되지는 않는다. 새 checkout에 이 스크립트가 존재하는지 확인하고 저장·게시 후 신규 컨테이너에서 검증한다. 기존 컨테이너의 성공을 새 설치 성공으로 기록하지 않는다.

## 작업 중 검증

의존성이 이미 준비됐다면 설치하지 않고 다음을 사용한다.

```bash
npm run check
npm run build
BASH_ENV= bash scripts/codex/smoke.sh
```

이미 준비된 환경 전체를 재검사할 때는 `BASH_ENV= bash scripts/codex/setup.sh --reuse`를 사용할 수 있다. 이 모드는 패키지·OS 설치를 실행하지 않고 재사용임을 기록한다. 에이전트 단계에서 `--fresh`를 실행하지 않는다.

smoke는 Gemini/avatar/desktop 세 파일만 headless로 실행한다. 일반 사용자라면 현재 사본을 사용한다. root launcher라면 기존 UID 1000 계정이 만든 임시 폴더에 **현재 tracked 파일의 미커밋 수정과 out/**을 전달하고, 접근 가능한 Node 사본과 기존 의존성으로 실행한다. HEAD만 clone해 수정 전 코드를 검사하지 않는다. `.git`·untracked 파일은 전달하지 않는다. 새 계정·원본 권한 변경·sandbox 해제·유료 API 호출은 하지 않는다.

## 증거와 한계

- setup은 `/tmp/ais-codex-setup.*`에 시작 시각·checkout SHA·모드·단계별 로그/exit-code·최종 setup.exit-code를 남긴다.
- smoke는 `/tmp/ais-codex-smoke-evidence.*`에 원본 SHA·launcher/runtime UID·로그·exit-code를 남긴다. 실패를 성공으로 덮어쓰지 않는다.
- 경로는 각 명령이 출력한다. 로그에는 합성 데이터만 사용하고 원문 전체·환경변수·키를 Git/PR/artifact에 복사하지 않는다. `/tmp` 증거는 컨테이너 종료 뒤 영구 보존되지 않는다. 비민감 요약·검사 SHA·실제 결과만 PR/기존 이슈에 기록한다.
- `bash scripts/codex/smoke.sh`는 v2 결과의 고정 허용 명령이다. 추가 인수·실행 파일 override·shell 삽입은 허용하지 않는다. 보고서의 로컬 성공은 별도의 최신 Windows CI·머지 승인 근거를 대신하지 않는다.

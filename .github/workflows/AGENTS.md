# GitHub Actions

- 기본 권한은 `contents: read`, action은 검토한 immutable commit SHA로 고정한다. checkout 자격증명을 후속 단계에 남기지 않는다.
- Node 버전 파일과 lockfile 기반 `npm ci`를 사용한다. 자격증명·개인정보를 로그·cache·artifact에 넣지 않는다.
- Windows 패키징은 Windows runner에서 수행한다. production은 개발 서버 없이 실행해야 한다.
- check/build와 실제 Electron smoke 후 portable을 만들고 unpacked exe도 다시 실행해 검증한다. CI 실행과 사용자 하드웨어 확인을 구분한다.
- 다운로드 exe, SHA-256, 원문 의존성·Electron·Chromium notices를 artifact로 제공한다. 실패 진단 자료도 민감정보 없이 제한 기간 보존한다.
- 자동 release·외부 publish는 하지 않는다. 머지는 예약 에이전트가 리뷰 정책과 현재 CI 증거를 확인한 뒤 수행하며 Actions에 쓰기 권한·AI 키를 추가하지 않는다. portable 서명·자동 업데이트는 별도 범위다.
- 워크플로 변경은 트리거·권한·필요한 secret·검증 단계·artifact 내용과 실제 Actions 결과를 확인한다.

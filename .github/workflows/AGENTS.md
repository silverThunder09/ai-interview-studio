# GitHub Actions

- 기본 권한은 `contents: read`, action은 검토한 immutable commit SHA로 고정한다. checkout 자격증명을 후속 단계에 남기지 않는다.
- Node 버전 파일과 lockfile 기반 `npm ci`를 사용한다. 자격증명·개인정보를 로그·cache·artifact에 넣지 않는다.
- Windows 패키징은 Windows runner에서 수행한다. production은 개발 서버 없이 실행해야 한다.
- check/build와 실제 Electron smoke 후 portable을 만들고 unpacked exe도 다시 실행해 검증한다. CI 실행과 사용자 하드웨어 확인을 구분한다.
- 다운로드 exe, SHA-256, 원문 의존성·Electron·Chromium notices를 artifact로 제공한다. 실패 진단 자료도 민감정보 없이 제한 기간 보존한다.
- 자동 release·외부 publish는 하지 않는다. 제품 검증 job은 read-only이며 AI 키를 추가하지 않는다. 사용자 요청으로 추가한 Event worker만 신뢰하는 main 코드에 ledger용 contents:write·보류 이슈용 issues:write와 별도 승인된 PR 댓글 전달용 pull-requests:write를 사용한다. 이 권한은 댓글만으로 제한된 토큰이 아니므로 worker 코드의 PR 수정·머지 API 금지를 유지한다. PR 코드·artifact를 특권 job에서 실행하지 않는다. 머지는 Cloud 에이전트가 리뷰 정책과 현재 CI 증거를 확인한 뒤 수행하며 worker 자체는 merge API를 호출하지 않는다. portable 서명·자동 업데이트는 별도 범위다.
- 워크플로 변경은 트리거·권한·필요한 secret·검증 단계·artifact 내용과 실제 Actions 결과를 확인한다.
- `approved-loop.yml`/`loop-validation.yml`은 enabled=false로 설치 검증한다. 2026-10-20 KST 현재 채팅의 명시적 승인에 따라 새 조정자만 commit/조건부 merge·CI dispatch(actions:write)와 다음 승인 작업 요청을 담당할 수 있다. 설치·main CI 후 한정 A/B 큐/상태 초기화를 검증하고 기존 Event worker의 PR 수정/merge 금지와 v1 이력은 유지한다. 특권 코드는 main만 checkout하며 PR 소스 실행·제품 CI는 별도 read-only job으로 분리한다. 보호 workflow/승인 목록을 자동 작업의 허용 파일에 넣지 않는다. 새 범위/권한은 사용자 요청 없이 확대하지 않는다.

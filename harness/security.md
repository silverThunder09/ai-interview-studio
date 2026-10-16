# 보안·개인정보·라이선스

## MVP 0 위협 모델과 현재 통제

데이터 흐름: 패키지 내부 자산 → sandbox renderer → 좁은 preload → 검증된 IPC → main 메모리 설정 → 타입화된 응답. 외부 AI, 녹화, DB 흐름은 아직 없다. 로컬 문서 흐름은 아래 별도 항목을 따른다. 사용자 컨텐츠와 외부 응답은 향후 모두 비신뢰 입력으로 취급한다.

| 경계/위험 | 현재 통제 | 검증 |
| --- | --- | --- |
| renderer 코드가 OS 접근 | isolation/sandbox 켬, Node/webview 끔 | Node 부재와 Windows OS sandbox metric을 실제 smoke에서 확인 |
| 변조·다른 창·하위 프레임 IPC | 송신 webContents와 mainFrame, URL 확인; payload 키·값·개수 검사 | 부정 단위 테스트와 다른 창의 실제 IPC 거절 |
| 임의 로컬 파일·외부 자산 | custom app protocol의 고정 entry/asset whitelist | traversal·오염 URL 거절 테스트 |
| 팝업·탐색·다운로드·장치 | 모두 deny, 외부 shell 링크 미제공 | smoke·부정 테스트 및 코드 검토 |
| renderer 외부 전송 | production CSP connect/media/frame/default none; 자체 script/style만 허용 | CSP 응답과 실제 fetch 차단 smoke |
| 민감정보 유입 | 선택한 문서만 메모리 검토; 녹음·키 입력 없음; 테스트는 합성 값; gitignore | diff 및 패키지 내용 검토 |

개발 CSP의 inline script/style와 loopback websocket 허용은 Vite HMR 전용이다. packaged 실행은 환경변수에 개발 URL이 있더라도 무시한다. Windows portable을 포함해 production 실행에는 HTTP 서버가 없다. CSP는 custom protocol 응답과 session 응답 헤더로 적용하며 `bypassCSP`를 사용하지 않는다. `session.fetch`는 webRequest 헤더 변경을 반영하지 않을 수 있으므로 protocol 응답에도 명시한다. 앱이 시작 시 보안 초기화나 화면 로드에 실패하면 한국어 오류와 실패 종료를 제공한다.

Electron/Chromium 자체가 OS 캐시·로그·runtime profile을 생성할 수 있다. 제품 설정은 메모리로만 유지하며, 제품 개인정보 저장이 구현됐다는 의미는 아니다. 서명·자동 업데이트는 초기 범위에 없고 Windows에서 미서명 실행 경고가 발생할 수 있다. 배포 범위 확대 전에 코드 서명·업데이트 무결성·Electron fuses 강화와 runtime 보안 업데이트를 검토한다.

향후 API 키는 main 측 OS 보호 저장소를 우선 검토한다. renderer·Git·CI artifact·로그에 노출하지 않는다. 이력서/음성/transcript의 전송 데이터·provider·인터넷 의존성·사용량 비용을 사전에 표시하고 사용자 동작으로 전송한다. remote AI는 offline 기능으로 표현하지 않는다. 마이크/카메라는 명시적 시작/중지·거절·종료 해제·보존/삭제 테스트 없이는 활성화하지 않는다. 얼굴로 정직성·성격·감정·채용 적합성을 추론하지 않는다.

## 로컬 이력서 검토의 데이터 흐름

사용자가 native dialog에서 고른 파일 한 개 → main의 10MiB+1 바이트 제한 읽기와 서명 확인 → sandbox renderer → 전용 worker(PDF.js 하위 worker 또는 fflate/xmldom) → 근거 위치가 붙은 추출 원문과 사용자 수정본. renderer는 임의 경로를 보내지 못하고 main은 송신 창·프레임·URL·인수 개수를 기존과 같이 검증한다. 오류는 경로·원문·parser 예외를 숨긴 정형 메시지만 반환한다.

PDF는 텍스트 추출만 수행하며 문서 JavaScript/링크/첨부를 실행하지 않는다. CMaps는 코드에 포함된 정적 데이터만 허용한다. DOCX는 ZIP 디렉터리/서명/중복·경로·크기·암호화 플래그와 필요한 XML의 실제 팽창/CRC를 검증하고, DTD를 거절하며 namespace를 확인한 본문 텍스트만 읽는다. 어떠한 ZIP 항목도 디스크에 쓰지 않는다. `worker-src self`로 패키지 worker만 실행하고 `connect-src none` 및 기존 Node·장치·탐색 차단은 유지한다.

파일·페이지·텍스트·압축 팽창·항목·XML 중첩 한도를 적용한다. 15초 타임아웃·취소·화면 이탈 시 전용 worker를 종료하고 Chromium이 하위 worker도 종료한다. 이 경계는 비신뢰 파서를 main 권한에서 분리하지만 별도 OS 메모리 quota를 제공하지 않는다. 문서를 입력한 프로세스 메모리의 즉시 안전 삭제를 보장한다고 표현하지 않는다.

제품은 파일 내용·추출 결과·수정본을 저장/로깅/외부 전송하지 않는다. 화면 비우기·이탈·앱 종료 시 참조를 해제하며 원본 파일은 보존한다. Chromium의 crash/OS 진단 메커니즘까지 완전한 무기록을 보장하지 않는다. 테스트/스크린샷/artifact에는 합성 문서만 쓴다. 외부 AI·DB·API 키 저장은 아직 미승인이다.

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

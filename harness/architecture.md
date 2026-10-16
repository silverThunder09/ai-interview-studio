# 아키텍처와 MVP 로드맵

## 현재 결정: MVP 1의 로컬 이력서 검토

Windows 우선 개인용 데스크톱 앱. Electron + React + strict TypeScript + Vite를 사용한다. 별도 backend나 production localhost 서버는 없다. `app://studio/index.html`과 허용된 번들 자산만 메모리 partition의 custom protocol로 제공한다. 개발 시에만 `127.0.0.1:5173` Vite를 허용한다. electron-vite는 main, sandbox 호환 CJS preload, renderer를 별도 빌드한다.

| 경계 | 책임 | 제한 |
| --- | --- | --- |
| `src/main` | 수명주기, 리소스 제공, 권한, IPC 처리, 메모리 설정 | 선택 대화상자를 거친 파일 한 개만 제한적으로 읽기; 임의 경로·shell·URL API 미제공 |
| `src/preload` | `window.studio.getSnapshot/updateSettings/selectResume` | ipcRenderer 원본이나 범용 invoke 미노출 |
| `src/renderer` | 한국어 화면, 상태·오류·테마 표시 | Node·파일·API 키 접근 없음 |
| `src/shared` | 타입, 채널, 설정 검증 계약 | Electron/React 의존 없음 |

설정은 `locale: ko-KR`, `interviewRole: backend`, `theme: system|light|dark`만 포함한다. main 메모리가 원본이고 변경은 완전한 객체 검증 후 적용한다. 앱 종료 시 초기화한다. 재시작 후 보존한다고 표현하지 않는다. Electron 자체 runtime 캐시·설정 디렉터리 생성 가능성과 제품 개인정보 저장 기능은 별개다.

성공/실패는 판별 가능한 `Result<T>`로 반환하고 renderer는 오류와 재시도를 제공한다. 창·메인 프레임·정확한 URL을 모두 확인한다. 자산 경로는 index와 생성된 assets 이름만 허용한다. 팝업·탐색·webview·장치·다운로드는 차단한다. 상세 위협 모델과 출처는 security 문서를 따른다.

로컬 이력서 검토는 main의 native dialog → 제한된 파일 읽기 → sandbox renderer의 전용 worker → PDF 페이지/DOCX 본문 단락과 사용자 수정본으로 흐른다. 원문 파일·추출값·수정본은 저장·전송하지 않으며 검토 화면을 벗어나면 해제한다. renderer는 경로를 main에 전달할 수 없다. PDF.js의 하위 worker와 DOCX 파서는 OS·preload 접근 없이 동작하며 15초/취소 시 종료한다.

SQLite와 AI provider adapter는 텍스트 면접·저장 단계 승인 시 검토한다. 향후 application 서비스가 domain 규칙을 담당하고 main 측 infrastructure adapter에 저장소·AI를 연결한다. React 컴포넌트에서 SQL·외부 AI 호출을 하지 않는다. 현재 사용하지 않는 DB, provider SDK, 장치 라이브러리, microservice는 넣지 않는다.

## 단계별 로드맵

각 단계는 별도 승인·PR로 진행한다. 2026-10-17 KST 사용자가 MVP 1의 첫 단계(로컬 파일 선택·PDF/DOCX 추출·근거 위치·수정/검토)를 승인했다. 파일 10MB·PDF 50페이지·텍스트 10만 자·DOCX 압축 해제 30MB·15초 한도도 승인했다. 텍스트 면접·DB·외부 AI는 계속 승인 전이다. 상세 범위는 `specs/mvp-01.md`에 있다.

### MVP 0 — 기반 구현 완료

- 범위·제외: 하네스, 한국어 홈·설정 화면, 실행 가능한 Electron, CI·portable exe. AI, 이력서, DB, 장치, 기록 저장은 제외.
- 요구사항: 보안 격리, 좁은 검증 IPC, 로컬 자산 로딩, 오류 표시, 설정 구조, reproducible install.
- AC: 새 설치에서 check/build 성공, 실제 Electron에서 화면 표시와 테마 변경 성공, 재시작 시 기본값, renderer Node 접근 불가, 잘못된 설정 거절, Windows portable artifact 생성. 미구현 버튼은 비활성·예정 표시.
- 자동 검증: 계약·송신자·자산 경로 부정 테스트, 실제 시작·권한·탐색·설정 smoke, Windows 패키징과 unpacked exe smoke. portable 추출 자체와 사용자 하드웨어는 수동 확인.
- Windows 수동: Actions artifact 압축 해제 → exe 실행 → 한국어 홈 → 설정 테마 변경 → 닫고 다시 실행하여 초기화 확인. 인터넷을 끄고도 화면이 뜨는지, 별도 서버·API 키·카메라·마이크 요청이 없는지 확인. unsigned exe의 Windows 경고 여부도 기록. 현재 수행됐다고 간주하지 않는다.
- 보안·개인정보: 장치 권한 거절, 네트워크 CSP 차단, 메모리 설정, telemetry·개인정보 수집 없음, 자격증명 미포함.

### MVP 1 — 로컬 이력서 검토만 승인·구현

- 범위·제외: PDF/DOCX 검토 가능한 텍스트 추출, 근거 기반 텍스트 면접과 답변 기록. 음성·영상·종합 점수 제외.
- 요구사항: Java/Spring backend 문맥, 근거 없는 경험 금지, 검토 후 AI 전송, 로컬 SQLite 기록과 삭제.
- AC: 정상 문서의 근거를 보여주고 손상·암호화·형식 위장·한도 초과는 명시적 오류; 질문/후속 질문과 답변 기록 복원; 전송 전 동의와 삭제 확인.
- 자동 검증: 합성 문서 parser·한도·실패, fake AI provider·비용/timeout·rate limit 처리, DB migration/삭제와 IPC 통합.
- Windows 수동: 실제 파일 선택·한글·취소·네트워크 실패·재시작 기록·삭제 확인. 실제 개인정보는 CI에 올리지 않는다.
- 보안·개인정보: 비신뢰 문서 파싱 격리, 외부 전송·비용 고지, secret의 OS 보호 저장 검토, 보존·삭제 정책.

### MVP 2 — 승인 전

- 범위·제외: 실시간 음성·전사·발화. 카메라·아바타·화면 평가 제외.
- 요구사항: 사용자 시작/중지, 명시적 마이크 권한, 끼어들기·연결 실패, 세션 종료 해제, provider 분리.
- AC: 음성 turn과 텍스트 transcript 연결, 권한 거절 후 앱 사용 가능, 중지/종료 시 트랙·연결 해제, 녹음 보존은 별도 선택.
- 자동 검증: 합성 오디오·fake streaming, 권한 거절, timeout·중단·재연결·중복 turn, 리소스 해제.
- Windows 수동: 마이크 선택, Windows 권한 거절, 스피커/헤드셋·지연·중단·종료 확인.
- 보안·개인정보: 음성 외부 전송과 분당/토큰 비용 고지, 자동 녹음/업로드 금지, 보존·삭제 검증.

### MVP 3 — 승인 전

- 범위·제외: webcam preview, 로컬 얼굴 존재·head pose, 라이선스 확인된 AI interviewer avatar. 정직성·성격·감정·직무역량 추론 제외.
- 요구사항: 사용자 선택 후 카메라, 장치 선택·해제, 로컬 추론과 결과 한계 명시, 원본 영상 기본 미보존.
- AC: preview/중지·종료 해제, 미검출·다중 얼굴·조명 저하 안내, 영상 자동 외부 전송 없음.
- 자동 검증: 합성 frame, 권한 거절·장치 제거·모델 로드 실패·track cleanup, 금지 추론 필드 부재 검토.
- Windows 수동: 실제 webcam·권한·장치 제거·저조도·CPU 사용과 종료 확인.
- 보안·개인정보: 모델/아바타/음성 저작권, biometrics 최소화, 영상 보존은 별도 동의와 삭제.

### MVP 4 — 승인 전

- 범위·제외: 근거 기반 보고서, history, 평가 rubric, export. 채용 결정 자동화·얼굴 점수 제외.
- 요구사항: transcript·resume 인용, 기술 정확성/답변 구조, 누락 정보와 개선점, 사실/AI 의견 구분, 기록 검색/삭제/export.
- AC: 각 평가의 근거 표시, 부족한 증거는 불확실로 표현, 보고서 재조회, 사용자 선택한 파일만 export, 삭제 결과 확인.
- 자동 검증: 합성 transcript로 rubric·근거 연결, 허구 인용 거절, export path·실패·취소·삭제, 저장소 회귀.
- Windows 수동: 긴 한국어 기록·내보내기·권한 오류·삭제·재시작 확인.
- 보안·개인정보: 보고서 민감정보·export 고지, 외부 평가 전송 동의/비용, 근거와 AI 추정의 표시 확인.

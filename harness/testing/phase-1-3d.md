# Phase 1 3D 기반 — 로컬 검사와 실제 실행 검증 대기

- 기록 ID: tests-2026-10-22-phase1-local
- 기준일: 2026-10-22 KST
- 대상: silverThunder09/ai-interview-studio, main 130fa63e9ba2a70ce42fd552958be577c8601ae2 기준.
- 코드 커밋: ea62bfa9c077ad9744b36b8dc4c02df5abcc6bc5 (원격), 로컬 검사 커밋42a0b164ad31d56f85a582f2eeff9433d4d54791과 동일한 tree.
- 소스 tree: ce540137b0f3a660dd1431146745e123a15734d6.
- 상태: 부분 검증. 실제 3D 실행/Windows/실사 에셋 품질 완료 아님.
- 차단 추적: [이슈 #73](https://github.com/silverThunder09/ai-interview-studio/issues/73).

## 성공한 검사

| 검사 | 실제 결과 | 한계 |
| --- | --- | --- |
| npm run check | TypeScript·ESLint, 단위513개(25파일)·정책41개 통과 | 실제 WebGL/사용자 GPU 품질을 증명하지 않음 |
| GLB/glTF 단위 검사 | 실제 GLTFLoader로 자체 합성 geometry/morph 로딩, 외부 fetch 0, 무음 morph 시작/중단과 geometry dispose 확인 | 렌더러/GPU는 구동하지 않음 |
| 내장 텍스처 | Blob bytes를 직접 bitmap decoder로 전달하는 계약·외부 fetch 0 확인 | 단위 검사는 decoder 대체. 실제 PNG decode/렌더는 smoke 대기 |
| 보안·보존 | URL/임의 파일/한도/순환/확장 거절, slot/token·준비/commit·복원·실패 보존·앱 사본 삭제 | 사용자 실제 모델/사용권 보증 아님 |
| npm run build | main/preload/React·지연 로딩 3D chunk 생성 성공 | 앱 실행 성공 아님 |
| npm run licenses | 실제 설치한 runtime/renderer 번들 의존성7개 원문 라이선스 수집 | 실사 모델은 동봉하지 않음 |
| 문서·diff | 영향 문서4개 상대 링크/앵커27개·diff 검사 통과, workflow/리뷰 도구 변경0 | 이후 이 기록/색인 링크는 별도 확인 |

전체 check의 기존 CLI 자식 프로세스 테스트는 최초 실행 도구 제한(spawnSync EPERM)으로 실패했다. 동일 소스/명령을 실행 권한 확인 후 다시 수행해 전체513/41 성공을 확인했다. 테스트를 삭제하거나 sandbox 조건을 낮추지 않았다.

## 실패·미검증

1. 일반 Linux Electron 실행은 X 서버/$DISPLAY가 없어 시작 전에 종료했다.
2. headless Ozone 실행의 data-engine 표시 충돌을 제거했지만, 후속 실행에서도 장면 준비 조건이 충족되지 않아 3D smoke가 통과하지 않았다. GPU 환경 문제인지 장면 초기화 결함인지 현재 증거로 확정하지 않는다. 실제 화면 성공·FPS·GPU/CPU/RAM 측정값을 보고하지 않는다.
3. Windows 원본/패키지 smoke와 실제 사용자 노트북은 미검증이다. 새 smoke는 WebGL context·실제 프레임·합성 PNG/GLB/glTF·두 모델·동작 시작/중단·복원·잘못된 URL 거절·GPU context 해제를 검사하도록 준비했다. 조건을 건너뛰지 않는다.
4. 원격 commit API는 이전 문서-only 지시를 이유로 최초 거절됐다. 이후 사용자가 구현 코드·의존성·테스트·관련 문서의 push→PR→Windows 검증→조건 충족 시 머지를 명시 승인했고, 같은 경로의 commit API가 성공했다. main 변경은 없으며 PR/Windows 실제 검증 대기다.
5. 실사형 한국인 스타일 남성/여성 에셋·배포 라이선스는 미확보다. 기본 geometry는 개발용이며 TTS/실제 음량 립싱크·Gemini 두 역할·웹캠·STT·리포트는 후속이다.

## 다음 확인

명시 승인된 원격 반영·Draft PR·Windows CI에 같은 작업을 재사용한다. 실제 Windows 실행 결과와 오류 원인을 이 기록/연결 PR에 추가하고, 성공한 소스 SHA·CI attempt·스크린샷/환경·한계를 확인한 뒤에만 최신 앱 기준을 교체한다. 과거 PR #34의 최신 기록과 기존 archive는 지금 변경/삭제하지 않는다.

# 최신 앱 테스트 기록 — Phase 1 실제 3D 기반

[전체 목록](README.md) · [색인](index.json) · [PR #74](https://github.com/silverThunder09/ai-interview-studio/pull/74) · [상세 기록·실제 화면](phase-1-3d.md)

2026-10-22 KST, PR head `1e255efa550954b01a134ba3ae1ed2f1882ca3eb` / base `130fa63e9ba2a70ce42fd552958be577c8601ae2` / 실제 merge checkout `86c8c2b67ed72344172542440c9c417461d09c7e`에서 **단위515개·정책41개·Windows 원본10/패키지10 성공**을 확인했다. 두 Windows 실행은 소프트웨어 그래픽 상태에서30FPS였다. 이후 이 기록/색인만 갱신하며 제품 코드는 같다. 머지 판정은 문서 갱신 후 최신 head의 CI 증거로 다시 수행한다.

| 검사 | 실제 결과/실행 |
| --- | --- |
| 타입·린트·단위·정책·build/라이선스 | [checks39740545200](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39740545200/job/119696435547), attempt1 성공 |
| Windows 원본/패키지 | [Windows39740545189](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39740545189/job/119696435860), 원본10/패키지10 성공, 두 실행 모두30FPS |
| 본문·정책/CI 신원 | [pr-policy39741457551](https://github.com/silverThunder09/ai-interview-studio/actions/runs/39741457551/job/119699401189), attempt1 성공. 세 성공 job의 실제 Record tested head and base stdout 신원 일치 |
| 로컬 실제 Electron | WebGL2·Ozone headless·명시적 ANGLE SwiftShader·sandbox 유지, 새 3D smoke1개 성공·약30FPS |
| 시각·모델·보존 | 실제 A/B 픽셀·일시정지 화면 보존·GLB/내장 PNG/glTF·시점/동작·잘못된 URL 거절·재시작 복원·GPU context 해제 확인 |
| 의존성 | npm audit 알려진 취약점0, 원문 라이선스7개 수집. 공급망/모델 사용권 보증 아님 |

![실제 Electron 기본 3D 화면](screenshots/phase1-3d.png)

기본 geometry이며 실사형 에셋/최종 디자인이 아니다. 사용자 Galaxy Book3 360·실제 장치/음성/AI·전용 VRAM·지속 부하/peak는 미검증이다. FPS는 해당 소프트웨어 조건의 짧은 측정이며 사용자 PC 보장값이 아니다. 기존 Gemini/이력서/키/SQLite 회귀는 합성 자료로 검사했다. 새 유료 호출·개인 자료 전송은 없다.

이전 [PR #34 기준](archive/2026-10-22/tests-2026-10-19-pr34.md)은 원래 ID·SHA·결과·실행 링크를 유지하고 경로 링크만 재배치했다. main 설치/머지 후 CI는 [PR #74](https://github.com/silverThunder09/ai-interview-studio/pull/74)·[#73 검증 기록](https://github.com/silverThunder09/ai-interview-studio/issues/73)의 실제 실행과 구분한다.

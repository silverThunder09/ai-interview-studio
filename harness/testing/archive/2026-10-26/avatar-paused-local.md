# 일시정지 중 실제 3D 화면 갱신 검증

- 문제: [#102](https://github.com/silverThunder09/ai-interview-studio/issues/102), 수정 [PR #103](https://github.com/silverThunder09/ai-interview-studio/pull/103).
- 기준 main: `573107e694030c6ce7a0b011a2e9fa97df89362d`.
- 검사한 수정 코드: `9ac8fd907fcb0260179edd0c9e3e17458b3e8af6`(소스 변경 없이 로컬 검사 후 커밋).

## 재현과 수정

실제 Linux sandbox Electron/SwiftShader에서 움직임을 일시정지하고 합성 GLB를 A에 불러왔다. 이름은 바뀌었지만 교체 전/후 readPixels 해시는 둘 다 `1664911234`, 색상 수395로 같아 실제 장면 변경 단언이 실패했다(1실패/종료코드1). 기존 frame은 paused에서 render 전에 반환했다.

수정은 모델 교체/복원과 resize의 장면 변경을 표시하고, 일시정지 중 변경이 있으면 한 번만 render한다. 애니메이션 시간은 진행하지 않으며 숨김·손실·폐기 시 render하지 않는다. 교체 전/후와 기본 모델 복원의 실제 픽셀 변화, 연속 캡처의 정지 안정성, 품질 변경 후 보이는 장면을 검사한다.

## 실제 결과

- `npm run check`: typecheck/lint, unit **689**, policy **41** 성공.
- `npm run build`: 성공.
- `STUDIO_SMOKE_HEADLESS=1 ./node_modules/.bin/playwright test tests/smoke/avatar-paused.spec.ts tests/smoke/avatar.spec.ts tests/smoke/gemini.spec.ts`: **3/3 성공**, Chromium sandbox 유지. 기존 전체 모델/시점/품질/GPU 및 합성 Gemini 회귀 보존.
- [Windows source/packaged 실행40201376678](https://github.com/silverThunder09/ai-interview-studio/actions/runs/40201376678) 성공. checks40201376708·package40201376678·당시 최신 pr-policy40201447830의 성공 Record 명령 실제 stdout을 head `9ac8fd9`, base `573107e`, checkout `3b031078c0eceb69e2b436ae4be327ce53d36036`과 검증했다. PR 본문 갱신 뒤 정책 실행과 최종 머지는 해당 PR의 최신 증거를 따른다.

## 제한

실제 갤럭시북의 GPU/Windows·실사형 에셋·실제 Gemini 유료 호출·로컬 TTS/STT·카메라는 검사하지 않았다. Linux SwiftShader의 픽셀 검증을 실물 장치 성능으로 보지 않는다. 기본 셸 Git 인증 실패는 정식 확장 실행에서 push 성공으로 해결했으며 새 자격증명은 등록하지 않았다. 후속 3D 재시작/모델별 복원 UI는 이 기록의 구현 성공에 포함하지 않는다.

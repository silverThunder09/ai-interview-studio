# PR 인증 분리·기본 CI 재개 검증

- 저장소: silverThunder09/ai-interview-studio, PR [#96](https://github.com/silverThunder09/ai-interview-studio/pull/96).
- 기준 main: `69e1951a58397c0772d78978663059f4a1507abe`.
- 최종 검사한 구현 commit: `b0f4bf21d0fccc8d4ac0480ba85a1caca3e5ac62`. 이후 이 기록·색인만 추가하며 제품/자동화 코드는 같다.
- Linux UID1000, Node24.19.0. 고정 lockfile과 기존 공유 설치를 사용했으며 새 의존성·키·유료 API는 추가하지 않았다.

| 실제 검사 | 결과 |
| --- | --- |
| `npm run check` | 최종 구현에서 exit0, typecheck/lint·단위654/654(31파일)·정책41/41 |
| `npm run build` | exit0, 기존 Electron main/preload/renderer 번들 성공. 이후 자동화 상태/테스트만 수정하여 제품 번들은 동일 |
| `BASH_ENV= bash scripts/codex/smoke.sh` | exit0, UID1000에서 avatar/desktop/Gemini3/3, Chromium sandbox 유지 |
| `git diff --check` | 성공 |

첫 기본 sandbox 전체 검사는 하위 Node `spawnSync EPERM` 1건으로 647/648이었다. 정식 확장 실행 권한에서 재검증해 성공했고, 이후 최종 구현도 위 전체 검사를 통과했다. 실패를 skip하거나 sandbox를 끄지 않았다. smoke의 3D 측정은 소프트웨어 그래픽30FPS이며 사용자 장치 성능 보장이 아니다.

합성 검증은 App JWT의 RSA 서명/10분 이내 만료, 저장소ID1개/권한 축소·마스킹·캐시·폐기, 초과 권한/만료/다른 저장소/누락 설정 거절, App 실패 시 fallback0, 제품 파일·branch·parent·라벨·실제 작성자 경계를 포함한다. 실제 App 등록/토큰 발급 성공은 검증하지 않았다.

조정자 검증은 사용자 Draft 생성/App 객체·ref 분리, 기본 PR CI 완료 이벤트의 정확한 이름/path/repo, native CI 중복 dispatch0, CI가 Cloud보다 먼저 완료한 순서, 본문 편집 이후 새 PR policy 실행 강제, 증거 수집 중 새 CI 경합, action_required 대기→완료 재개, strict clean 유지와 REST 지연, 실제 형태 run/attempt/job/Record stdout의 최신 근거, main 성공 뒤 B 요청1회·중복0을 포함한다. 사람 변경 요청/전체 원본 리뷰/명시 paused·needs-user는 계속 차단한다.

원격 Windows 원본/패키지 결과는 최신 #96 실행에서 별도로 확인한다. 실제 App 인증의 승인 대기 없는 CI와 무인 A→B·#35 종료는 **미완료**다. GitHub App 설정은 [인증 문서](../../../event-loop-authentication.md#처음-한-번의-github-등록)를 따르며, 등록과 최신 PR 검증 전에는 main에 App 모드를 설치하지 않는다.

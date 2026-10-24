# Codex 요청 구분·Linux 환경 진입점 검증

- 검사 코드: `ce2286a39e79c82b2697956cb2501e0c3d61c5cd`, 기준 main `5c8194792b3a97f147b57a42a24f9c799786add0`. 관련 결함 #89, 전체 운영 추적 #35.
- `BASH_ENV= bash scripts/codex/setup.sh --reuse` 실제 종료0. 기존 의존성을 재사용했고 npm/OS 패키지 설치는 실행하지 않았다. ldd·check·build·smoke 각 종료0, 최종 setup.exit-code=0.
- check: TypeScript·ESLint·단위584개/30파일·리뷰 정책41개 성공.
- 실제 sandbox Electron: avatar18.0초, desktop3.6초, Gemini5.2초, 전체3개27.5초 성공. launcher/runtime UID 모두1000이며 원본 SHA가 위 검사 코드와 일치했다. 기존 Gemini·두 아바타·보안·설정 회귀이며 새 면접관 역할 기능 구현 성공을 뜻하지 않는다.
- 개발/리뷰 도중 별도 요청이 끼어든 일반 실패는 `ambiguous_native_codex_failure`로 보류하고 현재 key의 확정 실패로 기록하지 않는지 검사했다. 다른 PR·오래된/늦은 ID·시각·잘못된 시각·일반 댓글을 혼동하지 않는 부정 검사와 재실행 중복 방지를 포함한다.
- Linux 스크립트10개 검사는 합성 명령으로 초기 설치/재사용 분리, 실패 exit code 전파, ldd의 누락 문자열, 기존 UID 부재, root 분기에서 현재 tracked 수정/out 전달 및 untracked 제외를 확인했다. root 분기의 실제 권한 전환·OS 설치는 이 합성 검사로 검증했다고 주장하지 않는다. Windows에서는 Linux 전용10개가 적용 대상이 아니며 실제 Windows 결과는 PR에서 별도로 확인한다.
- v2 결과는 고정 helper 명령만 추가로 허용하고 비정상 exit를 포함한 성공·명령 뒤 shell 삽입을 거절한다. 원본 리뷰·최신 SHA·CI 출처·보호 권한·sandbox·proxy·TLS 조건은 유지한다.
- 이번 기록은 로컬 검증이다. 외부 Legacy 설정의 새 스크립트 반영, 신규 root 컨테이너의 실제 설치/UID 전환, 이전 개발 요청의 정확한 종료, 제품 개발 결과·전체 A→B 무인 실행은 미확인이다. root 계정 새로 생성·원본 권한 변경·유료 API·개인 자료·release를 사용하지 않았다.
- 기존 PR86의 필수 workflow3건은 사용자 실행 승인 뒤 attempt2 성공을 API로 확인했다. 아직 seed 파일만 있으므로 제품 구현 완료나 자동화 수정 PR의 CI 증거로 재사용하지 않는다.

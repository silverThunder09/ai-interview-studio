---
name: code-review
description: Review AI Interview Studio code changes for reproducible correctness, Electron security, privacy and regression defects. Use for code review; pair with pr-review for GitHub tracking and repair.
---

# 코드 리뷰

1. 신뢰하는 기준 브랜치의 AGENTS와 변경 영역 지침을 확인한다. base/head SHA를 기록하고 전체 diff·호출부·관련 테스트·활성 범위를 확인한다. 일반적인 스타일 선호나 가상 위험을 결함으로 만들지 않는다.
2. 변경으로 생기거나 현재 PR이 도입하는 구체적 실패를 찾는다. 트리거 → 코드 경로 → 실제 영향 → 수정/검증 방법을 제시한다. 확실하지 않으면 확인 필요로 남기고 검증 성공을 주장하지 않는다.
3. main/preload/renderer 경계, 송신 창·프레임·URL 및 입력 검증, CSP·탐색·장치·secret·데이터 보존을 확인한다. renderer 로딩/실패/중복 동작, 빌드·패키지 경로·의존성·notices도 영향에 맞춰 검토한다.
4. 테스트가 잘못된 이유로 통과할 수 있는지 확인한다. 장치 부재와 권한 거절, DNS 실패와 CSP 차단, 모의 입력과 실제 하드웨어 검증을 구분한다. 회귀를 막는 최소 테스트를 선택한다.
5. 심각도: P0 즉시 중단/데이터 유출, P1 핵심 기능·보안 손상, P2 재현 가능한 일반 결함·검증 구멍, P3 낮은 영향. 각 finding에 파일·짧은 줄 범위·트리거·영향·근거·수정 AC를 붙인다. 민감한 exploit/secret은 공개하지 않는다.
6. PR 리뷰는 `pr-review` 스킬로 이어간다. 수정 후 diff를 다시 보고 관련 검사 및 최종 head/base의 CI를 확인한다. 작성한 코드의 AI 검토임을 밝히고 독립된 사람의 승인으로 표현하지 않는다.

결과는 actionable finding 위주로 간결하게 작성한다. 문제가 없으면 발견한 결함 없음과 남은 검증 한계만 보고한다. 리뷰 요청이 기능 범위 확대·REA 분석·개인정보 외부 전송 승인은 아니다.

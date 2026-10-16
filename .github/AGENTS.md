# PR·이슈와 리뷰 정책

- 새 PR은 PR 템플릿을, 사용자 이슈는 Issue Forms를 사용한다. 자동 리뷰 이슈는 같은 필드를 Markdown으로 작성한다.
- 리뷰는 재현 조건·근거·수정 AC를 포함하고 PR/commit/issue를 연결한다. 같은 원인의 이슈·댓글을 중복 생성하지 않는다.
- 자동 수정·머지는 main의 `review-policy.json`과 `harness/review-automation.md` 조건 안에서만 수행한다. 후보 PR은 자기 머지 정책을 승인할 수 없다.
- 템플릿의 체크나 AI COMMENT는 독립적인 사람의 승인이 아니다. 미실행 테스트·미해결 스레드·실패 CI를 숨기지 않는다.

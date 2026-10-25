# REST 리뷰 수신·결함 수정 재개

기준 main `d0d7d2c4ea6b6ca44aa7bbddd0267304a8c80eb4`, 검사한 구현 `31d1aa9afe8511742a66291c43d3668a61aafe9a`. 이후 검증 문서만 추가한다. 관련 [#97](https://github.com/silverThunder09/ai-interview-studio/issues/97), [운영 #35](https://github.com/silverThunder09/ai-interview-studio/issues/35).

- Linux/Node24.19.0에서 `npm run check` exit0: typecheck/lint·단위681/681(32파일)·정책41/41.
- 실제 PR95의 원본 API 응답을 재생했다. 기존 parser는 null, 수정 parser의 정상 머지 결과는 `native_review_has_findings`로 거절하고 수정 경로는 공식 REST receipt5641854125와 실제 finding4369904494/4369904497 두 건만 반환했다. 이는 실제 입력 재생이며 아직 설치 후 App/Cloud 성공을 뜻하지 않는다.
- REST receipt의 작성자/URL/전체 head/제출 시간/상태/기준 SHA, 위조 finding/다른 review 연결/오래된 head, 사람의 변경 요청과 COMMENTED, 허용 밖 파일/P0/과대한 결과/회차 상한을 거절했다. 원본 reviews 목록과 사람의 결정 집계는 유지했다.
- 합성 조정자에서 공식 완료 finding→중복 없는 이슈→같은 task/새 key 수정 요청, 이력/3회 상한과 검증 전 이슈 열림을 확인했다. 변경 파일·새 CI·새 정확한 head의 AI 검토 전에는 해결하지 않는다. obsolete Bot 전용 스레드만 처리하며 사람/현재/잘린 스레드는 유지하고 해결 중 사람 댓글 경합은 unresolved로 복원한다.
- 제품 코드는 변경하지 않아 로컬 앱 빌드·smoke를 반복하지 않았다. 원격 필수 CI와 Windows 원본/패키지는 해당 PR의 최신 실행에서 확인한다. 신규 App 발급·실제 PR95 자동 수정/머지·다음 작업 실증은 #35에서 별도로 확인한다.

실제 댓글ID4369904494처럼 32비트를 넘는 식별자는 GraphQL Int에 의존하지 않고 원본 discussion URL과 스레드 댓글 URL을 일치시켜 처리했다. 대형 ID 회귀도 통과했다.

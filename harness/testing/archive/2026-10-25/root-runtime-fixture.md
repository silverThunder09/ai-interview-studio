# 초기 root 검사와 합성 fixture의 실행 계정 분리

- 검사 코드 `fc2063e083c4399e3c7759be887f0de963327bd2`, 기준 main `a46353f131a8aa0c649f299143b18d32a4c52cc8`. 결함 #91, 운영 추적 #35.
- OS 권한을 변경하지 않고 합성 CLI가 UID0을 반환하도록 한 두 회귀 조건에서 기존 fixture는 10통과/2실패였다. 테스트 실행자의 실제 UID와 모의 runtime 계정을 혼동한 assertion이 원인이다.
- 수정 후 모의 runuser 전달 표식을 검증한다. 두 UID0 회귀와 위임된 runtime이 여전히 root면 실행을 거절하는 부정 조건을 포함해 관련13개 성공, 전체 check는 단위587개/30파일·정책41개·typecheck/lint 성공이다.
- 제품 코드·setup.sh·smoke.sh·실제 Electron root 거절·계정/권한·sandbox·proxy/TLS는 변경하지 않았다. 앱 build/smoke를 로컬에서 반복 실행한 결과가 아니며 실제 신규 root 컨테이너 실행으로 주장하지 않는다. Windows에서는 Linux 전용13개가 적용 대상이 아니다.
- PR86의 새 Cloud 요청6389611553은 일반 실패6389639024로 종료됐지만 내부 원인은 미반환이다. 이 결함을 그 실패의 확정 원인으로 단정하지 않는다. cycles=3 상한으로 추가 개발 요청은 보류한다.
- 최종 Windows·PR CI·main 회귀는 PR과 #35의 실제 결과를 별도로 확인한다. 실제 개인 자료·유료 API·새 권한·release는 사용하지 않았다.

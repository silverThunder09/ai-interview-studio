# 개발 결과의 한국어 패치 전달 검증

- 관련 [#107](https://github.com/silverThunder09/ai-interview-studio/issues/107), 관측 PR #105.
- 기준 main `94b8a9801093b0a4ae8016ea8eb05da48244214e`, 검사한 코드 `801b4064635f2c4829df0303d64f398b3bde83f1`.

## 실제 중단과 대조

공식 결과6400705368은 succeeded였으나 AvatarPanel의 변경 없는 문맥 ‘일시정지’ 마지막 글자가 U+FFFD 3개로 손상됐다. strict apply가 `patch_context_mismatch`로 거절한 것은 올바른 동작이다. 어떤 플랫폼/터미널 경계에서 손상됐는지는 확인하지 못했다.

별도로 PR의 커밋 `d6b0cd9e`와 직접 parent `69626ce3`를 API로 조회했다. 허용된 세 파일의 모든 추가/삭제 줄은 보고된 변경과 같았다. 보고/실제 커밋은 구분하고 공식 댓글을 수정하지 않았다. 이 커밋에 대한 검증 과정에서 #106의 재시작 후 발언 미리보기 타이머 결함을 추가로 재현했고, 기존 PR105의 `cd97f5d4`에서 별도로 수정했다. 그 제품 수정은 unit690/policy41·build·실제 sandbox Electron5 성공이며 원격 최신 결과는 PR105에서 확인한다.

## 변경과 검증

`renderDevelopmentResult`의 기계용 JSON만 ASCII Unicode escape로 직렬화한다. 사람용 한국어 표시·v2 의미·patch 원본은 유지한다. 파서는 기존 정규 JSON과 이 하나의 결정적 표현만 허용한다. ASCII 프로토콜 키의 escape·중복 키·작성자/head/base·경로·실패·96KiB report/64KiB patch·원본 일치 검사는 유지한다.

반환 전 단계의 복사 손상도 피하도록 repair 요청은 같은 Node 프로세스에서 지정 checkout/허용 파일의 `git diff`를 `execFileSync`로 직접 캡처해 보고 객체에 넣고 renderer를 호출하도록 안내한다. 터미널에서 patch를 복사/재작성하지 않는다. read-only 요청에는 이 변경 생성 안내를 넣지 않는 검사도 추가했고 최종693/41 check를 다시 통과했다.

- 최종 `npm run check`: typecheck/lint·unit **693**·policy **41** 성공.
- 준비 중 새 테스트의 TS 좁히기 및 control-regex lint 오류를 수정했다. 검사 비활성화 없이 같은 전체 check를 다시 실행했다.
- 한국어/서로게이트 쌍 patch → ASCII JSON → byte 단위 분할 전달 → 파싱 → 정확한 원본 적용을 검사했다. 기존 정규 JSON도 유지하고 ASCII 표현의 중복/escaped key와 실제 손상 문맥은 계속 거절한다.
- 실제 PR105 API 커밋의 canonical diff를 **로컬 fixture**로 만들었을 때 세 파일 모두 API after와 byte 일치했다(ASCII JSON19088 bytes, decoded patch15263 bytes). 원래 공식 손상 패치는 여전히 거절된다. 이 로컬 fixture는 새로운 공식 봇 응답이나 원격 성공 증거가 아니다.

제품 코드는 이번 전달 수정에서 바꾸지 않아 로컬 build/smoke를 반복하지 않았다. 원격 CI·설치 후 새 Cloud ASCII 결과·전체 무인 C→D 검증은 대기다. #105의 기존 결과를 성공 패치로 바꾸거나 필수 CI/사람 리뷰/권한을 우회하지 않는다.

# MVP 1 — 이력서 기반 텍스트 면접 (향후 승인용 초안)

상태: **미승인·미구현**. 현재 활성 구현은 architecture에 명시된 MVP 0이다. 이 문서를 읽었다고 MVP 1 구현이 승인되지는 않는다.

## 목표와 범위

개인이 PDF/DOCX 이력서를 검토한 뒤 자신의 경험과 근거에 맞는 backend 텍스트 면접을 수행하고 질문·답변을 로컬에서 다시 읽을 수 있다. Java, Spring, DB, API, 성능, infrastructure, architecture, 프로젝트 경험을 다루되 이력서에 없는 경험은 단정하지 않는다. 음성·카메라·아바타·종합 점수·export는 제외한다.

## 요구사항과 인수 기준

| 요구사항 | AC |
| --- | --- |
| 파일 선택·추출·정규화 | PDF/DOCX만 지원; 형식·크기·압축 팽창 한도 검사; 취소는 정상 종료; 손상·암호화·빈 텍스트·OCR 필요 문서는 명시적 안내 |
| 근거 검토 | 프로젝트·경력·기술·역량 추출값에 페이지/구절 또는 DOCX 단락 근거를 연결; 사용자 검토/수정 후만 면접에 사용; 없는 성과·숙련도를 만들지 않음 |
| 텍스트 대화 | resume 근거와 일반 기술 질문을 구분; contextual follow-up; 질문/답변 순서 보장; provider 실패는 재시도 가능한 오류로 표시 |
| 이력 저장 | main 측 로컬 SQLite에 session/question/answer/transcript와 근거 보관; 재시작 복원; 전체/세션 삭제와 데이터 위치 안내 |
| 외부 AI | provider adapter 분리; 실제 전송 범위·인터넷/과금 고지와 사용자 시작 동의; key main 경계 보호; timeout·429·취소 처리 |

파일·추출 text·ZIP 팽창·AI 문맥/요청량의 **구체 한도**, parser/provider/model, 저장소 migration, API 비용 예산, key 저장 실패 시 동작은 구현 전 소유자와 확정한다. source 문서 내 지시문은 prompt injection으로 취급하고 시스템 규칙이나 tool 호출 권한으로 사용하지 않는다. 전체 이력서와 연락처를 기본 전송하지 않는 최소화 정책을 검토한다.

## 검증

- 자동: 합성 PDF/DOCX 정상·손상·암호화·형식 위장·압축 폭탄 한도·한글 fixtures; 근거 누락/허구 방지; fake AI follow-up·timeout·429·취소; SQLite migration·재시작·삭제·실패; IPC 비신뢰 입력·경로·자격증명 노출 부정 테스트.
- Windows 수동: 내려받은 exe에서 파일 선택·취소·한글 추출·검토/수정·동의·텍스트 면접·네트워크 단절·재시작 기록·삭제 확인. 사용자는 로컬 개발/빌드를 하지 않는다.
- 보안: 비신뢰 문서 parser의 권한과 자원 한도, secret OS 보관, 삭제/보존, AI 전송 동의와 redaction, 로그/CI 개인정보 부재를 검토한다. parser·모델의 라이선스도 의존성 추가 전에 확인한다.

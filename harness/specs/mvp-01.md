# MVP 1 — 이력서 기반 텍스트 면접

상태: **로컬 이력서 검토만 승인**. 2026-10-17 KST 사용자가 첫 단계 구현과 권장 처리 한도를 승인했다. 아래 텍스트 면접·DB 저장·외부 AI 요구사항은 이후 승인용 초안이다.

## 현재 승인된 단계와 인수 기준

- 파일 선택 → PDF 페이지/DOCX 본문 단락 추출 → 근거 위치가 붙은 읽기 전용 원문 → 사용자 수정본 → 검토 완료. 수정하면 완료 상태를 해제한다. 없는 경험이나 구조화된 경력 정보를 AI로 만들지 않는다.
- 파일 10MiB, PDF 50페이지, 총 추출 텍스트 100,000자, DOCX 선언/실제 압축 해제 30MiB, ZIP 항목 512개, XML 중첩 128단계, 추출 단락 2,000개, worker 처리 15초. 한도 초과 시 부분 성공 대신 명시적 오류다.
- native dialog에서 사용자가 선택한 한 개만 읽는다. 취소는 정상 동작, 재선택 실패는 기존 검토 내용 유지, 중복 선택 거절, 내용 비우기·화면 이탈은 진행 중 worker와 하위 worker 종료 및 메모리 상태 해제다. 원본 파일은 수정하지 않는다.
- 확장자/실제 서명·DOCX 주 문서 content type·ZIP CRC/길이·XML 형식을 확인한다. 손상·암호화·빈 문서/OCR 필요를 구분한다. PDF 빈 페이지와 읽기 순서/레이아웃의 한계, DOCX 머리글·바닥글·주석 등 미포함을 표시한다.
- PDF.js 6.4.299(Apache-2.0), fflate 0.8.3(MIT), @xmldom/xmldom 0.9.12(MIT)를 고정한다. PDF.js는 renderer bundle 전용 devDependency라 optional native canvas를 앱에 설치하지 않는다. CJK용 Adobe CMaps는 inline bundle에 포함해 외부 fetch가 필요 없고 원문 라이선스를 동봉한다.
- 파서는 sandbox renderer의 전용 Web Worker와 PDF.js 하위 worker에서 동작한다. 네트워크/문서 스크립트/링크/매크로/외부 XML entity를 실행하지 않는다. CSP는 `worker-src self`로 패키지 worker만 허용하고 `connect-src none`을 유지한다. 타임아웃은 CPU 작업을 중단하지만 OS 수준의 별도 메모리 quota는 아니다.
- 원문 bytes·추출값·수정본은 앱 메모리에서만 사용한다. 디스크·DB·로그·AI로 저장/전송하지 않으며 앱 종료/검토 화면 이탈 시 사라진다. 제품 저장·실제 전송 동의는 이 단계에 없다.
- 합성 문서 단위 테스트와 실제 Windows source/packaged Electron smoke로 PDF·한글 CMap·DOCX·취소·수정 상태·오류 후 보존·비우기·화면 이탈·HTML 미실행을 확인한다. 사용자 Windows에서 실제 개인 문서 정확도/파일 선택을 확인하는 수동 검증은 별도로 남긴다.

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

로컬 파일·추출·ZIP·parser 한도는 위와 같이 확정했다. 이후 AI 문맥/요청량, provider/model, 저장소 migration, API 비용 예산, key 저장 실패 시 동작은 해당 단계 구현 전 소유자와 확정한다. source 문서 내 지시문은 prompt injection으로 취급하고 시스템 규칙이나 tool 호출 권한으로 사용하지 않는다. 전체 이력서와 연락처를 기본 전송하지 않는 최소화 정책을 검토한다.

## 검증

- 자동: 합성 PDF/DOCX 정상·손상·암호화·형식 위장·압축 폭탄 한도·한글 fixtures; 근거 누락/허구 방지; fake AI follow-up·timeout·429·취소; SQLite migration·재시작·삭제·실패; IPC 비신뢰 입력·경로·자격증명 노출 부정 테스트.
- Windows 수동: 내려받은 exe에서 파일 선택·취소·한글 추출·검토/수정·동의·텍스트 면접·네트워크 단절·재시작 기록·삭제 확인. 사용자는 로컬 개발/빌드를 하지 않는다.
- 보안: 비신뢰 문서 parser의 권한과 자원 한도, secret OS 보관, 삭제/보존, AI 전송 동의와 redaction, 로그/CI 개인정보 부재를 검토한다. parser·모델의 라이선스도 의존성 추가 전에 확인한다.

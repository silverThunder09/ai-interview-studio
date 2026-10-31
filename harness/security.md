# 보안·개인정보·라이선스 안내

공통 규칙은 [AGENTS.md](../AGENTS.md)와 작업 경로의 지침을 따른다. 이 문서는 상세 기준의 목차다. 작업에 관련된 절만 확인하고 모든 과거 기록을 매번 읽지 않는다. 상세 기준은 코드보다 현재 구현의 증거가 아니며, 변경 시 기존 통제를 유지하고 실제 코드를 확인한다.

| 변경 대상 | 확인할 상세 기준 |
| --- | --- |
| Electron·IPC·CSP·권한 | [위협 모델과 통제](security-details.md#mvp-0-위협-모델과-현재-통제) |
| 이력서 파싱·저장 | [이력서 데이터 흐름](security-details.md#로컬-이력서-검토의-데이터-흐름), [연습·기록](security-details.md#로컬-텍스트-연습기록) |
| AI 공급자·키·외부 전송 | [AI 공급자 경계](security-details.md#ai-공급자-공통-계약과-외부-api-경계) |
| 마이크·전사 | [음성 입력](security-details.md#승인된-음성-입력-첫-단계) |
| 음성 읽기 | [질문 음성 읽기](security-details.md#현재-질문-음성-읽기); Windows 로컬 음성의 실제 범위는 코드와 PR #161을 확인 |
| CI·개발 자동화 | [실행기 경계](security-details.md#개발-이벤트-실행기의-별도-경계), [CI·의존성](security-details.md#ci와-의존성-검토), [자동화 운영](event-loop.md) |
| REA·라이선스·3D 에셋 | [REA 절차](security-details.md#rea-검토와-미래-절차--설치하지-않음), [3D 에셋](security-details.md#3d-모델에셋ux-조사-경계) |

## 실사형 3D 제품 전환의 목표 보안 설계 — 미활성

[목표 설계 상세](security-details.md#실사형-3d-제품-전환의-목표-보안-설계--미활성)는 미래 범위의 검토 기준이며 해당 기능의 구현이나 활성화 증거가 아니다.

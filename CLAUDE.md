# Capybara Onsen — 작업 원칙

## 회귀 방지 (최우선)
- **모든 빌드 완료 전에 ACCEPTANCE.md 전 항목을 검증**하고 PASS/FAIL 표로 보고한다.
- FAIL이 있으면 **완료 보고 금지** — 먼저 고치고 재검증.

## 에셋 원본 보호
- `public/assets/`의 PNG 에셋은 직접 수정 대신 **로드타임 캔버스 청소**로 처리.
- 원본 백업: `backups/` 폴더에 보관.
- 텍스처 정리 파이프라인이 character.js의 `cleanTexture()`에 구현됨.

## 비주얼 자가검증
- 모든 비주얼 수정 후 **브라우저 스크린샷 자가검증** 필수.
- "완료" 보고 전에 실제 화면에서 확인.

## 온천 검증
- **온천 관련 수정 후 `auditOnsens()` 실행** — 콘솔에서 6개 클러스터 전부 OK 확인.
- `window.__shadowDiag()` — 그림자 상태 진단.

## 수정사항 반영 원칙
- 요청된 수정사항은 **빠짐없이 전부 반영**.
- 반영 못 한 항목은 **명시적 보고**.
- 추측 수정 금지 — 원인 확인 후 수정.

## BUILD 버전 마커
- **모든 빌드에 BUILD 버전 마커가 화면에 표시되어야 하며, 완료 보고 시 버전을 올린다.**
- 버전 문자열은 `config.js`의 `BUILD_VERSION` 한 곳에서 관리.
- `ui.js`의 `initBuildMarker()`가 HUD 우상단에 "BUILD vXX" 렌더링.

## 파일 구조
```
src/
  main.js        — 씬 생성, 환경, 이벤트, 애니메이션 루프
  terrain.js     — 지형 (노이즈, 높이맵, 배경 산/숲 레이어)
  character.js   — 캐릭터 컨트롤러 (이동/충돌/facing/온천/말풍선)
  projects.js    — 프로젝트 데이터 배열
  stamps.js      — 도장판 시스템 (HUD/localStorage/연출)
  ui.js          — BUILD 버전 마커 등 UI 유틸
  palette.js     — 색상 팔레트 참조 (P 객체, 낮/밤 프리셋)
  config.js      — 튜닝값 (속도, 카메라, 지형, 그림자, 배경, BUILD_VERSION)
  style.css      — HUD/UI 스타일
public/assets/
  capybara.png       — 정면 스프라이트
  capybara-back.png  — 뒷면 스프라이트
backups/             — 원본 에셋 백업
```

## 기술 스택
- Three.js (r185) + Vite
- 무광 툰 셰이딩 (MeshToonMaterial), 카피바라 스프라이트 기준
- 포스트프로세싱: RenderPixelatedPass (PIXEL_SIZE=1)
- 입력: e.code 기반 (한글 IME 호환)

## 튜닝값 위치
- 캐릭터 속도/가속: `config.js` 또는 `character.js` 상단 상수
- 색상: `palette.js` 또는 `main.js`의 P 객체
- 낮/밤 프리셋: `main.js`의 DAY/NOON 객체
- 풀/소품 개수: `main.js`의 createVegetation/createOnsenProps 내

## 디버그 유틸
- `window.__toggleRays(bool)` — 빛줄기 토글
- `window.__teleport(x, z)` — 카피바라 텔레포트
- `window.resetStamps()` — 도장 초기화
- `C` 키 — 콜라이더 디버그 시각화

## 핵심 동작 체크리스트 (큰 수정 후 확인)
- [ ] WASD/화살표/SPACE 이동·점프 (한글 IME)
- [ ] 페이싱: 이동→뒷모습, S키/대기→정면, 온천→정면 고정
- [ ] 온천: 잠김, 김, 나올 때 복귀
- [ ] 충돌: 바위/석등/게이트 막힘, 온천 통과
- [ ] 게이트 ENTER/클릭 → 팝업, ESC 닫기
- [ ] 도장판: 획득, localStorage, 리셋, 컴플리트
- [ ] 낮/밤: 전환, 석등 점등/소등
- [ ] 말풍선: 랜덤 대사, 가이드 툴팁

## 프로젝트 추가 방법
1. `src/projects.js`의 배열에 새 객체 추가:
   ```js
   { id: 'myproject', name: 'MY PROJECT', description: '설명', tags: ['Tag'], link: '#', position: [x, 0, z] }
   ```
2. 저장하면 자동으로 온천 게이트 + 현판 + 콜라이더 + 도장 칸 생성.

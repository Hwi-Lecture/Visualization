# 시각화페이지 프로젝트 가이드

강의용 인터랙티브 시각화 자료 모음. GitHub Pages(https://hwi-lecture.github.io/Visualization/)로 배포.
정해진 커리큘럼 없이 필요할 때마다 시각화 페이지를 하나씩 추가해 나가는 방식.

## 원칙

- 빌드 과정 없음. 순수 HTML/CSS/JS + CDN 라이브러리만 사용 (GitHub Pages에 바로 push해서 확인 가능해야 함)
- React 등 프레임워크, 번들러 도입하지 않음 — 페이지가 서로 독립적이라 오히려 방해됨
- 새 시각화를 추가해도 기존 페이지나 메인 페이지 코드를 거의 건드리지 않는 구조 유지

## 폴더 구조

```
/
├── index.html              메인 허브. viz.json을 읽어 카드 그리드 자동 렌더링
├── viz.json                등록된 시각화 목록 (title, description, path)
├── common/
│   ├── style.css           공통 스타일 (색상, 카드, 네비게이션)
│   └── nav.js               각 viz 페이지 상단에 "메인으로" 버튼 삽입
├── viz/
│   ├── _template/           새 페이지 만들 때 복붙할 뼈대
│   ├── loss-optimization/   예: loss landscape / gradient descent 시각화
│   ├── attention/           예: transformer attention 시각화
│   └── (하나씩 추가)
```

## 새 시각화 페이지 추가하는 법

1. `viz/_template/`을 `viz/<새-이름>/`으로 복사
2. 해당 폴더 안에서 내용 작성 (index.html, script.js)
3. `viz.json`에 항목 추가 (category, title, description, path)
4. 메인 `index.html`은 건드릴 필요 없음 — viz.json 기반으로 카드 자동 생성됨

### category 규칙

- 메인 페이지는 `category`가 같은 것끼리 묶어서 섹션으로 보여준다.
- 섹션 순서와 섹션 안 카드 순서는 **viz.json에 적은 순서 그대로**다. 강의 순서대로 적으면 된다.
- 같은 주제의 여러 페이지는 반드시 같은 문자열을 쓸 것 (오타 나면 섹션이 갈라진다).
- `category`를 빼면 "기타"로 묶인다. 카테고리가 하나뿐이면 섹션 제목 없이 그리드만 나온다.
- 현재 쓰는 값: `LLM 기초`, `RAG`

## 사용 라이브러리 (전부 CDN)

- **D3.js**: attention heatmap, 그래프/네트워크 형태 시각화
- **Plotly.js**: loss landscape 등 3D surface, 등고선, 인터랙티브 회전/줌. gradient descent 경로 애니메이션에 적합
- **KaTeX**: 페이지 내 수식 렌더링 (loss function, attention score 식 등 설명용)
- **Three.js**: 기본 세트에는 포함하지 않음. Plotly로 부족한 커스텀 3D 인터랙션이 필요한 페이지에서만 개별 도입

## 커밋/배포

- 저장소: https://github.com/Hwi-Lecture/Visualization.git
- 로컬 브랜치: main
- push는 사용자가 직접 진행 (`git push`)
- Pages 설정: Settings > Pages > Branch: main / (root)

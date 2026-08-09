/*
 * 임베딩 · 색인 페이지.
 *
 * 청킹 페이지에서 만든 청크를 그대로 받아, 같은 청크가 두 가지 색인으로
 * 어떻게 변하는지 나란히 보여준다. 핵심 장면은 "격자 모양의 차이" —
 * 희소(sparse)와 밀집(dense)이라는 이름이 왜 그렇게 붙었는지가 한눈에 보인다.
 */

const GRID_CELLS = 300;      // 화면에 그리는 어휘 격자 칸 수 (실제 어휘는 훨씬 크다)
const FAKE_VOCAB = 30000;    // 설명용 어휘 크기
const FAKE_DIM = 768;        // 설명용 임베딩 차원
const TERM_ROWS = 40;        // 역색인 표에 보여줄 단어 수

const DOC_COLOR = {
  d1: "#2a78d6",
  d2: "#eb6834",
  d3: "#3f9a6d",
  d4: "#8f5fc4"
};

const el = {
  inherit: document.getElementById("inherit"),
  chunkSelect: document.getElementById("chunk-select"),
  sparseGrid: document.getElementById("sparse-grid"),
  sparseCaption: document.getElementById("sparse-caption"),
  denseGrid: document.getElementById("dense-grid"),
  denseCaption: document.getElementById("dense-caption"),
  axisBars: document.getElementById("axis-bars"),
  indexTable: document.getElementById("index-table"),
  map: document.getElementById("map"),
  mapLegend: document.getElementById("map-legend"),
  compareBody: document.getElementById("compare-body")
};

const settings = ragLoadSettings();
const chunks = ragBuildChunks(settings.size, settings.overlap, settings.mode);
const bm = ragBuildBm25(chunks);

const state = {
  chunkIndex: 0,
  selectedTerm: null
};

// 청크마다 벡터와 지도 좌표를 미리 구해 둔다 (그릴 때마다 다시 계산할 이유가 없다)
const points = chunks.map((c, i) => {
  const e = ragEmbed(c.text);
  const p = ragProject2d(e.vec);
  return { chunk: c, index: i, vec: e.vec, hits: e.hits, x: p.x, y: p.y };
});

// ── 그리기 ─────────────────────────────────────────────────────

function render() {
  renderInherit();
  renderVectors();
  renderIndexTable();
  renderMap();
  renderCompare();
}

function renderInherit() {
  const s = settings;
  const label = RAG_MODE_LABEL[s.mode];
  const lead = s.inherited
    ? "청킹 페이지에서 설정한 값을 이어받았습니다"
    : "기본 청킹 설정으로 계산했습니다";
  const detail = s.mode === "paragraph"
    ? `<strong>${label}</strong>`
    : `<strong>${label} · ${s.size}자 · 겹침 ${s.overlap}자</strong>`;
  el.inherit.innerHTML =
    `${lead} — ${detail} → 문서 ${RAG_DOCS.length}개가 <strong>청크 ${chunks.length}개</strong>로 나뉘었습니다. ` +
    `<a href="../rag-chunking/index.html">청킹 페이지에서 바꾸기</a>`;
}

function renderVectors() {
  const p = points[state.chunkIndex];
  const tokens = ragTokenize(p.chunk.text);
  const uniq = [...new Set(tokens)];

  // ── Sparse 격자: 단어를 어휘 사전의 한 자리에 대응시킨다.
  // 실제 사전 순서를 흉내 내려고 단어 해시로 칸을 정한다 (매번 같은 자리에 찍히도록).
  const slot = new Map();
  for (const t of uniq) {
    let at = hashCode(t) % GRID_CELLS;
    while (slot.has(at)) at = (at + 1) % GRID_CELLS;   // 칸이 겹치면 옆으로 밀어 둔다
    slot.set(at, t);
  }

  let sparseHtml = "";
  for (let i = 0; i < GRID_CELLS; i++) {
    const t = slot.get(i);
    sparseHtml += t
      ? `<i class="on" title="${escapeHtml(t)} — ${countIn(tokens, t)}번 등장"></i>`
      : `<i></i>`;
  }
  el.sparseGrid.innerHTML = sparseHtml;

  const zeroPct = (100 * (FAKE_VOCAB - uniq.length) / FAKE_VOCAB).toFixed(2);
  el.sparseCaption.innerHTML =
    `어휘 ${FAKE_VOCAB.toLocaleString()}칸 중 <b>${uniq.length}칸</b>만 켜짐 · 나머지 ${zeroPct}%는 0`;

  // ── Dense 격자: 모양(빈칸이 없다)을 보여주기 위한 예시 그림.
  // 이 청크의 6차원 벡터를 씨앗으로 삼아 항상 같은 무늬가 나오게 만든다.
  const seed = Math.floor(Math.abs(p.vec.reduce((s, v, i) => s + v * (i + 3) * 977, 0)) * 1000) + state.chunkIndex + 1;
  let denseHtml = "";
  for (let i = 0; i < GRID_CELLS; i++) {
    const v = pseudoRandom(seed + i * 31);
    // 0에 가까운 칸이 하나도 없다는 게 요점이므로 최소 명도를 확보한다
    const alpha = (0.22 + 0.78 * v).toFixed(2);
    denseHtml += `<i style="opacity:${alpha}"></i>`;
  }
  el.denseGrid.innerHTML = denseHtml;
  el.denseCaption.innerHTML = `<b>${FAKE_DIM}칸</b> 전부 채워짐 · 0인 칸 없음`;

  // ── 실제로 쓰는 6축
  el.axisBars.innerHTML = RAG_AXES.map((name, i) => {
    const v = p.vec[i];
    return `
      <div class="axis-row">
        <span class="name">${escapeHtml(name)}</span>
        <span class="track"><span class="fill" style="width:${(Math.abs(v) * 100).toFixed(1)}%"></span></span>
        <span class="val">${v.toFixed(2)}</span>
      </div>`;
  }).join("");
}

function renderIndexTable() {
  // 여러 청크에 걸쳐 나오는 단어가 위로 오게 정렬한다 — 역색인이 뭔지 보여주기 좋다.
  // 다만 "있습니다" 같은 기능어가 상위를 채우면 표가 아무 의미 없어 보이므로 걸러 낸다.
  // (점수 계산에는 그대로 쓰인다. 여기서 거르는 건 화면 표시뿐이다.)
  const terms = [...bm.df.entries()]
    .filter(([t]) => t.length >= 2 && !isFunctionWord(t))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TERM_ROWS);

  el.indexTable.innerHTML = terms.map(([t, n]) => {
    const postings = [];
    for (let i = 0; i < chunks.length; i++) {
      if (bm.docTokens[i].includes(t)) postings.push(i + 1);
    }
    const sel = state.selectedTerm === t ? " sel" : "";
    return `
      <div class="index-row${sel}" data-term="${escapeHtml(t)}" role="button" tabindex="0">
        <span class="term">${escapeHtml(t)}</span>
        <span class="posting">→ 청크 ${postings.join(", ")}번 <span style="opacity:0.6">(${n}개)</span></span>
      </div>`;
  }).join("");
}

function renderMap() {
  const W = 400, H = 340, pad = 46;

  // 좌표 범위를 데이터에 맞춰 잡는다
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const minX = Math.min(...xs, -0.2), maxX = Math.max(...xs, 0.2);
  const minY = Math.min(...ys, -0.2), maxY = Math.max(...ys, 0.2);
  const sx = v => pad + (v - minX) / (maxX - minX || 1) * (W - pad * 2);
  const sy = v => H - pad - (v - minY) / (maxY - minY || 1) * (H - pad * 2);

  const selected = state.selectedTerm;

  let svg = `<rect class="frame" x="1" y="1" width="${W - 2}" height="${H - 2}" rx="8"/>`;

  // 개념 축 방향을 옅게 표시해 두면 "이쪽은 배터리 얘기"라는 감이 잡힌다
  const cx = sx(0), cy = sy(0);
  RAG_AXES.forEach((name, i) => {
    const unit = new Array(RAG_AXES.length).fill(0);
    unit[i] = 1;
    const p = ragProject2d(unit);
    svg += `<line x1="${cx}" y1="${cy}" x2="${sx(p.x * 0.86)}" y2="${sy(p.y * 0.86)}" stroke="#efeee8" stroke-width="1"/>`;
    // 축 이름은 점보다 뒤에 깔리므로 흰 테두리를 둘러 글자가 묻히지 않게 한다
    svg += `<text class="axis-lbl" x="${sx(p.x * 1.1)}" y="${sy(p.y * 1.1)}" text-anchor="middle"
              stroke="#ffffff" stroke-width="3" paint-order="stroke">${escapeHtml(name.split("/")[0])}</text>`;
  });

  for (const p of points) {
    const jit = jitterFor(p.index);
    const x = sx(p.x) + jit.x;
    const y = sy(p.y) + jit.y;
    const hasTerm = selected ? bm.docTokens[p.index].includes(selected) : false;
    const dim = selected && !hasTerm;
    const isCurrent = p.index === state.chunkIndex;
    const r = hasTerm || isCurrent ? 8 : 5.5;

    svg += `<circle class="dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}"
              fill="${DOC_COLOR[p.chunk.docId]}" opacity="${dim ? 0.18 : 0.85}"
              stroke="${isCurrent ? "#1a1a1a" : "none"}" stroke-width="${isCurrent ? 1.6 : 0}">
              <title>청크 ${p.index + 1}번 — ${escapeHtml(p.chunk.docTitle)}</title>
            </circle>`;
    svg += `<text class="lbl" x="${x.toFixed(1)}" y="${(y - r - 3).toFixed(1)}" text-anchor="middle"
              opacity="${dim ? 0.2 : 1}" stroke="#ffffff" stroke-width="2.5" paint-order="stroke">${p.index + 1}</text>`;
  }

  el.map.innerHTML = svg;

  el.mapLegend.innerHTML = RAG_DOCS.map(d =>
    `<span><i style="background:${DOC_COLOR[d.id]}"></i>${escapeHtml(d.title)}</span>`
  ).join("") + (selected
    ? `<span style="color:var(--text)">'${escapeHtml(selected)}'이(가) 든 청크만 크게 표시</span>` : "");
}

function renderCompare() {
  const rows = [
    ["칸 수 (차원)", `어휘 크기만큼 — 보통 수만 칸`, `모델이 정한 수 — 보통 384~1536칸`],
    ["채워진 칸", `청크에 등장한 단어 자리만 (거의 전부 0)`, `전부 채워짐 (0인 칸이 없음)`],
    ["칸의 의미", `단어 하나. 사람이 읽을 수 있음`, `이름 없는 숫자. 사람은 못 읽음`],
    ["저장 방식", `역색인 — 단어마다 등장 청크 목록`, `벡터 DB — 가까운 이웃을 찾는 자료구조`],
    ["새 문서 추가", `해당 단어 목록에 끼워 넣으면 끝. 가벼움`, `임베딩 모델을 다시 돌려야 함. 무거움`],
    ["잘 찾는 것", `고유명사, 제품 코드, 숫자, 드문 단어`, `같은 뜻 다른 표현, 의역된 질문`],
    ["못 찾는 것", `단어가 다르면 뜻이 같아도 못 찾음`, `학습에 없던 신조어·모델명은 구분 못 함`]
  ];
  el.compareBody.innerHTML = rows.map(([label, a, b]) =>
    `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(a)}</td><td>${escapeHtml(b)}</td></tr>`
  ).join("");
}

// ── 컨트롤 ─────────────────────────────────────────────────────

el.chunkSelect.innerHTML = chunks.map((c, i) =>
  `<option value="${i}">청크 ${i + 1}번 — ${escapeHtml(c.docTitle)} (${c.text.slice(0, 18).replace(/\n/g, " ")}…)</option>`
).join("");

el.chunkSelect.addEventListener("change", () => {
  state.chunkIndex = Number(el.chunkSelect.value);
  renderVectors();
  renderMap();
});

el.indexTable.addEventListener("click", e => {
  const row = e.target.closest(".index-row");
  if (!row) return;
  selectTerm(row.dataset.term);
});

el.indexTable.addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const row = e.target.closest(".index-row");
  if (!row) return;
  e.preventDefault();
  selectTerm(row.dataset.term);
});

function selectTerm(term) {
  // 같은 단어를 다시 누르면 선택 해제
  state.selectedTerm = state.selectedTerm === term ? null : term;
  renderIndexTable();
  renderMap();
}

// ── 유틸 ───────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// 역색인 표에 띄우기 민망한 기능어·활용형. 내용어만 남겨야 표가 설명이 된다.
const FUNCTION_WORDS = new Set([
  "있습니다", "됩니다", "입니다", "합니다", "주십시오", "때문", "경우", "것이", "것은", "수도",
  "있으니", "있는", "있어야", "있고", "없습니다", "없이", "다시", "모두", "가장", "계속",
  "그대로", "따라", "위해", "대부분", "이나", "또는", "함께", "다만", "정도", "이상",
  "하면", "하지", "해도", "라면", "이런", "그런", "저런", "이것", "번째", "위에",
  "올려", "낮추", "높은", "많은", "적은", "쓰는", "쓰면", "보시", "보면", "받으신",
  "단계", "상태", "방식", "확인", "안내", "가능", "필요", "사용", "제품", "기준"
]);

function isFunctionWord(t) {
  if (FUNCTION_WORDS.has(t)) return true;
  // 종결어미가 붙어 남은 활용형들 (조사 제거만으로는 안 걸러진다)
  return /(습니다|입니다|합니다|십시오|하는|하고|해서|되어|되는|지고|이며|으며|이고)$/.test(t);
}

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// 같은 입력이면 항상 같은 값 — 새로고침할 때마다 무늬가 바뀌면 설명이 흔들린다
function pseudoRandom(n) {
  const x = Math.sin(n) * 43758.5453;
  return x - Math.floor(x);
}

function countIn(arr, t) {
  let n = 0;
  for (const x of arr) if (x === t) n++;
  return n;
}

// 개념이 똑같은 청크는 좌표도 똑같아 완전히 겹친다. 조금씩 흩어 놓아야 셀 수 있다.
function jitterFor(i) {
  const a = pseudoRandom(i * 7.13) * Math.PI * 2;
  const r = 7 + pseudoRandom(i * 3.71) * 11;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

// ── 초기화 ─────────────────────────────────────────────────────

render();

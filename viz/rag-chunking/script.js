/*
 * 청킹 페이지.
 *
 * 수강생이 올린 문서마다 섹션 하나. 한 가지 설정(방식·크기·겹침)을 모든 문서에 동시에 적용하고,
 * 잘린 결과를 청크 카드 그리드로 펼쳐 보여준다. 카드를 순서대로 읽으면 원문이 그대로 이어지고,
 * 앞뒤 청크와 겹치는 글자는 빗금으로 칠해 "두 번 저장되는 부분"이 눈에 띄게 한다.
 */

// 청크가 수백 개인 문서는 카드를 한꺼번에 다 그리면 슬라이더가 버벅인다. 처음엔 이만큼만 그린다.
const GRID_STEP = 60;

const el = {
  upload: document.getElementById("upload"),
  fileInput: document.getElementById("file-input"),
  modeGroup: document.getElementById("mode-group"),
  size: document.getElementById("size"),
  sizeValue: document.getElementById("size-value"),
  overlap: document.getElementById("overlap"),
  overlapValue: document.getElementById("overlap-value"),
  reset: document.getElementById("btn-reset"),
  modeNote: document.getElementById("mode-note"),
  docs: document.getElementById("docs")
};

const state = {
  size: RAG_CHUNK_DEFAULTS.size,
  overlap: RAG_CHUNK_DEFAULTS.overlap,
  mode: RAG_CHUNK_DEFAULTS.mode,
  // 각 문서: { id, title, kind, text, status: "ready"|"loading"|"error", error, shown }
  docs: []
};

let uploadSeq = 0;

// ── 계산 ───────────────────────────────────────────────────────

function chunksOf(doc) {
  return ragChunkDoc(doc, state.size, state.overlap, state.mode);
}

// ── 그리기 ─────────────────────────────────────────────────────

let renderQueued = false;

// 슬라이더를 끌면 input 이벤트가 쏟아진다. 한 프레임에 한 번만 다시 그린다.
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function render() {
  renderControls();
  renderDocs();
}

function renderControls() {
  el.size.value = state.size;
  el.overlap.value = state.overlap;
  el.sizeValue.textContent = `${state.size}자`;
  el.overlapValue.textContent = `${state.overlap}자`;

  // 문단 경계 모드에서는 크기·겹침이 의미가 없다. 비활성화해서 오해를 막는다.
  const byParagraph = state.mode === "paragraph";
  el.overlap.disabled = byParagraph;
  el.size.disabled = byParagraph;

  for (const b of el.modeGroup.querySelectorAll("button")) {
    b.classList.toggle("primary", b.dataset.mode === state.mode);
  }

  let msg;
  if (state.mode === "paragraph") msg = "빈 줄을 기준으로 문단을 그대로 씁니다. 문단 길이가 들쭉날쭉하면 청크 길이도 들쭉날쭉해집니다.";
  else if (state.mode === "sentence") msg = "문장은 절대 쪼개지 않고 크기를 넘기기 직전까지 담습니다. 겹침도 문장 단위라, 되가져올 만큼 짧은 문장이 없으면 겹치는 구간이 안 생기기도 합니다.";
  else if (state.size <= 160) msg = "청크가 너무 짧습니다 — 조각만 봐서는 무슨 얘기인지 알기 어려워집니다.";
  else if (state.size >= 1000) msg = "청크가 큽니다 — 관계없는 내용이 함께 딸려 오고, LLM에 넣는 값도 비싸집니다.";
  else msg = "글자 수만 세고 자릅니다. 가장 흔한 방식이고, 가장 쉽게 문장을 두 동강 냅니다.";
  el.modeNote.textContent = msg;
}

// 섹션 뼈대는 문서마다 한 번만 만들고, 설정이 바뀌면 안쪽만 다시 채운다.
const docEls = new Map();

function renderDocs() {
  for (const [id, node] of docEls) {
    if (!state.docs.some(d => d.id === id)) { node.remove(); docEls.delete(id); }
  }

  el.docs.querySelector(".empty")?.remove();
  for (const doc of state.docs) {
    let sec = docEls.get(doc.id);
    if (!sec) { sec = createSection(doc); docEls.set(doc.id, sec); }
    el.docs.appendChild(sec);   // 이미 있으면 순서만 맞춰진다
    fillSection(sec, doc);
  }

  if (!state.docs.length) {
    el.docs.insertAdjacentHTML("beforeend",
      '<div class="empty">위에 문서를 올리면 여기에 잘린 결과가 나타납니다.</div>');
  }
}

const KIND_LABEL = { pdf: "PDF", docx: "Word", text: "텍스트", other: "파일" };

function createSection(doc) {
  const sec = document.createElement("section");
  sec.className = "doc";
  sec.dataset.id = doc.id;
  sec.innerHTML = `
    <div class="doc-head">
      <h3>${escapeHtml(doc.title)}</h3>
      <span class="badge ${doc.kind}">${KIND_LABEL[doc.kind] || ""}</span>
      <span class="spacer"></span>
      <button class="close" title="이 문서 빼기" aria-label="이 문서 빼기">✕</button>
    </div>
    <div class="doc-meta"></div>
    <div class="doc-body"></div>`;

  sec.querySelector(".close").addEventListener("click", () => {
    state.docs = state.docs.filter(d => d.id !== doc.id);
    render();
  });

  wireSectionEvents(sec);
  return sec;
}

function fillSection(sec, doc) {
  const meta = sec.querySelector(".doc-meta");
  const body = sec.querySelector(".doc-body");
  delete sec.dataset.hl;   // 다시 그리면 강조가 지워지므로 기억해 둔 값도 비운다

  if (doc.status === "loading") {
    meta.textContent = "";
    body.innerHTML = '<div class="status">문서에서 글자를 읽는 중…</div>';
    return;
  }
  if (doc.status === "error") {
    meta.textContent = "";
    body.innerHTML = `<div class="status error">${escapeHtml(doc.error)}</div>`;
    return;
  }

  const text = doc.text;
  const chunks = chunksOf(doc);
  const lens = chunks.map(c => c.end - c.start);
  const total = lens.reduce((a, b) => a + b, 0);
  const avg = Math.round(total / Math.max(1, lens.length));
  // 겹침 때문에 청크 길이의 합이 원문보다 길어진다 — 그만큼 더 저장해야 한다는 뜻
  const extra = text.length ? Math.round((total / text.length - 1) * 100) : 0;

  meta.textContent = `원문 ${text.length.toLocaleString()}자` +
    (extra > 0 ? ` · 겹침 때문에 ${extra}% 더 저장` : "");

  if (!body.querySelector(".chunk-grid")) {
    body.innerHTML = `
      <div class="doc-stats"></div>
      <div class="bar" role="img"></div>
      <div class="bar-axis"><span>0</span><span class="axis-end"></span></div>
      <div class="chunk-grid"></div>
      <div class="grid-foot"></div>`;
  }

  body.querySelector(".doc-stats").innerHTML = `
    <div><div class="label">청크 수</div><div class="value">${chunks.length.toLocaleString()}</div></div>
    <div><div class="label">평균</div><div class="value">${avg}<small>자</small></div></div>
    <div><div class="label">가장 짧은</div><div class="value">${Math.min(...lens)}<small>자</small></div></div>
    <div><div class="label">가장 긴</div><div class="value">${Math.max(...lens)}<small>자</small></div></div>`;

  renderBar(body.querySelector(".bar"), text.length, chunks);
  body.querySelector(".bar").setAttribute("aria-label", `문서 전체를 ${chunks.length}개 청크로 나눈 막대`);
  body.querySelector(".axis-end").textContent = `${text.length.toLocaleString()}자`;

  const shown = Math.min(chunks.length, doc.shown || GRID_STEP);
  renderChunkGrid(body.querySelector(".chunk-grid"), chunks, shown);

  const rest = chunks.length - shown;
  body.querySelector(".grid-foot").innerHTML = rest > 0
    ? `<button class="card-btn" data-act="more">${Math.min(rest, GRID_STEP)}개 더 보기</button>
       <button class="card-btn" data-act="all">전부 보기</button>
       <span class="note">${shown.toLocaleString()} / ${chunks.length.toLocaleString()}개 표시 중</span>`
    : "";
}

function renderBar(bar, len, chunks) {
  const pct = v => (v / Math.max(1, len) * 100).toFixed(3);
  bar.innerHTML = chunks.map((c, i) =>
    `<div class="blk c${i % 2}" data-k="${i}" style="left:${pct(c.start)}%;width:${pct(c.end - c.start)}%"
      title="청크 ${i + 1}번 · ${c.end - c.start}자"></div>`).join("");
}

function renderChunkGrid(grid, chunks, shown) {
  const cards = [];
  for (let i = 0; i < shown; i++) {
    const c = chunks[i];
    const prev = chunks[i - 1];
    const next = chunks[i + 1];

    // 이 청크 안에서 앞 청크와 겹치는 머리, 뒤 청크와 겹치는 꼬리 (원문 위치 기준)
    const headEnd = prev && prev.end > c.start ? Math.min(prev.end, c.end) : c.start;
    const tailStart = next && next.start < c.end ? Math.max(next.start, headEnd) : c.end;

    const piece = (a, b) => escapeHtml(c.text.slice(a - c.start, b - c.start));
    let body = "";
    if (headEnd > c.start) body += `<span class="ov" title="${i}번 청크에도 들어 있는 부분">${piece(c.start, headEnd)}</span>`;
    body += piece(headEnd, tailStart);
    if (tailStart < c.end) body += `<span class="ov" title="${i + 2}번 청크에도 들어 있는 부분">${piece(tailStart, c.end)}</span>`;

    cards.push(`
      <div class="chunk-card c${i % 2}" data-k="${i}">
        <div class="chunk-head">
          <b>청크 ${i + 1}</b>
          <span>${(c.end - c.start).toLocaleString()}자</span>
        </div>
        <div class="body">${body}</div>
      </div>`);
  }
  grid.innerHTML = cards.join("");
}

// ── 섹션 안 상호작용: 막대 칸 ↔ 청크 카드를 같은 번호로 묶는다 ──────────

function wireSectionEvents(sec) {
  const docOf = () => state.docs.find(d => d.id === sec.dataset.id);

  sec.addEventListener("mouseover", e => {
    const hit = e.target.closest(".bar .blk, .chunk-card");
    if (hit) highlight(sec, Number(hit.dataset.k));
  });

  sec.addEventListener("mouseleave", () => highlight(sec, null));

  sec.addEventListener("click", e => {
    const btn = e.target.closest(".card-btn");
    if (btn) {
      const doc = docOf();
      const count = chunksOf(doc).length;
      if (btn.dataset.act === "more") doc.shown = (doc.shown || GRID_STEP) + GRID_STEP;
      if (btn.dataset.act === "all") doc.shown = count;
      fillSection(sec, doc);
      return;
    }

    // 막대의 칸을 누르면 그 청크 카드로 이동한다
    const blk = e.target.closest(".bar .blk");
    if (!blk) return;
    const k = Number(blk.dataset.k);
    const doc = docOf();
    if (k >= (doc.shown || GRID_STEP)) {
      doc.shown = Math.ceil((k + 1) / GRID_STEP) * GRID_STEP;   // 아직 안 그린 카드면 거기까지 펼친다
      fillSection(sec, doc);
    }
    highlight(sec, k);
    sec.querySelector(`.chunk-card[data-k="${k}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}

function highlight(sec, k) {
  if (sec.dataset.hl === String(k)) return;
  sec.dataset.hl = String(k);
  for (const b of sec.querySelectorAll(".bar .blk.hl, .chunk-card.hl")) b.classList.remove("hl");
  if (k === null) return;
  sec.querySelector(`.bar .blk[data-k="${k}"]`)?.classList.add("hl");
  sec.querySelector(`.chunk-card[data-k="${k}"]`)?.classList.add("hl");
}

// ── 업로드 ─────────────────────────────────────────────────────

async function addFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;

  const added = files.map(file => {
    const doc = {
      id: `u${++uploadSeq}`,
      title: file.name,
      kind: fileKind(file) || "other",
      text: "",
      status: "loading"
    };
    state.docs.push(doc);
    return { file, doc };
  });
  render();
  docEls.get(added[0].doc.id)?.scrollIntoView({ behavior: "smooth", block: "nearest" });

  await Promise.all(added.map(async ({ file, doc }) => {
    try {
      doc.text = await extractText(file);
      doc.status = "ready";
    } catch (err) {
      doc.status = "error";
      doc.error = err && err.message ? err.message : "문서를 읽지 못했습니다.";
    }
    // 그 사이 사용자가 문서를 지웠을 수도 있다
    const sec = docEls.get(doc.id);
    if (sec && state.docs.includes(doc)) fillSection(sec, doc);
  }));
}

el.fileInput.addEventListener("change", () => {
  addFiles(el.fileInput.files);
  el.fileInput.value = "";   // 같은 파일을 다시 골라도 change가 일어나게
});

for (const type of ["dragenter", "dragover"]) {
  el.upload.addEventListener(type, e => { e.preventDefault(); el.upload.classList.add("drag"); });
}
el.upload.addEventListener("dragleave", e => {
  if (!el.upload.contains(e.relatedTarget)) el.upload.classList.remove("drag");
});
el.upload.addEventListener("drop", e => {
  e.preventDefault();
  el.upload.classList.remove("drag");
  addFiles(e.dataTransfer.files);
});

// 업로드 상자 밖에 떨어뜨려도 브라우저가 파일을 열어 버리지 않게 막는다
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("drop", e => {
  e.preventDefault();
  if (!el.upload.contains(e.target)) addFiles(e.dataTransfer.files);
});

// ── 컨트롤 ─────────────────────────────────────────────────────

el.size.addEventListener("input", () => {
  state.size = Number(el.size.value);
  // 겹침이 청크 크기보다 크면 앞으로 나아가질 못한다. 항상 크기보다 작게 눌러 둔다.
  if (state.overlap >= state.size) state.overlap = Math.max(0, state.size - 20);
  scheduleRender();
});

el.overlap.addEventListener("input", () => {
  state.overlap = Math.min(Number(el.overlap.value), state.size - 20);
  scheduleRender();
});

el.modeGroup.addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b) return;
  state.mode = b.dataset.mode;
  render();
});

el.reset.addEventListener("click", () => {
  state.size = RAG_CHUNK_DEFAULTS.size;
  state.overlap = RAG_CHUNK_DEFAULTS.overlap;
  state.mode = RAG_CHUNK_DEFAULTS.mode;
  render();
});

// ── 유틸 ───────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ── 초기화 ─────────────────────────────────────────────────────

render();

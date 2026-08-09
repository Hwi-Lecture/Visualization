/*
 * 청킹 페이지.
 *
 * 원문 위에 청크 경계를 직접 칠해서 "어디서 잘리는가"를 보여주는 것이 전부다.
 * 핵심 장면은 q4("환불은 언제까지 신청해요?")의 정답 문장이 기본 설정에서
 * 두 청크로 갈라지는 순간 — 뒤 단계가 아무리 좋아도 답이 안 나오는 이유다.
 */

const ANSWER_QUERY = RAG_QUERIES.find(q => q.id === "q4");
const ANSWER_DOC_ID = ANSWER_QUERY.answerDoc;

const el = {
  docSelect: document.getElementById("doc-select"),
  modeGroup: document.getElementById("mode-group"),
  size: document.getElementById("size"),
  sizeValue: document.getElementById("size-value"),
  overlap: document.getElementById("overlap"),
  overlapValue: document.getElementById("overlap-value"),
  reset: document.getElementById("btn-reset"),
  verdict: document.getElementById("verdict"),
  source: document.getElementById("source"),
  chunks: document.getElementById("chunks"),
  count: document.getElementById("stat-count"),
  avg: document.getElementById("stat-avg"),
  min: document.getElementById("stat-min"),
  tradeoff: document.getElementById("tradeoff")
};

const saved = ragLoadSettings();
const state = {
  docId: ANSWER_DOC_ID,   // 핵심 장면이 있는 문서에서 시작한다
  size: saved.size,
  overlap: saved.overlap,
  mode: saved.mode
};

// ── 계산 ───────────────────────────────────────────────────────

function currentDoc() {
  return RAG_DOCS.find(d => d.id === state.docId);
}

function currentChunks(doc) {
  return ragChunkDoc(doc || currentDoc(), state.size, state.overlap, state.mode);
}

// 정답 문장이 어느 한 청크 안에 온전히 들어갔는지 판정한다.
function checkAnswerSurvives() {
  const doc = RAG_DOCS.find(d => d.id === ANSWER_DOC_ID);
  const at = doc.text.indexOf(RAG_ANSWER_SENTENCE);
  if (at === -1) return { ok: true, at: -1 };
  const end = at + RAG_ANSWER_SENTENCE.length;
  const chunks = ragChunkDoc(doc, state.size, state.overlap, state.mode);
  const holder = chunks.find(c => c.start <= at && c.end >= end);
  return { ok: !!holder, at, end, holder, chunks };
}

// 원문을 "겹치지 않는 구간"들로 쪼갠다. 각 구간이 어떤 청크에 속하는지 함께 들고 있어야
// 겹치는 부분(청크 2개가 동시에 덮는 곳)을 따로 칠할 수 있다.
function buildSegments(text, chunks, answerRange) {
  const cuts = new Set([0, text.length]);
  for (const c of chunks) { cuts.add(c.start); cuts.add(c.end); }
  if (answerRange) { cuts.add(answerRange[0]); cuts.add(answerRange[1]); }

  const points = [...cuts].filter(p => p >= 0 && p <= text.length).sort((a, b) => a - b);
  const segs = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    if (end <= start) continue;
    const owners = [];
    for (let k = 0; k < chunks.length; k++) {
      if (chunks[k].start <= start && chunks[k].end >= end) owners.push(k);
    }
    const inAnswer = answerRange && start >= answerRange[0] && end <= answerRange[1];
    segs.push({ start, end, owners, inAnswer });
  }
  return segs;
}

// ── 그리기 ─────────────────────────────────────────────────────

function render() {
  const doc = currentDoc();
  const chunks = currentChunks(doc);

  renderControls();
  renderSource(doc, chunks);
  renderChunks(chunks);
  renderStats(chunks);
  renderVerdict();
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
}

function renderSource(doc, chunks) {
  const at = doc.text.indexOf(RAG_ANSWER_SENTENCE);
  const answerRange = at === -1 ? null : [at, at + RAG_ANSWER_SENTENCE.length];
  const segs = buildSegments(doc.text, chunks, answerRange);

  // 청크가 새로 시작하는 지점들 — 여기에 세로선을 긋는다.
  // 겹침이 있으면 "겹침 시작"과 "앞 청크 끝" 두 군데가 다르므로 시작점만 표시한다.
  const starts = new Set(chunks.map(c => c.start).filter(p => p > 0));

  let html = "";
  for (const s of segs) {
    if (starts.has(s.start)) html += '<i class="brk" aria-hidden="true"></i>';

    const owner = s.owners.length ? s.owners[s.owners.length - 1] : null;
    const cls = ["seg"];
    if (s.owners.length > 1) cls.push("ov");
    else if (owner !== null) cls.push(owner % 2 === 0 ? "c0" : "c1");
    if (s.inAnswer) cls.push("ans");

    const label = s.owners.length > 1
      ? `청크 ${s.owners.map(i => i + 1).join(", ")}번이 함께 가진 부분`
      : owner !== null ? `청크 ${owner + 1}번` : "";

    html += `<span class="${cls.join(" ")}" title="${escapeHtml(label)}">${escapeHtml(doc.text.slice(s.start, s.end))}</span>`;
  }
  el.source.innerHTML = html;
}

function renderChunks(chunks) {
  el.chunks.innerHTML = chunks.map((c, i) => {
    // 정답 문장이 이 청크 안에 온전히 들어 있으면 표시해 준다
    const whole = c.text.includes(RAG_ANSWER_SENTENCE);
    const body = whole
      ? escapeHtml(c.text).replace(escapeHtml(RAG_ANSWER_SENTENCE), m => `<mark>${m}</mark>`)
      : escapeHtml(c.text);
    return `
      <div class="chunk-card ${i % 2 === 0 ? "c0" : "c1"}">
        <div class="chunk-head">
          <span>청크 ${i + 1}번</span>
          <span>${c.start}–${c.end} · ${c.end - c.start}자</span>
        </div>
        <div class="body">${body.replace(/\n+/g, " ")}</div>
      </div>`;
  }).join("");
}

function renderStats(chunks) {
  const lens = chunks.map(c => c.end - c.start);
  el.count.textContent = chunks.length;
  el.avg.innerHTML = `${Math.round(lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length))}<small>자</small>`;
  el.min.innerHTML = `${Math.min(...lens)}<small>자</small>`;

  let msg;
  if (state.mode === "paragraph") msg = "문단을 그대로 씁니다. 문단 길이가 들쭉날쭉하면 청크 길이도 들쭉날쭉해집니다.";
  else if (state.mode === "sentence") msg = "문장은 절대 쪼개지 않습니다. 겹침도 문장 단위라, 되가져올 만큼 짧은 문장이 없으면 겹치는 구간이 안 생기기도 합니다.";
  else if (state.size <= 160) msg = "청크가 너무 짧습니다 — 조각만 봐서는 무슨 얘기인지 알기 어려워집니다.";
  else if (state.size >= 500) msg = "청크가 큽니다 — 관계없는 내용이 함께 딸려 오고, LLM에 넣는 값도 비싸집니다.";
  else msg = "적당한 범위입니다. 다만 '적당함'의 기준은 문서 성격마다 다릅니다.";
  el.tradeoff.textContent = msg;
}

function renderVerdict() {
  const r = checkAnswerSurvives();
  const otherDoc = state.docId !== ANSWER_DOC_ID;

  const jump = otherDoc
    ? `<button id="btn-jump">해당 문서 보기</button>`
    : "";

  if (r.ok) {
    el.verdict.className = "verdict good";
    el.verdict.innerHTML = `
      <span class="icon" aria-hidden="true">✅</span>
      <span>
        <span class="q">질문 "${escapeHtml(ANSWER_QUERY.text)}"</span>
        <strong>정답 문장이 청크 ${r.holder.index + 1}번 안에 온전히 들어 있습니다.</strong>
        이 청크만 찾아오면 답을 만들 수 있습니다.
      </span>${jump}`;
  } else {
    el.verdict.className = "verdict bad";
    el.verdict.innerHTML = `
      <span class="icon" aria-hidden="true">⚠️</span>
      <span>
        <span class="q">질문 "${escapeHtml(ANSWER_QUERY.text)}"</span>
        <strong>이 설정에서는 정답 문장이 두 청크로 잘렸습니다.</strong>
        어느 쪽을 찾아와도 답이 반쪽입니다. 겹침을 늘리거나 문장 경계로 잘라 보세요.
      </span>${jump}`;
  }

  const btn = document.getElementById("btn-jump");
  if (btn) btn.addEventListener("click", () => {
    state.docId = ANSWER_DOC_ID;
    el.docSelect.value = ANSWER_DOC_ID;
    render();
  });
}

// ── 컨트롤 ─────────────────────────────────────────────────────

el.docSelect.innerHTML = RAG_DOCS
  .map(d => `<option value="${d.id}">${escapeHtml(d.title)}</option>`)
  .join("");
el.docSelect.value = state.docId;

el.docSelect.addEventListener("change", () => {
  state.docId = el.docSelect.value;
  render();
});

el.size.addEventListener("input", () => {
  state.size = Number(el.size.value);
  // 겹침이 청크 크기보다 크면 무한 루프가 된다. 항상 크기보다 작게 눌러 둔다.
  if (state.overlap >= state.size) state.overlap = Math.max(0, state.size - 20);
  persist();
  render();
});

el.overlap.addEventListener("input", () => {
  state.overlap = Math.min(Number(el.overlap.value), state.size - 20);
  persist();
  render();
});

el.modeGroup.addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b) return;
  state.mode = b.dataset.mode;
  persist();
  render();
});

el.reset.addEventListener("click", () => {
  state.size = RAG_CHUNK_DEFAULTS.size;
  state.overlap = RAG_CHUNK_DEFAULTS.overlap;
  state.mode = RAG_CHUNK_DEFAULTS.mode;
  persist();
  render();
});

function persist() {
  ragSaveSettings(state);
}

// ── 유틸 ───────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ── 초기화 ─────────────────────────────────────────────────────

render();

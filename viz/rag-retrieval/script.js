/*
 * 검색 · 생성 페이지. 이 시리즈의 본체.
 *
 * 같은 질문을 Sparse와 Dense에 동시에 넣고, 서로 다른 청크를 1등으로 올리는 장면을 보여준다.
 * 프리셋 질문 5개는 각각 노리는 장면이 정해져 있다 (corpus.js의 teach 참고).
 *   q2 — Sparse 완패 (겹치는 단어 0개)
 *   q3 — Dense 완패 (모델명은 뜻이 없는 기호라 못 본다)
 *   q4 — 청킹에서 정답 문장이 잘렸으면 여기서도 답이 안 나온다
 */

const TOP_N = 3;             // 각 패널에 보여줄 검색 결과 수
const HYBRID_ROWS = 5;       // Hybrid 목록에 보여줄 줄 수
const ROW_H = 62;            // Hybrid 줄 하나의 높이(px) — 자리 이동 애니메이션 계산에 쓴다

const el = {
  inherit: document.getElementById("inherit"),
  queryButtons: document.getElementById("query-buttons"),
  verdict: document.getElementById("verdict"),
  sparseHits: document.getElementById("sparse-hits"),
  denseHits: document.getElementById("dense-hits"),
  map: document.getElementById("map"),
  alpha: document.getElementById("alpha"),
  alphaValue: document.getElementById("alpha-value"),
  hybridList: document.getElementById("hybrid-list"),
  topk: document.getElementById("topk"),
  topkValue: document.getElementById("topk-value"),
  prompt: document.getElementById("prompt"),
  answer: document.getElementById("answer"),
  answerNote: document.getElementById("answer-note"),
  statLen: document.getElementById("stat-len"),
  statEvidence: document.getElementById("stat-evidence")
};

const settings = ragLoadSettings();
const chunks = ragBuildChunks(settings.size, settings.overlap, settings.mode);
const bm = ragBuildBm25(chunks);

// 청크 벡터는 질문이 바뀌어도 그대로다. 한 번만 구해 둔다.
const chunkVecs = chunks.map(c => ragEmbed(c.text));

const state = {
  queryId: RAG_QUERIES[0].id,
  alpha: 0.5,
  topk: 3
};

// ── 점수 계산 ──────────────────────────────────────────────────

function currentQuery() {
  return RAG_QUERIES.find(q => q.id === state.queryId);
}

// 질문 하나에 대한 모든 청크의 두 점수를 한 번에 구한다.
function scoreAll(query) {
  const qTokens = ragTokenize(query.text);
  const qEmbed = ragEmbed(query.text);

  const rows = chunks.map((c, i) => {
    const s = bm.score(qTokens, i);
    const dense = (qEmbed.hits && chunkVecs[i].hits)
      ? ragCosine(qEmbed.vec, chunkVecs[i].vec)
      : 0;
    return { index: i, chunk: c, sparse: s.score, parts: s.parts, dense };
  });

  return { rows, qTokens, qEmbed };
}

// 두 점수는 단위가 다르다(BM25는 상한이 없고 코사인은 0~1). 섞으려면 각자 0~1로 눌러야 한다.
function normalized(rows, key) {
  const max = Math.max(...rows.map(r => r[key]), 0);
  return max <= 0 ? rows.map(() => 0) : rows.map(r => r[key] / max);
}

function ranked(rows, key) {
  return [...rows].sort((a, b) => b[key] - a[key] || a.index - b.index);
}

function hybridRanking(rows) {
  const ns = normalized(rows, "sparse");
  const nd = normalized(rows, "dense");
  const merged = rows.map((r, i) => ({
    ...r,
    nSparse: ns[i],
    nDense: nd[i],
    // 양 끝값에서 각 패널 순위와 정확히 같아지도록 단순 가중 합을 쓴다
    total: (1 - state.alpha) * ns[i] + state.alpha * nd[i]
  }));
  return merged.sort((a, b) => b.total - a.total || a.index - b.index);
}

// ── 그리기 ─────────────────────────────────────────────────────

function render() {
  const query = currentQuery();
  const { rows, qEmbed } = scoreAll(query);

  renderQueryButtons();
  renderVerdict(query, rows);
  renderSparse(query, rows);
  renderMap(query, qEmbed, rows);
  renderDense(rows);
  renderHybrid(rows);
  renderGeneration(query, rows);
}

function renderInherit() {
  const s = settings;
  const label = RAG_MODE_LABEL[s.mode];
  const detail = s.mode === "paragraph"
    ? `<strong>${label}</strong>`
    : `<strong>${label} · ${s.size}자 · 겹침 ${s.overlap}자</strong>`;
  const lead = s.inherited ? "청킹 페이지에서 설정한 값을 이어받았습니다" : "기본 청킹 설정으로 계산했습니다";
  el.inherit.innerHTML =
    `${lead} — ${detail} → <strong>청크 ${chunks.length}개</strong>가 검색 대상입니다. ` +
    `<a href="../rag-chunking/index.html">청킹 바꾸기</a> · ` +
    `<a href="../rag-indexing/index.html">색인 보기</a>`;
}

function renderQueryButtons() {
  el.queryButtons.innerHTML = RAG_QUERIES.map(q =>
    `<button data-q="${q.id}" class="${q.id === state.queryId ? "primary" : ""}">${escapeHtml(q.text)}</button>`
  ).join("");
}

function renderVerdict(query, rows) {
  const sparseTop = ranked(rows, "sparse")[0];
  const denseTop = ranked(rows, "dense")[0];

  // 전부 0점이면 1등이라는 것 자체가 없다. 있는 것처럼 말하면 안 된다.
  let note;
  if (sparseTop.sparse <= 0) {
    note = "키워드 검색은 아무것도 찾지 못했습니다 — 모든 청크가 0점입니다.";
  } else if (sparseTop.index === denseTop.index) {
    note = "두 방식이 같은 청크를 1등으로 올렸습니다.";
  } else {
    note = `1등이 서로 다릅니다 — 키워드는 청크 ${sparseTop.index + 1}번, 의미는 청크 ${denseTop.index + 1}번.`;
  }

  el.verdict.innerHTML = `
    <span class="badge">${escapeHtml(query.tag)}</span>
    <span><strong>${escapeHtml(note)}</strong> ${escapeHtml(query.teach)}</span>`;
}

function renderSparse(query, rows) {
  const top = ranked(rows, "sparse").slice(0, TOP_N);
  const max = Math.max(...rows.map(r => r.sparse), 0);

  // 겹치는 단어가 하나도 없으면 순위를 매기는 것 자체가 의미 없다. 실패를 크게 보여준다.
  if (max <= 0) {
    el.sparseHits.innerHTML = `
      <div class="fail">
        <span class="big">겹치는 단어가 하나도 없습니다</span>
        모든 청크의 점수가 0입니다. 질문에 쓴 표현이 문서에 없으면,
        키워드 검색은 뜻이 아무리 같아도 아무것도 찾지 못합니다.
      </div>`;
    return;
  }

  // 점수가 0인 청크는 "찾은 것"이 아니다. 순위에 끼워 넣으면 오히려 오해를 준다.
  const hits = top.filter(r => r.sparse > 0);
  const shortNote = hits.length < TOP_N
    ? `<div class="note-ok">질문의 단어가 걸린 청크는 ${hits.length}개뿐입니다. 나머지는 전부 0점이라 순위에 넣지 않았습니다.</div>`
    : "";

  el.sparseHits.innerHTML = shortNote + hits.map((r, rank) => {
    // 기여도가 큰 단어(=드문 단어)일수록 칩을 진하게
    const maxContrib = Math.max(...r.parts.map(p => p.contrib), 0.0001);
    const chips = r.parts.length
      ? r.parts.map(p => {
          const lvl = p.contrib / maxContrib > 0.75 ? "w3" : p.contrib / maxContrib > 0.4 ? "w2" : "";
          return `<span class="chip ${lvl}" title="점수 기여 ${p.contrib.toFixed(2)} · ${p.count}번 등장">${escapeHtml(p.term)}</span>`;
        }).join("")
      : `<span class="chip none">겹치는 단어 없음</span>`;

    return `
      <div class="hit ${rank === 0 ? "rank-1" : ""}">
        <div class="hit-head">
          <span class="hit-title">청크 ${r.index + 1}번 — ${escapeHtml(r.chunk.docTitle)}</span>
          <span class="hit-score">${r.sparse.toFixed(2)}점</span>
        </div>
        <span class="hit-track"><span class="hit-fill" style="width:${(100 * r.sparse / max).toFixed(1)}%"></span></span>
        <div class="chips">${chips}</div>
        <div class="hit-body">${highlight(r.chunk.text, r.parts.map(p => p.term))}</div>
      </div>`;
  }).join("");
}

function renderDense(rows) {
  const top = ranked(rows, "dense").slice(0, TOP_N);
  const max = Math.max(...rows.map(r => r.dense), 0);

  const anyWordMatch = top.some(r => r.parts.length > 0);
  const note = anyWordMatch
    ? ""
    : `<div class="note-ok">겹친 단어: 없음. 그래도 뜻이 가깝다는 이유로 찾아냈습니다.</div>`;

  el.denseHits.innerHTML = note + top.map((r, rank) => `
    <div class="hit ${rank === 0 ? "rank-1" : ""}">
      <div class="hit-head">
        <span class="hit-title">청크 ${r.index + 1}번 — ${escapeHtml(r.chunk.docTitle)}</span>
        <span class="hit-score">유사도 ${r.dense.toFixed(3)}</span>
      </div>
      <span class="hit-track"><span class="hit-fill" style="width:${(100 * r.dense / (max || 1)).toFixed(1)}%"></span></span>
      <div class="hit-body">${escapeHtml(r.chunk.text.replace(/\n+/g, " "))}</div>
    </div>`).join("");
}

function renderMap(query, qEmbed, rows) {
  const W = 400, H = 300, pad = 40;
  const top = ranked(rows, "dense").slice(0, TOP_N).map(r => r.index);

  const pts = rows.map(r => {
    const p = ragProject2d(chunkVecs[r.index].vec);
    const j = jitterFor(r.index);
    return { index: r.index, x: p.x, y: p.y, jx: j.x, jy: j.y };
  });
  const qp = ragProject2d(qEmbed.vec);

  const xs = pts.map(p => p.x).concat(qp.x, -0.2, 0.2);
  const ys = pts.map(p => p.y).concat(qp.y, -0.2, 0.2);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const sx = v => pad + (v - minX) / (maxX - minX || 1) * (W - pad * 2);
  const sy = v => H - pad - (v - minY) / (maxY - minY || 1) * (H - pad * 2);

  let svg = `<rect class="frame" x="1" y="1" width="${W - 2}" height="${H - 2}" rx="8"/>`;

  const cx = sx(0), cy = sy(0);
  RAG_AXES.forEach((name, i) => {
    const unit = new Array(RAG_AXES.length).fill(0);
    unit[i] = 1;
    const p = ragProject2d(unit);
    svg += `<line x1="${cx}" y1="${cy}" x2="${sx(p.x * 0.86)}" y2="${sy(p.y * 0.86)}" stroke="#f2f1eb" stroke-width="1"/>`;
    svg += `<text class="axis-lbl" x="${sx(p.x * 1.05)}" y="${sy(p.y * 1.05)}" text-anchor="middle"
              stroke="#ffffff" stroke-width="3" paint-order="stroke">${escapeHtml(name.split("/")[0])}</text>`;
  });

  const qx = sx(qp.x), qy = sy(qp.y);

  // 질문에서 상위 3개 청크로 선을 그어 "이 셋을 골랐다"를 보여준다
  for (const idx of top) {
    const p = pts.find(pp => pp.index === idx);
    svg += `<line class="link" x1="${qx.toFixed(1)}" y1="${qy.toFixed(1)}"
              x2="${(sx(p.x) + p.jx).toFixed(1)}" y2="${(sy(p.y) + p.jy).toFixed(1)}"/>`;
  }

  for (const p of pts) {
    const x = sx(p.x) + p.jx, y = sy(p.y) + p.jy;
    const isTop = top.includes(p.index);
    const r = isTop ? 8 : 5;
    svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}"
              fill="${isTop ? "#eb6834" : "#c9c7bf"}" opacity="${isTop ? 0.9 : 0.55}">
              <title>청크 ${p.index + 1}번</title></circle>`;
    svg += `<text class="lbl" x="${x.toFixed(1)}" y="${(y - r - 3).toFixed(1)}" text-anchor="middle"
              stroke="#ffffff" stroke-width="2.5" paint-order="stroke">${p.index + 1}</text>`;
  }

  // 질문은 별표로 — 색을 못 보더라도 모양으로 구분된다
  svg += `<path d="${starPath(qx, qy, 11, 5.2)}" fill="#1a1a1a" stroke="#ffffff" stroke-width="1.5"/>`;
  svg += `<text class="lbl" x="${qx.toFixed(1)}" y="${(qy + 22).toFixed(1)}" text-anchor="middle"
            fill="#1a1a1a" stroke="#ffffff" stroke-width="3" paint-order="stroke">질문</text>`;

  el.map.innerHTML = svg;
}

// Hybrid 목록은 다시 그리지 않고 자리만 옮긴다 — 그래야 순위가 바뀌는 게 눈에 보인다.
function buildHybridRows() {
  el.hybridList.innerHTML = chunks.map((c, i) => `
    <div class="hrow" data-i="${i}">
      <span class="rank"></span>
      <span class="who">청크 ${i + 1}번 <small>${escapeHtml(c.docTitle)}</small></span>
      <span class="stack"><span class="s"></span><span class="d"></span></span>
      <span class="total"></span>
    </div>`).join("");
  el.hybridList.style.height = `${HYBRID_ROWS * ROW_H}px`;
}

function renderHybrid(rows) {
  const merged = hybridRanking(rows);
  const maxTotal = Math.max(...merged.map(m => m.total), 0.0001);

  merged.forEach((m, rank) => {
    const node = el.hybridList.querySelector(`.hrow[data-i="${m.index}"]`);
    if (!node) return;
    const visible = rank < HYBRID_ROWS;
    node.style.transform = `translateY(${rank * ROW_H}px)`;
    node.style.opacity = visible ? "1" : "0";
    node.style.pointerEvents = visible ? "auto" : "none";
    node.classList.toggle("top", rank === 0);
    node.querySelector(".rank").textContent = rank + 1;
    node.querySelector(".total").textContent = m.total.toFixed(2);

    // 막대를 두 색으로 쌓아 어느 쪽 점수가 순위를 만들었는지 보이게 한다
    const sw = (1 - state.alpha) * m.nSparse / maxTotal * 100;
    const dw = state.alpha * m.nDense / maxTotal * 100;
    node.querySelector(".s").style.width = `${sw.toFixed(1)}%`;
    node.querySelector(".d").style.width = `${dw.toFixed(1)}%`;
  });

  const a = state.alpha;
  const label = a === 0 ? "키워드만" : a === 1 ? "의미만" : `키워드 ${Math.round((1 - a) * 100)} : 의미 ${Math.round(a * 100)}`;
  el.alphaValue.textContent = label;
}

function renderGeneration(query, rows) {
  const merged = hybridRanking(rows).slice(0, state.topk);
  const context = merged.map(m => m.chunk.text.replace(/\n+/g, " ")).join("\n\n");
  const hasEvidence = context.includes(query.evidence);

  const sys = "당신은 고객지원 상담원입니다. 아래 참고 자료에 있는 내용만 사용해 답하세요.";
  const promptText = `${sys}\n\n[참고 자료]\n${context}\n\n[질문]\n${query.text}`;

  el.prompt.innerHTML =
    `<span class="sys">${escapeHtml(sys)}</span>\n\n<span class="sys">[참고 자료]</span>\n` +
    merged.map((m, i) =>
      `<span class="ctx">${escapeHtml(m.chunk.text.replace(/\n+/g, " "))}</span>`
    ).join("\n\n") +
    `\n\n<span class="sys">[질문]</span>\n<span class="usr">${escapeHtml(query.text)}</span>`;

  el.statLen.innerHTML = `${promptText.length}<small>자</small>`;
  el.statEvidence.innerHTML = hasEvidence
    ? `<span style="color:#2f7a4d">있음</span>`
    : `<span style="color:#c0521f">없음</span>`;

  el.answer.className = `answer-box ${hasEvidence ? "" : "poor"}`;
  el.answer.textContent = hasEvidence ? query.answerGood : query.answerPoor;

  el.answerNote.textContent = hasEvidence
    ? "답을 만들 근거가 프롬프트 안에 들어 있습니다. LLM이 지어내지 않고 답할 수 있는 상태입니다."
    : "근거가 프롬프트에 없습니다. 이 상태에서 그럴듯한 답이 나온다면 그건 지어낸 것(환각)입니다.";
}

// ── 컨트롤 ─────────────────────────────────────────────────────

el.queryButtons.addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b) return;
  state.queryId = b.dataset.q;
  render();
});

el.alpha.addEventListener("input", () => {
  state.alpha = Number(el.alpha.value);
  const { rows } = scoreAll(currentQuery());
  renderHybrid(rows);
  renderGeneration(currentQuery(), rows);
});

el.topk.addEventListener("input", () => {
  state.topk = Number(el.topk.value);
  el.topkValue.textContent = `${state.topk}개`;
  renderGeneration(currentQuery(), scoreAll(currentQuery()).rows);
});

// ── 유틸 ───────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// 반드시 escape를 먼저 하고 그 위에 <mark>를 씌운다 (순서가 바뀌면 태그가 그대로 들어간다).
// 태그 문자열을 바로 끼워 넣으면 다음 단어를 찾을 때 그 태그까지 걸리므로,
// 본문에 나올 리 없는 제어문자를 표식으로 심어 두고 마지막에 한꺼번에 태그로 바꾼다.
const MARK_OPEN = "\u0001";
const MARK_CLOSE = "\u0002";

function highlight(text, terms) {
  let html = escapeHtml(text.replace(/\n+/g, " "));
  const uniq = [...new Set(terms)].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const t of uniq) {
    const safe = escapeHtml(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    html = html.replace(new RegExp(safe, "gi"), m => MARK_OPEN + m + MARK_CLOSE);
  }
  return html.split(MARK_OPEN).join("<mark>").split(MARK_CLOSE).join("</mark>");
}

function pseudoRandom(n) {
  const x = Math.sin(n) * 43758.5453;
  return x - Math.floor(x);
}

// 개념이 같은 청크는 좌표도 같아 완전히 겹친다. 조금씩 흩어 놓아야 셀 수 있다.
function jitterFor(i) {
  const a = pseudoRandom(i * 7.13) * Math.PI * 2;
  const r = 7 + pseudoRandom(i * 3.71) * 11;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

function starPath(cx, cy, outer, inner) {
  let d = "";
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + i * Math.PI / 5;
    d += `${i === 0 ? "M" : "L"}${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`;
  }
  return d + "Z";
}

// ── 초기화 ─────────────────────────────────────────────────────

renderInherit();
buildHybridRows();
el.topkValue.textContent = `${state.topk}개`;
render();

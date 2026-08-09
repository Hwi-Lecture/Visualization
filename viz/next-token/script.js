// 다음 단어 예측 시각화.
//
// 핵심: data.js에는 로짓만 있고, 확률은 여기서 매번 softmax로 계산한다.
// 그래서 온도 슬라이더를 움직이면 막대가 진짜 수식대로 다시 그려진다.

const MAX_TOKENS = 20;      // 문장이 무한정 길어지지 않도록
const TOP_SHOWN = 8;        // 막대로 보여줄 후보 개수

const el = {
  sentence: document.getElementById("sentence"),
  bars: document.getElementById("bars"),
  rouletteTrack: document.getElementById("roulette-track"),
  needle: document.getElementById("needle"),
  promptSelect: document.getElementById("prompt-select"),
  btnStep: document.getElementById("btn-step"),
  btnAuto: document.getElementById("btn-auto"),
  btnUndo: document.getElementById("btn-undo"),
  btnReset: document.getElementById("btn-reset"),
  temp: document.getElementById("temp"),
  tempValue: document.getElementById("temp-value"),
  tempHint: document.getElementById("temp-hint"),
  greedy: document.getElementById("greedy"),
  useTopK: document.getElementById("use-topk"),
  topK: document.getElementById("topk"),
  useTopP: document.getElementById("use-topp"),
  topP: document.getElementById("topp"),
  distTableWrap: document.getElementById("dist-table-wrap")
};

const state = {
  promptIndex: 0,
  tokens: [],
  freshIndex: -1,     // 방금 붙인 단어 (애니메이션용)
  pickedWord: null,   // 방금 뽑힌 단어 (막대 강조용)
  finished: false,
  busy: false,
  auto: false
};

// ── 확률 계산 ──────────────────────────────────────────────────

// 문맥에 대한 후보 목록을 만든다. 반환되는 prob은 온도까지 반영된 진짜 확률.
function computeCandidates(tokens, T) {
  const { entries } = lookupDistribution(tokens);

  // 지수 계산이 넘치지 않도록 가장 큰 로짓을 빼고 계산한다 (결과는 동일)
  const maxZ = Math.max(TAIL.logit, ...entries.map(e => e[1]));

  const items = entries.map(([word, logit]) => ({
    word,
    logit,
    weight: Math.exp((logit - maxZ) / T),
    isTail: false
  }));

  items.push({
    word: `(그 외 ${TAIL.count.toLocaleString()}개 단어)`,
    logit: TAIL.logit,
    weight: TAIL.count * Math.exp((TAIL.logit - maxZ) / T),
    isTail: true
  });

  const total = items.reduce((s, it) => s + it.weight, 0);
  items.forEach(it => { it.prob = it.weight / total; });
  items.sort((a, b) => b.prob - a.prob);
  return items;
}

// greedy / top-k / top-p 를 적용해 "실제로 뽑을 수 있는 후보"를 골라낸다.
// 탈락한 후보도 목록에 남겨두고 kept=false 로만 표시한다 (화면에서 흐리게 보여주려고).
function applyFilters(items) {
  const kept = items.map(it => ({ ...it, kept: true }));

  if (el.greedy.checked) {
    kept.forEach((it, i) => { it.kept = i === 0; });
  } else {
    if (el.useTopK.checked) {
      const k = Math.max(1, parseInt(el.topK.value, 10) || 1);
      kept.forEach((it, i) => { if (i >= k) it.kept = false; });
    }
    if (el.useTopP.checked) {
      const p = Math.min(1, Math.max(0.01, parseFloat(el.topP.value) || 1));
      let cum = 0;
      let crossed = false;
      kept.forEach(it => {
        if (!it.kept) return;
        if (crossed) { it.kept = false; return; }
        cum += it.prob;
        if (cum >= p) crossed = true;   // 경계를 넘긴 후보까지는 남긴다
      });
    }
  }

  // 남은 후보들만으로 확률을 다시 100%가 되게 맞춘다
  const keptTotal = kept.filter(it => it.kept).reduce((s, it) => s + it.prob, 0);
  kept.forEach(it => { it.sampleProb = it.kept ? it.prob / keptTotal : 0; });
  return kept;
}

// ── 그리기 ─────────────────────────────────────────────────────

function renderSentence() {
  const chips = state.tokens.map((tok, i) => {
    const fresh = i === state.freshIndex ? " fresh" : "";
    return `<span class="chip${fresh}">${escapeHtml(tok)}</span>`;
  });

  if (state.finished) {
    chips.push('<span class="sentence-done">문장 끝</span>');
  } else {
    chips.push('<span class="chip blank">?</span>');
  }
  el.sentence.innerHTML = chips.join("");
}

function renderBars(items) {
  if (state.finished) {
    el.bars.innerHTML =
      '<p style="font-size:1.1rem;color:#898781;padding:14px 0;">' +
      '문장이 끝났습니다. <strong>되돌리기</strong>로 다른 길을 가보거나 <strong>처음부터</strong>를 눌러보세요.</p>';
    el.rouletteTrack.innerHTML = "";
    el.needle.classList.remove("armed");
    return;
  }

  const shown = [];
  let listed = 0;
  for (const it of items) {
    if (it.isTail) { shown.push(it); continue; }
    if (listed < TOP_SHOWN) { shown.push(it); listed++; }
  }
  shown.sort((a, b) => b.prob - a.prob);

  const maxProb = Math.max(...shown.map(it => it.prob));

  el.bars.innerHTML = shown.map(it => {
    const cls = [
      "bar-row",
      it.isTail ? "tail" : "",
      !it.kept ? "dropped" : "",
      it.word === state.pickedWord ? "picked" : ""
    ].filter(Boolean).join(" ");
    const width = (it.prob / maxProb) * 100;
    return `
      <div class="${cls}">
        <div class="bar-word">${escapeHtml(it.word)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
        <div class="bar-pct">${formatPct(it.prob)}</div>
      </div>`;
  }).join("");
}

function renderRoulette(items) {
  if (state.finished) return;
  el.rouletteTrack.innerHTML = "";

  const frag = document.createDocumentFragment();
  items.filter(it => it.kept).forEach(it => {
    const seg = document.createElement("div");
    seg.className = "roulette-seg";
    seg.style.width = (it.sampleProb * 100) + "%";
    seg.style.background = it.isTail ? "#b9b8b2" : "#2a78d6";
    if (it.word === state.pickedWord) seg.style.background = "#eb6834";
    frag.appendChild(seg);
  });
  el.rouletteTrack.appendChild(frag);
}

function renderDistTable(items) {
  const T = currentTemp();
  const rows = items.slice(0, 6).map(it => `
    <tr>
      <td>${escapeHtml(it.word)}</td>
      <td>${it.logit.toFixed(2)}</td>
      <td>${(it.logit / T).toFixed(2)}</td>
      <td>${formatPct(it.prob)}</td>
    </tr>`).join("");
  el.distTableWrap.innerHTML = `
    <table class="dist-table">
      <thead><tr><th>단어</th><th>로짓 z</th><th>z / T</th><th>확률 p</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function render() {
  renderSentence();
  if (state.finished) {
    renderBars([]);
    el.distTableWrap.innerHTML = "";
  } else {
    const items = applyFilters(computeCandidates(state.tokens, currentTemp()));
    renderBars(items);
    renderRoulette(items);
    renderDistTable(items);
  }
  updateButtons();
}

// ── 한 단어 뽑기 ───────────────────────────────────────────────

function pickOne() {
  if (state.busy || state.finished) return;
  state.busy = true;
  state.pickedWord = null;
  updateButtons();

  const items = applyFilters(computeCandidates(state.tokens, currentTemp()));
  const pool = items.filter(it => it.kept);

  // 룰렛 위치를 먼저 정하고, 그 위치가 가리키는 칸의 단어를 뽑는다.
  // (확률대로 뽑는 것과 수학적으로 같지만 화면에서 과정이 보인다)
  let u, chosen, needleAt;
  if (el.greedy.checked) {
    chosen = pool[0];
    needleAt = pool[0].sampleProb / 2;
  } else {
    u = Math.random();
    let cum = 0;
    for (const it of pool) {
      cum += it.sampleProb;
      if (u <= cum) { chosen = it; break; }
    }
    if (!chosen) chosen = pool[pool.length - 1];
    needleAt = u;
  }

  // 바늘 애니메이션: 위치를 0으로 되돌린 뒤 다시 걸어야 transition이 동작한다
  el.needle.classList.remove("armed");
  el.needle.style.left = "0%";
  void el.needle.offsetWidth;
  el.needle.classList.add("armed");
  el.needle.style.left = (needleAt * 100) + "%";

  const dwell = state.auto ? 480 : 1150;
  setTimeout(() => {
    state.pickedWord = chosen.word;
    render();

    setTimeout(() => {
      const word = chosen.isTail
        ? TAIL_WORDS[Math.floor(Math.random() * TAIL_WORDS.length)]
        : chosen.word;

      state.tokens.push(word);
      state.freshIndex = state.tokens.length - 1;
      state.pickedWord = null;
      state.finished = STOP_TOKENS.includes(word) || state.tokens.length >= MAX_TOKENS;
      state.busy = false;
      el.needle.classList.remove("armed");
      render();

      if (state.auto && !state.finished) {
        setTimeout(pickOne, 250);
      } else if (state.auto) {
        setAuto(false);
      }
    }, state.auto ? 320 : 550);
  }, dwell);
}

// ── 컨트롤 ─────────────────────────────────────────────────────

function currentTemp() {
  return parseFloat(el.temp.value);
}

function updateButtons() {
  const blocked = state.busy || state.finished;
  el.btnStep.disabled = blocked;
  el.btnAuto.disabled = state.finished;
  el.btnUndo.disabled = state.busy || state.tokens.length <= startTokens().length;
  el.btnAuto.textContent = state.auto ? "정지" : "자동으로 계속";
}

function updateTempHint() {
  const T = currentTemp();
  el.tempValue.textContent = T.toFixed(2);
  let hint;
  if (T < 0.45) hint = "낮음 — 1등에 몰려서 거의 항상 같은 문장이 나옵니다";
  else if (T <= 1.0) hint = "보통 — 그럴듯하면서 매번 조금씩 다릅니다";
  else hint = "높음 — 확률이 낮은 단어까지 뽑혀서 문장이 이상해집니다";
  el.tempHint.textContent = hint;
}

function startTokens() {
  return START_PROMPTS[state.promptIndex].tokens;
}

function setAuto(on) {
  state.auto = on;
  updateButtons();
  if (on && !state.busy && !state.finished) pickOne();
}

function reset() {
  state.auto = false;
  state.busy = false;
  state.tokens = startTokens().slice();
  state.freshIndex = -1;
  state.pickedWord = null;
  state.finished = false;
  el.needle.classList.remove("armed");
  el.needle.style.left = "0%";
  render();
}

// ── 유틸 ───────────────────────────────────────────────────────

function formatPct(p) {
  if (p >= 0.1) return (p * 100).toFixed(1) + "%";
  if (p >= 0.001) return (p * 100).toFixed(2) + "%";
  return "<0.1%";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ── 초기화 ─────────────────────────────────────────────────────

el.promptSelect.innerHTML = START_PROMPTS
  .map((p, i) => `<option value="${i}">${escapeHtml(p.label)}</option>`).join("");

el.promptSelect.addEventListener("change", e => {
  state.promptIndex = parseInt(e.target.value, 10);
  reset();
});

el.btnStep.addEventListener("click", () => { setAuto(false); pickOne(); });
el.btnAuto.addEventListener("click", () => setAuto(!state.auto));
el.btnReset.addEventListener("click", reset);

el.btnUndo.addEventListener("click", () => {
  setAuto(false);
  if (state.tokens.length > startTokens().length) {
    state.tokens.pop();
    state.freshIndex = -1;
    state.pickedWord = null;
    state.finished = false;
    render();
  }
});

el.temp.addEventListener("input", () => {
  updateTempHint();
  if (!state.busy) render();
});

[el.greedy, el.useTopK, el.topK, el.useTopP, el.topP].forEach(node => {
  node.addEventListener("input", () => { if (!state.busy) render(); });
});

updateTempHint();
reset();

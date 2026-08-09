// 학습 시각화 UI. 실제 계산은 전부 model.js가 한다.
//
// 렌더링과 학습을 분리하는 게 핵심이다. 학습은 프레임당 수백 번 돌려도
// 가볍지만, 화면을 그 횟수만큼 다시 그리면 브라우저가 버티지 못한다.
// 그래서 "프레임당 N스텝 학습 → 화면은 한 번만 갱신" 구조로 짠다.

const CONTEXT_SIZE = 3;
const TOP_SHOWN = 6;         // 막대로 보여줄 후보 개수
const PLOT_EVERY = 20;       // 몇 스텝마다 loss 곡선에 점을 찍을지

const el = {
  example: document.getElementById("example"),
  bars: document.getElementById("bars"),
  corpus: document.getElementById("corpus"),
  samples: document.getElementById("samples"),
  statSteps: document.getElementById("stat-steps"),
  statLoss: document.getElementById("stat-loss"),
  statP: document.getElementById("stat-p"),
  modelSpec: document.getElementById("model-spec"),
  btnStep: document.getElementById("btn-step"),
  btnRun: document.getElementById("btn-run"),
  btnReset: document.getElementById("btn-reset"),
  btnGenerate: document.getElementById("btn-generate"),
  lr: document.getElementById("lr"),
  lrValue: document.getElementById("lr-value"),
  speed: document.getElementById("speed"),
  speedValue: document.getElementById("speed-value")
};

const dataset = buildDataset(CORPUS, CONTEXT_SIZE);
const model = new MiniLM(dataset.words.length, { contextSize: CONTEXT_SIZE });

const state = {
  steps: 0,
  order: [],
  ptr: 0,
  current: null,
  running: false,
  rafId: null,
  advanceTimer: null,
  lossSum: 0,
  lossCount: 0
};

// ── 학습 진행 ──────────────────────────────────────────────────

function shuffleOrder() {
  state.order = dataset.examples.map((_, i) => i);
  for (let i = state.order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [state.order[i], state.order[j]] = [state.order[j], state.order[i]];
  }
  state.ptr = 0;
}

function advance() {
  if (state.ptr >= state.order.length) shuffleOrder();
  state.current = dataset.examples[state.order[state.ptr++]];
}

// 예제 하나를 학습한다. 반환값은 (가중치를 고치기 전의) loss.
function learnCurrent() {
  const lr = parseFloat(el.lr.value);
  const loss = model.trainStep(state.current.ctx, state.current.target, lr);
  state.steps++;
  state.lossSum += loss;
  state.lossCount++;

  if (state.steps % PLOT_EVERY === 0) {
    Plotly.extendTraces("loss-plot",
      { x: [[state.steps]], y: [[state.lossSum / state.lossCount]] }, [0]);
    state.lossSum = 0;
    state.lossCount = 0;
  }
  return loss;
}

// 버튼 한 번 = 지금 문제를 배우고, 잠시 뒤 다음 문제로 넘어간다.
function singleStep() {
  stopRunning();
  clearTimeout(state.advanceTimer);
  learnCurrent();
  render();                                   // 정답 막대가 올라간 직후 모습
  state.advanceTimer = setTimeout(() => {     // 그다음 새 문제 제시
    advance();
    render();
  }, 800);
}

function frame() {
  const perFrame = parseInt(el.speed.value, 10);
  for (let i = 0; i < perFrame; i++) {
    advance();
    learnCurrent();
  }
  render();
  if (state.running) state.rafId = requestAnimationFrame(frame);
}

function startRunning() {
  if (state.running) return;
  clearTimeout(state.advanceTimer);
  state.running = true;
  el.btnRun.textContent = "정지";
  state.rafId = requestAnimationFrame(frame);
}

function stopRunning() {
  if (!state.running) return;
  state.running = false;
  cancelAnimationFrame(state.rafId);
  el.btnRun.textContent = "빠르게 학습";
}

function reset() {
  stopRunning();
  clearTimeout(state.advanceTimer);
  model.reset();
  state.steps = 0;
  state.lossSum = 0;
  state.lossCount = 0;
  shuffleOrder();
  advance();
  initPlot();
  el.samples.innerHTML = '<span class="placeholder">아직 만든 문장이 없습니다.</span>';
  render();
}

// ── 그리기 ─────────────────────────────────────────────────────

function render() {
  const ex = state.current;
  const probs = model.forward(ex.ctx);       // 지금 실력 기준 예측
  const pAnswer = probs[ex.target];
  const loss = -Math.log(pAnswer + 1e-9);

  // 문제: 앞 3단어 → 정답
  const ctxChips = ex.ctx
    .map(i => `<span class="chip">${escapeHtml(dataset.words[i])}</span>`).join("");
  el.example.innerHTML =
    ctxChips +
    '<span class="arrow">→</span>' +
    `<span class="chip answer">${escapeHtml(dataset.words[ex.target])}</span>` +
    '<span class="arrow" style="font-size:0.85rem;">← 맞혀야 할 단어</span>';

  // 예측 막대 (상위 몇 개 + 정답은 순위 밖이어도 반드시 포함)
  const ranked = Array.from(probs)
    .map((p, i) => ({ word: dataset.words[i], p, isAnswer: i === ex.target }))
    .sort((a, b) => b.p - a.p);

  const shown = ranked.slice(0, TOP_SHOWN);
  if (!shown.some(r => r.isAnswer)) shown.push(ranked.find(r => r.isAnswer));

  const maxP = shown[0].p;
  el.bars.innerHTML = shown.map(r => `
    <div class="bar-row${r.isAnswer ? " answer" : ""}">
      <div class="bar-word">${escapeHtml(r.word)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(r.p / maxP) * 100}%"></div></div>
      <div class="bar-pct">${(r.p * 100).toFixed(1)}%</div>
    </div>`).join("");

  el.statSteps.textContent = state.steps.toLocaleString();
  el.statLoss.textContent = loss.toFixed(3);
  el.statP.textContent = (pAnswer * 100).toFixed(1) + "%";

  // 지금 배우는 문장을 코퍼스 목록에서 강조
  Array.from(el.corpus.children).forEach((node, i) => {
    node.classList.toggle("active", i === ex.sentenceId);
  });
}

function initPlot() {
  Plotly.newPlot("loss-plot", [{
    x: [], y: [],
    mode: "lines",
    line: { color: "#2a78d6", width: 2 },
    hovertemplate: "%{x}번째 학습<br>loss %{y:.3f}<extra></extra>"
  }], {
    margin: { l: 48, r: 12, t: 8, b: 40 },
    xaxis: {
      title: { text: "학습 횟수", font: { size: 12, color: "#898781" } },
      gridcolor: "#e1e0d9", linecolor: "#c3c2b7", tickfont: { color: "#898781" }, zeroline: false
    },
    yaxis: {
      title: { text: "loss (틀린 정도)", font: { size: 12, color: "#898781" } },
      rangemode: "tozero",
      gridcolor: "#e1e0d9", linecolor: "#c3c2b7", tickfont: { color: "#898781" }, zeroline: false
    },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    font: { family: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
    showlegend: false
  }, { displayModeBar: false, responsive: true });
}

function generateSamples() {
  const lines = [];
  for (let i = 0; i < 3; i++) {
    const s = model.generate(dataset.words, dataset.index, { temperature: 0.7 });
    lines.push(escapeHtml(s || "(아무 말도 못 만들었습니다)"));
  }
  el.samples.innerHTML = lines.map(s => `<div>${s}</div>`).join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ── 초기화 ─────────────────────────────────────────────────────

el.corpus.innerHTML = CORPUS.map(s => `<div>${escapeHtml(s)}</div>`).join("");

el.modelSpec.textContent =
  `이 모델: 단어 ${dataset.words.length}개, 학습 예제 ${dataset.examples.length}개, ` +
  `가중치 ${model.paramCount.toLocaleString()}개 (앞 3단어 → 임베딩 ${model.D}차원 → 은닉층 ${model.H}개 → 다음 단어).`;

el.btnStep.addEventListener("click", singleStep);
el.btnRun.addEventListener("click", () => state.running ? stopRunning() : startRunning());
el.btnReset.addEventListener("click", reset);
el.btnGenerate.addEventListener("click", generateSamples);

el.lr.addEventListener("input", () => { el.lrValue.textContent = parseFloat(el.lr.value).toFixed(2); });
el.speed.addEventListener("input", () => { el.speedValue.textContent = el.speed.value; });

reset();

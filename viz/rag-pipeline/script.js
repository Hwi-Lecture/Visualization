/*
 * RAG 전체 흐름도. 시리즈의 목차 겸 입구.
 *
 * 이 페이지가 노리는 것은 딱 하나다 — "미리 해두는 일"과 "질문이 올 때 하는 일"의 구분.
 * 초보자가 가장 많이 헷갈리는 지점이고, 이걸 잡아 두면 나머지 페이지가 쉬워진다.
 */

const STEP_MS = 1100;   // 한 단계를 짚고 있는 시간

// link가 없으면 비활성 박스. pending은 "따로 페이지를 만들 예정"이라는 뜻이고,
// 그냥 link만 없는 단계는 별도 페이지가 필요 없는 개념 단계다.
const OFFLINE = [
  {
    id: "doc", name: "문서 확보 · 정제",
    desc: "PDF, 위키, 사내 문서를 텍스트로 바꿉니다. 표와 머리글이 깨지기 쉬운 단계입니다.",
    link: null, pending: true,
    say: "먼저 답의 근거가 될 문서를 모아 텍스트로 만듭니다. 여기서 깨진 글자는 끝까지 따라다닙니다."
  },
  {
    id: "chunk", name: "청킹 (chunking)",
    desc: "긴 문서를 검색하기 좋은 크기로 자릅니다. 자르는 위치가 품질을 좌우합니다.",
    link: "../rag-chunking/index.html",
    say: "문서를 통째로 넣을 수는 없으니 잘게 자릅니다. 정답 문장이 경계에서 잘리면 뒤 단계가 아무리 좋아도 소용없습니다."
  },
  {
    id: "embed", name: "임베딩 · 색인",
    desc: "각 청크를 찾기 좋은 형태로 바꿔 저장합니다. 단어 목록과 좌표, 두 가지를 만듭니다.",
    link: "../rag-indexing/index.html",
    say: "잘라 둔 조각을 그냥 쌓아 두면 못 찾습니다. 단어를 세어 두거나(희소), 의미를 좌표로 바꿔 둡니다(밀집)."
  }
];

const ONLINE = [
  {
    id: "query", name: "질문 도착",
    desc: "사용자가 자기 말투로 묻습니다. 문서의 말투와 다른 것이 보통입니다.",
    link: null,
    say: "사용자는 문서에 적힌 표현을 모릅니다. \"충전해도 얼마 못 써요\"처럼 자기 말로 묻습니다."
  },
  {
    id: "search", name: "검색 (retrieval)",
    desc: "색인에서 관련 있어 보이는 청크 몇 개를 고릅니다. 키워드 방식과 의미 방식이 있습니다.",
    link: "../rag-retrieval/index.html",
    say: "색인을 뒤져 관련 있어 보이는 조각 몇 개를 고릅니다. 고르는 방법이 둘이고, 각자 잘하는 게 다릅니다."
  },
  {
    id: "prompt", name: "프롬프트 조립",
    desc: "찾아온 청크를 질문과 함께 하나의 글로 묶습니다. 이게 LLM에게 실제로 들어갑니다.",
    link: null,
    say: "찾은 조각을 질문과 함께 묶어 LLM에게 넘깁니다. 여기 안 들어간 내용은 LLM이 알 방법이 없습니다."
  },
  {
    id: "answer", name: "답변 생성",
    desc: "LLM이 받은 자료 안에서 답을 만듭니다. 근거가 없으면 지어내기도 합니다.",
    link: null,
    say: "LLM은 받은 자료를 근거로 답합니다. 근거가 안 들어왔는데 답이 나왔다면, 그건 지어낸 것입니다."
  }
];

const ALL = [OFFLINE[0], OFFLINE[1], OFFLINE[2], { id: "index" }, ...ONLINE];

const el = {
  offline: document.getElementById("steps-offline"),
  online: document.getElementById("steps-online"),
  indexBox: document.getElementById("step-index"),
  narration: document.getElementById("narration"),
  play: document.getElementById("btn-play")
};

const state = { playing: false, timer: null, at: -1 };

const INDEX_SAY = "만들어 둔 색인은 여기 쌓여 있습니다. 위쪽 일은 여기서 끝나고, 아래쪽 일은 여기서 시작합니다.";

// ── 그리기 ─────────────────────────────────────────────────────

function renderSteps(mount, steps, offset) {
  mount.innerHTML = steps.map((s, i) => {
    const inner = `
      <span class="num">${offset + i}단계</span>
      <span class="name">${escapeHtml(s.name)}</span>
      <span class="desc">${escapeHtml(s.desc)}</span>
      <span class="go">${s.link ? "자세히 보기 →" : s.pending ? "준비 중" : "&nbsp;"}</span>`;
    // 링크가 있으면 진짜 <a>로 만든다 — 새 탭으로 열기나 키보드 이동이 그냥 된다
    return s.link
      ? `<a class="step" id="step-${s.id}" href="${s.link}">${inner}</a>` +
        (i < steps.length - 1 ? `<span class="arrow" aria-hidden="true">→</span>` : "")
      : `<div class="step disabled" id="step-${s.id}">${inner}</div>` +
        (i < steps.length - 1 ? `<span class="arrow" aria-hidden="true">→</span>` : "");
  }).join("");
}

function highlight(id) {
  for (const s of ALL) {
    const node = document.getElementById(`step-${s.id}`);
    if (node) node.classList.toggle("active", s.id === id);
  }
  el.indexBox.classList.toggle("active", id === "index");
}

function say(text, who) {
  el.narration.innerHTML = who
    ? `<span class="who">${escapeHtml(who)}</span>${escapeHtml(text)}`
    : escapeHtml(text);
}

// ── 애니메이션 ─────────────────────────────────────────────────

function play() {
  stop();                 // 도중에 다시 눌러도 두 개가 겹쳐 돌지 않게 한다
  state.playing = true;
  state.at = -1;
  el.play.textContent = "정지";
  el.play.classList.remove("primary");
  next();
}

function next() {
  state.at++;
  if (state.at >= ALL.length) { finish(); return; }

  const s = ALL[state.at];
  highlight(s.id);
  if (s.id === "index") say(INDEX_SAY, "색인");
  else say(s.say, s.name);

  state.timer = setTimeout(next, STEP_MS);
}

function stop() {
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  state.playing = false;
  el.play.textContent = "한 번 돌려보기";
  el.play.classList.add("primary");
}

function finish() {
  stop();
  highlight(null);
  say("한 바퀴 돌았습니다. 위쪽 세 단계는 미리, 아래쪽 네 단계는 질문이 올 때마다 일어납니다. 각 단계를 눌러 자세히 보세요.");
}

// ── 컨트롤 ─────────────────────────────────────────────────────

el.play.addEventListener("click", () => {
  if (state.playing) { stop(); highlight(null); resetNarration(); }
  else play();
});

// 마우스를 올린 단계의 설명을 해설 자리에 띄운다 (애니메이션 중에는 방해하지 않는다)
function bindHover() {
  for (const s of ALL) {
    if (s.id === "index") continue;
    const node = document.getElementById(`step-${s.id}`);
    if (!node) continue;
    node.addEventListener("mouseenter", () => { if (!state.playing) say(s.say, s.name); });
    node.addEventListener("mouseleave", () => { if (!state.playing) resetNarration(); });
  }
  el.indexBox.addEventListener("mouseenter", () => { if (!state.playing) say(INDEX_SAY, "색인"); });
  el.indexBox.addEventListener("mouseleave", () => { if (!state.playing) resetNarration(); });
}

function resetNarration() {
  say("각 단계에 마우스를 올리면 설명이 여기 나옵니다. \"한 번 돌려보기\"를 누르면 순서대로 짚어 줍니다.");
}

// ── 유틸 ───────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ── 초기화 ─────────────────────────────────────────────────────

renderSteps(el.offline, OFFLINE, 1);
renderSteps(el.online, ONLINE, 4);
bindHover();
resetNarration();

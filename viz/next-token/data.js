// 다음 단어 확률 테이블.
//
// 정적 사이트라 실제 모델을 호출할 수 없으므로 손으로 만든 표를 쓴다.
// 중요한 점: 확률이 아니라 "로짓(logit)"을 저장한다. 확률을 저장해두면
// 온도 슬라이더가 가짜가 되지만, 로짓을 저장하면 브라우저에서 softmax를
// 실제로 계산하므로 슬라이더가 진짜 수식대로 움직인다.
//
// 키는 문맥의 "끝부분"이다. 긴 문맥부터 찾다가 없으면 짧은 쪽으로 물러난다.
// (백오프) 덕분에 모든 경우의 수를 다 적지 않아도 문장이 이어진다.

const START_PROMPTS = [
  { label: "The cat sat on the ___", tokens: ["The", "cat", "sat", "on", "the"] },
  { label: "I want to eat ___", tokens: ["I", "want", "to", "eat"] },
  { label: "The weather today is ___", tokens: ["The", "weather", "today", "is"] }
];

// 나머지 단어들(꼬리) 설정. 사전에 단어가 2,000개 더 있고 전부 낮은 로짓을
// 가진다고 본다. 온도를 올리면 이 꼬리가 부풀어 올라 헛소리가 튀어나온다.
const TAIL = { count: 2000, logit: -6.0 };

// 꼬리가 뽑혔을 때 보여줄 엉뚱한 단어들
const TAIL_WORDS = [
  "purple", "seventeen", "although", "quantum", "banana", "Tuesday",
  "elephant", "however", "triangle", "whisper", "cactus", "moreover",
  "umbrella", "nevertheless", "penguin", "concrete"
];

// 이 단어가 나오면 문장이 끝난 것으로 본다.
const STOP_TOKENS = [".", "!", "?"];

const DIST = {
  // ── 시작 프롬프트 ─────────────────────────────────────────────
  "the cat sat on the": [
    ["mat", 3.9], ["floor", 3.1], ["chair", 2.6], ["sofa", 2.2],
    ["bed", 1.9], ["table", 1.7], ["roof", 1.0]
  ],
  "i want to eat": [
    ["pizza", 3.4], ["something", 3.0], ["cake", 2.8], ["apples", 2.5],
    ["rice", 2.3], ["breakfast", 2.0], ["ice", 1.8]
  ],
  "the weather today is": [
    ["nice", 3.5], ["very", 3.2], ["cold", 3.0], ["warm", 2.7],
    ["sunny", 2.6], ["rainy", 2.4], ["terrible", 2.0]
  ],

  // ── 두 단어 문맥 ──────────────────────────────────────────────
  "on the": [
    ["floor", 3.0], ["table", 2.6], ["mat", 2.4], ["chair", 2.3],
    ["ground", 2.1], ["bed", 1.8]
  ],
  "to eat": [
    ["food", 2.8], ["something", 2.6], ["pizza", 2.4],
    ["lunch", 2.2], ["dinner", 2.0]
  ],
  "is very": [
    ["nice", 3.2], ["cold", 2.9], ["hot", 2.6],
    ["good", 2.4], ["warm", 2.3], ["strange", 1.6]
  ],
  "ice cream": [
    [".", 3.5], ["and", 2.7], [",", 2.2], ["today", 1.9]
  ],

  // ── 한 단어 문맥 ──────────────────────────────────────────────
  // 거의 확정적인 경우 — "확률이 한쪽으로 몰리면 항상 같은 답이 나온다"를
  // 보여주기 좋은 예시들
  "want": [["to", 4.6], ["a", 1.4], ["some", 1.2]],
  "ice": [["cream", 4.5], ["cold", 1.3], ["water", 1.1]],

  "i": [["want", 2.9], ["like", 2.8], ["am", 2.6], ["will", 2.2], ["think", 2.0]],
  "like": [["to", 3.8], ["it", 2.4], ["this", 2.0], ["that", 1.8]],
  "to": [["eat", 2.8], ["go", 2.6], ["play", 2.4], ["sleep", 2.2], ["drink", 2.0]],
  "very": [["nice", 3.0], ["cold", 2.8], ["good", 2.6], ["hot", 2.4], ["big", 2.2], ["strange", 1.5]],
  "and": [["the", 3.4], ["then", 2.6], ["i", 2.3], ["it", 2.0], ["she", 1.7]],
  "the": [["cat", 2.6], ["dog", 2.5], ["floor", 2.2], ["food", 2.0], ["weather", 1.9], ["man", 1.8]],
  "a": [["cat", 2.5], ["dog", 2.4], ["little", 2.2], ["big", 2.0], ["good", 1.9]],
  "cat": [["sat", 2.7], ["is", 2.5], ["ran", 2.2], ["slept", 2.0], ["and", 1.8]],
  "dog": [["sat", 2.6], ["is", 2.5], ["ran", 2.3], ["barked", 2.1], ["and", 1.8]],
  "sat": [["on", 3.8], ["down", 2.4], ["there", 1.8], ["quietly", 1.5]],
  "is": [["very", 2.8], ["a", 2.6], ["not", 2.4], ["good", 2.2], ["here", 1.9]],
  "was": [["very", 2.8], ["a", 2.5], ["not", 2.3], ["good", 2.1]],
  "it": [["is", 3.0], ["was", 2.7], ["looks", 2.1], ["feels", 1.9]],
  "then": [["i", 2.7], ["the", 2.5], ["she", 2.1], ["it", 2.0]],
  ",": [["and", 2.9], ["but", 2.5], ["so", 2.2], ["then", 2.0]],

  // ── 아무것도 안 맞을 때 (문장을 마무리하는 쪽으로) ─────────────
  "*": [
    [".", 3.4], ["and", 2.8], [",", 2.2], ["but", 1.9], ["then", 1.6], ["so", 1.4]
  ]
};

// 문맥 배열을 받아 가장 잘 맞는 확률 분포를 돌려준다.
// 긴 문맥(최대 5단어)부터 찾다가 없으면 한 단어씩 줄여 가며 다시 찾는다.
function lookupDistribution(tokens) {
  const lower = tokens.map(t => t.toLowerCase());
  for (let n = Math.min(5, lower.length); n >= 1; n--) {
    const key = lower.slice(lower.length - n).join(" ");
    if (DIST[key]) return { key, entries: DIST[key] };
  }
  return { key: "*", entries: DIST["*"] };
}

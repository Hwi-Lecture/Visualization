// 브라우저에서 진짜로 학습되는 아주 작은 언어 모델.
//
// 구조: 앞의 3단어 → 임베딩(16차원) → 은닉층(64, tanh) → 다음 단어 확률(softmax)
// 학습: cross-entropy loss + 평범한 SGD. 라이브러리 없이 Float32Array로만 계산한다.
// 파라미터는 1만 개 남짓이라 한 스텝이 0.1ms도 걸리지 않는다.

const CORPUS = [
  "the cat sat on the mat",
  "the dog sat on the floor",
  "the cat ate the fish",
  "the dog ate the bone",
  "the cat is very small",
  "the dog is very big",
  "i like to eat rice",
  "you like to eat bread",
  "we like to play games",
  "i want to eat pizza"
];

const PAD = "▁";      // 문장 시작 전 빈자리
const END = "<끝>";    // 문장 끝

// 코퍼스로부터 단어 사전과 학습 예제를 만든다.
function buildDataset(corpus, contextSize) {
  const words = [PAD, END];
  corpus.forEach(s => s.split(" ").forEach(w => {
    if (!words.includes(w)) words.push(w);
  }));

  const index = {};
  words.forEach((w, i) => { index[w] = i; });

  const examples = [];
  corpus.forEach((s, sentenceId) => {
    const seq = [];
    for (let i = 0; i < contextSize; i++) seq.push(PAD);
    s.split(" ").forEach(w => seq.push(w));
    seq.push(END);

    for (let i = contextSize; i < seq.length; i++) {
      examples.push({
        sentenceId,
        ctx: seq.slice(i - contextSize, i).map(w => index[w]),
        target: index[seq[i]]
      });
    }
  });

  return { words, index, examples };
}

class MiniLM {
  constructor(vocabSize, { embDim = 16, contextSize = 3, hidden = 64 } = {}) {
    this.V = vocabSize;
    this.D = embDim;
    this.C = contextSize;
    this.H = hidden;
    this.IN = contextSize * embDim;

    // 계산 중 재사용하는 버퍼 (매 스텝 새로 할당하지 않으려고)
    this.h = new Float32Array(this.H);
    this.probs = new Float32Array(this.V);
    this.dh = new Float32Array(this.H);
    this.dx = new Float32Array(this.IN);

    this.reset();
  }

  get paramCount() {
    return this.V * this.D + this.IN * this.H + this.H + this.H * this.V + this.V;
  }

  reset() {
    const rnd = (n, s) => {
      const a = new Float32Array(n);
      for (let i = 0; i < n; i++) a[i] = (Math.random() * 2 - 1) * s;
      return a;
    };
    this.Emb = rnd(this.V * this.D, 0.5);
    this.W1 = rnd(this.IN * this.H, 0.3);
    this.b1 = new Float32Array(this.H);
    this.W2 = rnd(this.H * this.V, 0.3);
    this.b2 = new Float32Array(this.V);
  }

  // 앞의 3단어를 받아 다음 단어 확률을 this.probs에 채운다.
  forward(ctx) {
    const { V, D, C, H, IN, h, probs } = this;

    for (let j = 0; j < H; j++) {
      let s = this.b1[j];
      for (let c = 0; c < C; c++) {
        const eo = ctx[c] * D;
        for (let d = 0; d < D; d++) s += this.Emb[eo + d] * this.W1[(c * D + d) * H + j];
      }
      h[j] = Math.tanh(s);
    }

    let max = -Infinity;
    for (let v = 0; v < V; v++) {
      let s = this.b2[v];
      for (let j = 0; j < H; j++) s += h[j] * this.W2[j * V + v];
      probs[v] = s;                    // 아직은 로짓
      if (s > max) max = s;
    }

    let sum = 0;
    for (let v = 0; v < V; v++) { probs[v] = Math.exp(probs[v] - max); sum += probs[v]; }
    for (let v = 0; v < V; v++) probs[v] /= sum;
    return probs;
  }

  // 한 예제를 배우고 loss를 돌려준다. (forward → 오차 → 가중치 수정)
  trainStep(ctx, target, lr) {
    const { V, D, C, H, IN, h, probs, dh, dx } = this;
    this.forward(ctx);
    const loss = -Math.log(probs[target] + 1e-9);

    // 출력층: 정답에는 확률을 올리고 나머지는 내린다
    dh.fill(0);
    for (let v = 0; v < V; v++) {
      const g = probs[v] - (v === target ? 1 : 0);
      this.b2[v] -= lr * g;
      for (let j = 0; j < H; j++) {
        dh[j] += g * this.W2[j * V + v];
        this.W2[j * V + v] -= lr * g * h[j];
      }
    }

    // 은닉층
    dx.fill(0);
    for (let j = 0; j < H; j++) {
      const g = dh[j] * (1 - h[j] * h[j]);   // tanh 미분
      this.b1[j] -= lr * g;
      for (let i = 0; i < IN; i++) {
        const c = (i / D) | 0;
        const e = this.Emb[ctx[c] * D + (i % D)];
        dx[i] += g * this.W1[i * H + j];
        this.W1[i * H + j] -= lr * g * e;
      }
    }

    // 임베딩
    for (let i = 0; i < IN; i++) {
      this.Emb[ctx[((i / D) | 0)] * D + (i % D)] -= lr * dx[i];
    }

    return loss;
  }

  // 지금 실력으로 문장을 하나 만들어 본다.
  generate(words, index, { temperature = 0.8, maxLen = 12 } = {}) {
    const ctx = new Array(this.C).fill(index[PAD]);
    const out = [];

    for (let n = 0; n < maxLen; n++) {
      const probs = this.forward(ctx);

      // 온도를 반영해 다시 정규화 (p^(1/T) 는 로짓을 T로 나눈 것과 같다)
      let sum = 0;
      const adjusted = new Float64Array(this.V);
      for (let v = 0; v < this.V; v++) {
        adjusted[v] = Math.pow(probs[v] + 1e-12, 1 / temperature);
        sum += adjusted[v];
      }

      let u = Math.random() * sum;
      let pick = this.V - 1;
      for (let v = 0; v < this.V; v++) {
        u -= adjusted[v];
        if (u <= 0) { pick = v; break; }
      }

      if (words[pick] === END) break;
      if (words[pick] === PAD) continue;

      out.push(words[pick]);
      ctx.shift();
      ctx.push(pick);
    }

    return out.join(" ");
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { CORPUS, PAD, END, buildDataset, MiniLM };
}

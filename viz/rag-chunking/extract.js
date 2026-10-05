/*
 * 업로드한 파일에서 텍스트만 뽑아낸다. 전부 브라우저 안에서 처리하고 어디로도 보내지 않는다.
 *
 * PDF는 pdf.js, Word(.docx)는 mammoth.js를 쓴다. 둘 다 무거워서(수백 KB)
 * 해당 형식 파일이 처음 올라왔을 때만 CDN에서 불러온다.
 *
 * 전역으로 노출: fileKind, extractText
 */

// cdnjs의 pdf.js에는 cmaps 폴더가 없어서 npm 패키지를 그대로 올려 둔 jsDelivr를 쓴다.
const PDFJS_BASE = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174";
const MAMMOTH_URL = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js";

// 파일 이름으로 종류를 정한다. 지원하지 않으면 null.
function fileKind(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".txt") || name.endsWith(".md")) return "text";
  return null;
}

async function extractText(file) {
  const kind = fileKind(file);
  let raw;
  if (kind === "pdf") raw = await extractPdf(file);
  else if (kind === "docx") raw = await extractDocx(file);
  else if (kind === "text") raw = await file.text();
  else if (file.name.toLowerCase().endsWith(".doc")) {
    throw new Error("예전 Word 형식(.doc)은 읽을 수 없습니다. Word에서 .docx로 다시 저장해 올려 주세요.");
  } else {
    throw new Error("PDF, Word(.docx), 텍스트(.txt/.md) 파일만 올릴 수 있습니다.");
  }

  const text = cleanText(raw);
  if (!text.trim()) {
    throw new Error(kind === "pdf"
      ? "글자를 찾지 못했습니다. 스캔한 이미지로만 된 PDF일 수 있습니다."
      : "파일 안에 글자가 없습니다.");
  }
  return text;
}

// 문단 경계 청킹은 빈 줄("\n\n")을 기준으로 삼는다. 형식마다 제각각인 줄바꿈을 여기서 맞춰 둔다.
function cleanText(s) {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Word ──────────────────────────────────────────────────────

async function extractDocx(file) {
  await loadScript(MAMMOTH_URL);
  const result = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value;
}

// ── PDF ───────────────────────────────────────────────────────
// PDF에는 "문장"이나 "문단"이 없다. 글자 덩어리가 좌표와 함께 흩어져 있을 뿐이라
// y좌표가 바뀌면 줄바꿈, 줄 간격이 평소보다 크게 벌어지면 문단이 바뀐 것으로 본다.

async function extractPdf(file) {
  await loadScript(`${PDFJS_BASE}/build/pdf.min.js`);
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/build/pdf.worker.min.js`;

  // 한글 PDF는 글꼴을 넣지 않고 "UniKS-UCS2-H" 같은 표준 CMap 이름만 적어 둔 경우가 많다.
  // 이 CMap 파일이 없으면 글자 코드를 유니코드로 못 바꿔서 텍스트가 통째로 비어 버린다.
  const pdf = await pdfjs.getDocument({
    data: await file.arrayBuffer(),
    cMapUrl: `${PDFJS_BASE}/cmaps/`,
    cMapPacked: true
  }).promise;
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    pages.push(pageToText(content.items));
  }
  return pages.join("\n\n");
}

function pageToText(items) {
  // 1) 같은 y좌표의 조각을 한 줄로 모은다
  const lines = [];
  let cur = null;
  for (const it of items) {
    if (typeof it.str !== "string") continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const h = it.height || Math.abs(it.transform[3]) || 10;

    if (!cur || Math.abs(y - cur.y) > h * 0.5) {
      if (it.str === "" && !cur) continue;
      cur = { y, h, text: "", endX: x };
      lines.push(cur);
    }
    // 조각 사이가 떨어져 있으면 띄어쓰기가 있던 자리다
    if (cur.text && x - cur.endX > h * 0.2 && !/\s$/.test(cur.text) && !/^\s/.test(it.str)) {
      cur.text += " ";
    }
    cur.text += it.str;
    cur.endX = x + (it.width || 0);
  }

  const filled = lines.filter(l => l.text.trim());
  if (!filled.length) return "";

  // 2) 평소 줄 간격(중앙값)보다 확 벌어진 곳을 문단 경계로 본다
  const gaps = [];
  for (let i = 1; i < filled.length; i++) gaps.push(Math.abs(filled[i - 1].y - filled[i].y));
  const sorted = [...gaps].sort((a, b) => a - b);
  const typical = sorted[Math.floor(sorted.length / 2)] || 0;

  let out = filled[0].text.trim();
  for (let i = 1; i < filled.length; i++) {
    const gap = gaps[i - 1];
    out += typical && gap > typical * 1.45 ? "\n\n" : "\n";
    out += filled[i].text.trim();
  }
  return out;
}

// ── CDN 지연 로딩 ─────────────────────────────────────────────

const loading = {};

function loadScript(src) {
  if (!loading[src]) {
    loading[src] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => {
        delete loading[src];
        reject(new Error("문서 읽기 도구를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요."));
      };
      document.head.appendChild(s);
    });
  }
  return loading[src];
}

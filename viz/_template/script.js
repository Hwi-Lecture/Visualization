// 시각화 로직을 여기 작성.
// #viz-root 안에 D3 svg를 그리거나, Plotly.newPlot("viz-root", ...)를 호출하면 됨.

const root = document.getElementById("viz-root");

// 예시 (Plotly):
// Plotly.newPlot(root, [{ y: [1, 2, 3], type: "scatter" }], { margin: { t: 20 } });

// 예시 (D3):
// const svg = d3.select(root).append("svg").attr("width", 600).attr("height", 400);

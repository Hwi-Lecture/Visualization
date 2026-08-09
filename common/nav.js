// 각 viz 페이지 상단에 "메인으로" 링크를 자동 삽입한다.
// 사용법: <body> 맨 위에 <div id="viz-nav"></div> 를 두고 이 스크립트를 로드하면 됨.
document.addEventListener("DOMContentLoaded", () => {
  const mount = document.getElementById("viz-nav");
  if (!mount) return;
  mount.className = "viz-nav";
  mount.innerHTML = '<a href="../../index.html">&larr; 메인으로</a>';
});

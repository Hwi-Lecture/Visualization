/*
 * RAG 파이프라인 시각화 시리즈가 공유하는 데이터와 계산 유틸.
 *
 * rag-chunking / rag-indexing / rag-retrieval 세 페이지가 이 파일 하나를 같이 읽는다.
 * 같은 문서가 청킹 → 색인 → 검색을 거쳐 흘러가는 걸 보여주는 게 시리즈의 핵심이라,
 * 코퍼스를 페이지마다 복사해 두면 반드시 어긋나기 때문이다.
 *
 * 전역으로 노출: RAG_AXES, RAG_DOCS, RAG_QUERIES, RAG_CHUNK_DEFAULTS,
 *               ragTokenize, ragChunkDoc, ragBuildChunks, ragEmbed, ragCosine,
 *               ragProject2d, ragBuildBm25, ragLoadSettings, ragSaveSettings
 */

// ── 개념 축 ────────────────────────────────────────────────────
// 진짜 임베딩의 768차원에는 이런 이름을 붙일 수 없다. 여기서는 눈으로 보여주려고
// 손으로 의미를 붙인 6차원 "미니 임베딩"이다. (각 페이지 '자세히'에 이 사실을 고지한다)
const RAG_AXES = [
  "배터리/전원",
  "발열/소음",
  "화면/디스플레이",
  "소프트웨어/업데이트",
  "구매/환불/배송",
  "키보드/입력"
];

// ── 개념 사전 ──────────────────────────────────────────────────
// 단어(부분 문자열) → 6차원 벡터. 한국어 형태소 분석기 없이 동작해야 하므로
// 토큰 일치가 아니라 "문자열에 포함되어 있는가"로 찾는다. 조사·활용이 붙어도 잡힌다.
// 이 사전이 Dense 검색의 전부다 — 동의어 함정과 모델명 함정이 여기서 결정된다.
const CONCEPT_LEXICON = {
  // 0. 배터리/전원  ("충전"과 "배터리"가 같은 축 → 동의어 함정이 여기서 성립한다)
  "배터리": [1.00, 0, 0, 0, 0, 0],
  "충전":   [1.00, 0, 0, 0, 0, 0],
  "완충":   [0.90, 0, 0, 0, 0, 0],
  "방전":   [0.95, 0, 0, 0, 0, 0],
  "전원":   [0.85, 0, 0, 0, 0, 0],
  "잔량":   [0.90, 0, 0, 0, 0, 0],
  "어댑터": [0.80, 0, 0, 0, 0, 0],
  "절전":   [0.75, 0, 0, 0.20, 0, 0],
  "사용 시간": [0.60, 0, 0, 0, 0, 0],
  "지속 시간": [0.65, 0, 0, 0, 0, 0],
  "닳":     [0.60, 0, 0, 0, 0, 0],

  // 1. 발열/소음
  "발열":   [0, 1.00, 0, 0, 0, 0],
  "뜨거":   [0, 0.90, 0, 0, 0, 0],
  "뜨겁":   [0, 0.90, 0, 0, 0, 0],
  "온도":   [0, 0.70, 0, 0, 0, 0],
  "냉각":   [0, 0.85, 0, 0, 0, 0],
  "팬":     [0, 0.85, 0, 0, 0, 0],
  "소음":   [0, 0.95, 0, 0, 0, 0],
  "소리":   [0, 0.80, 0, 0, 0, 0],
  "시끄":   [0, 0.90, 0, 0, 0, 0],
  "통풍":   [0, 0.70, 0, 0, 0, 0],

  // 2. 화면/디스플레이
  "화면":       [0, 0, 1.00, 0, 0, 0],
  "디스플레이": [0, 0, 1.00, 0, 0, 0],
  "깜빡":       [0, 0, 0.90, 0, 0, 0],
  "밝기":       [0, 0, 0.80, 0, 0, 0],
  "해상도":     [0, 0, 0.85, 0, 0, 0],
  "백라이트":   [0, 0, 0.80, 0, 0, 0],
  "잔상":       [0, 0, 0.75, 0, 0, 0],

  // 3. 소프트웨어/업데이트
  "업데이트":   [0, 0, 0, 1.00, 0, 0],
  "펌웨어":     [0, 0, 0, 0.95, 0, 0],
  "드라이버":   [0, 0, 0, 0.90, 0, 0],
  "소프트웨어": [0, 0, 0, 0.95, 0, 0],
  "버전":       [0, 0, 0, 0.80, 0, 0],
  "설치":       [0, 0, 0, 0.70, 0, 0],
  "재부팅":     [0, 0, 0, 0.60, 0, 0],

  // 4. 구매/환불/배송
  "환불":   [0, 0, 0, 0, 1.00, 0],
  "반품":   [0, 0, 0, 0, 0.95, 0],
  "교환":   [0, 0, 0, 0, 0.85, 0],
  "배송":   [0, 0, 0, 0, 0.90, 0],
  "구매":   [0, 0, 0, 0, 0.85, 0],
  "영수증": [0, 0, 0, 0, 0.80, 0],
  "수령":   [0, 0, 0, 0, 0.75, 0],
  "보증":   [0, 0, 0, 0, 0.70, 0],
  "접수":   [0, 0, 0, 0, 0.55, 0],
  "신청":   [0, 0, 0, 0, 0.50, 0],

  // 5. 키보드/입력
  "키보드": [0, 0, 0, 0, 0, 1.00],
  "자판":   [0, 0, 0, 0, 0, 0.90],
  "키캡":   [0, 0, 0, 0, 0, 0.85],
  "타이핑": [0, 0, 0, 0, 0, 0.85],
  "입력":   [0, 0, 0, 0, 0, 0.70]
};

// ── 원문 문서 ──────────────────────────────────────────────────
// 노트북 고객지원 문서 톤. 세 가지 함정이 의도적으로 심어져 있다.
//   ① 경계 함정   — d4의 환불 기한 문장이 기본 설정(300자/50자)에서 두 청크로 잘린다
//   ② 동의어 함정 — d1은 "충전"이라는 단어를 한 번도 쓰지 않는다 → Sparse 점수 0
//   ③ 모델명 함정 — XPS-9520은 개념 사전에 없다 → Dense가 못 본다
const RAG_DOCS = [
  {
    id: "d1",
    title: "배터리 사용 시간 안내",
    source: "지원센터 > 전원",
    // 동의어 함정: "충전", "닳다", "금방" 같은 표현을 일부러 한 번도 쓰지 않고
    // "완충", "지속 시간"으로만 서술한다. 질문 q2가 여기서 Sparse 0점이 된다.
    text:
      "노트북을 오래 사용하다 보면 완충 상태에서의 지속 시간이 처음 구매했을 때보다 눈에 띄게 " +
      "짧아지는 현상이 나타납니다. 이는 고장이 아니라 리튬이온 셀이 나이를 먹으면서 생기는 " +
      "자연스러운 변화입니다. 보통 500회 정도의 사이클을 지나면 설계 용량의 80% 수준까지 " +
      "내려앉는 것으로 보고되어 있습니다.\n\n" +
      "지속 시간을 조금이라도 늘리려면 화면 밝기를 낮추고 절전 모드를 켜는 것이 가장 효과가 " +
      "큽니다. 밝기는 전체 소비 전력에서 차지하는 비중이 커서 한 단계만 낮춰도 체감 차이가 " +
      "납니다. 백그라운드에서 계속 도는 프로그램을 정리하고, 쓰지 않는 무선 기능을 꺼 두는 " +
      "것도 도움이 됩니다.\n\n" +
      "전원 어댑터를 항상 꽂아 둔 채로만 사용하면 잔량이 100% 부근에 계속 머물러 셀에 부담이 " +
      "갑니다. 하루 종일 책상에서만 쓰는 환경이라면 지원 프로그램에서 상한을 80%로 제한하는 " +
      "기능을 켜 두시는 편이 낫습니다. 반대로 몇 달씩 보관만 할 때는 절반 정도 채운 상태로 " +
      "서늘한 곳에 두는 것이 좋습니다.\n\n" +
      "잔량 표시가 갑자기 튀거나 방전이 비정상적으로 빠르게 진행된다면 전원 관리 회로의 보정이 " +
      "어긋난 경우일 수 있습니다. 이때는 완전 방전 후 완충을 한 번 수행하면 표시가 다시 맞아 " +
      "들어가는 경우가 많습니다. 그래도 개선되지 않고 부풀어 오르는 느낌이 있다면 즉시 사용을 " +
      "멈추고 배터리 교체 점검을 받으십시오."
  },
  {
    id: "d2",
    title: "발열과 팬 소음 문제 해결",
    source: "지원센터 > 하드웨어",
    text:
      "고사양 작업을 시작하면 본체가 뜨거워지고 냉각 장치가 빠르게 회전하면서 소음이 커집니다. " +
      "내부 온도가 설계 상한에 가까워지면 시스템이 스스로 성능을 조금 낮추어 온도를 관리하기 " +
      "때문에, 게임이나 영상 편집 도중 속도가 떨어지는 것처럼 느껴질 수 있습니다.\n\n" +
      "소음이 유난히 크다고 느껴지면 먼저 바닥의 통풍구가 막히지 않았는지 확인하십시오. " +
      "침대나 무릎 위처럼 푹신한 곳에 올려 두면 공기가 들어갈 자리가 없어 팬 회전 속도가 " +
      "계속 올라갑니다. 딱딱한 책상 위에서 쓰거나 받침대를 받쳐 두는 것만으로도 온도가 " +
      "눈에 띄게 내려가고 소리도 함께 잦아듭니다.\n\n" +
      "아무 작업도 하지 않는데 팬 소리가 계속 난다면 백그라운드 프로그램이 자원을 쓰고 있을 " +
      "가능성이 높습니다. 작업 관리자에서 점유율이 높은 항목을 확인해 보십시오. 1년 이상 " +
      "사용한 제품은 통풍구와 방열판에 먼지가 쌓여 냉각 성능이 떨어지므로 정기적인 청소를 " +
      "권장합니다.\n\n" +
      "키보드 위쪽 면이 특히 뜨겁게 느껴지는 것은 그 아래에 주요 발열 부품이 배치되어 있기 " +
      "때문입니다. 자판을 오래 두드려도 타이핑에 지장이 없을 정도라면 정상 범위로 보셔도 " +
      "됩니다. 다만 손을 대기 어려울 만큼 뜨겁거나, 소음이 갑자기 금속성으로 바뀌었다면 " +
      "팬 베어링 손상을 의심할 수 있으니 점검이 필요합니다."
  },
  {
    id: "d3",
    title: "화면 이상과 소프트웨어 업데이트",
    source: "지원센터 > 디스플레이",
    // 모델명 함정: XPS-9520은 개념 사전에 없는 기호라 Dense가 못 본다.
    // 게다가 이 문단은 화면·팬 이야기가 섞여 있어 '순수한 업데이트 문단'보다 벡터가 흐려진다.
    text:
      "소프트웨어 업데이트는 지원 프로그램을 실행해 최신 버전을 확인하고 설치하는 순서로 " +
      "진행합니다. 그래픽 드라이버, 칩셋 드라이버, 시스템 소프트웨어를 모두 최신 버전으로 " +
      "맞춘 뒤 재부팅하십시오. 업데이트 도중에는 전원을 끄지 마시고, 설치가 끝날 때까지 " +
      "기다려 주십시오. 버전이 꼬였다고 판단되면 이전 버전을 제거한 뒤 재설치하는 방법도 " +
      "있습니다.\n\n" +
      "화면이 주기적으로 깜빡이거나 순간적으로 어두워진다면 대부분은 패널 고장이 아닙니다. " +
      "특정 밝기 구간에서만 깜빡임이 나타나는 경우도 있는데, 이는 백라이트를 제어하는 " +
      "방식과 화면 주사율이 서로 맞지 않아 생기는 현상입니다. 밝기를 한두 단계 올리거나 " +
      "내렸을 때 증상이 사라진다면 이 경우에 해당합니다.\n\n" +
      "XPS-9520 모델은 초기 출고 물량에서 깜빡임 보고가 유난히 많았던 제품입니다. 이 모델에는 " +
      "화면 밝기 제어 로직과 팬 제어 로직을 함께 손본 전용 펌웨어가 따로 배포되어 있으니, " +
      "깜빡임이 보인다면 이것부터 올려 보십시오. 적용 후에는 밝기 단계가 이전보다 촘촘하게 " +
      "나뉘고 팬 소리도 조금 줄어드는 것이 정상입니다.\n\n" +
      "밝기를 조절해도, 전용 펌웨어를 올려도 잔상이나 세로줄이 그대로 남아 있다면 화면 패널 " +
      "자체의 결함일 가능성이 큽니다. 이 경우에는 증상이 보이는 사진을 첨부해 서비스센터 " +
      "점검을 요청해 주십시오."
  },
  {
    id: "d4",
    title: "구매, 배송, 환불 규정",
    source: "고객센터 > 주문",
    // 경계 함정: 아래 "환불 신청은 …" 문장(72자)이 기본 설정(300자/겹침 50자)에서
    // 정확히 청크 경계에 걸리도록 앞 문단 길이를 맞춰 두었다.
    // 문장 시작 위치가 240~250 구간에 들어와야 한다 — verify-corpus.js로 검증한다.
    text:
      "주문하신 제품은 결제 확인 후 영업일 기준 이틀 안에 출고됩니다. 배송 조회 번호는 출고 " +
      "시점에 문자로 안내해 드리며, 지역에 따라 도착까지 하루에서 사흘이 더 걸릴 수 있습니다. " +
      "도서 산간 지역은 추가 비용이 붙을 수 있으니 주문 단계의 안내 문구를 꼭 확인해 주십시오. " +
      "배송 현황은 마이페이지에서도 조회하실 수 있습니다.\n\n" +
      "제품을 받으신 뒤 외관 손상이나 구성품 누락이 있으면 개봉 상태 그대로 사진을 찍어 " +
      "고객센터로 접수해 주십시오. 환불 신청은 제품 수령일로부터 14일 이내에 접수해야 하며, " +
      "개봉 흔적이 없고 구성품이 모두 들어 있어야 전액 환불이 가능합니다. 이 기간을 넘기면 " +
      "감가를 적용한 부분 환불만 가능합니다.\n\n" +
      "단순 변심에 따른 반품은 왕복 배송비를 구매자가 부담합니다. 제품 하자로 인한 반품이나 " +
      "교환은 배송비를 회사가 부담하며, 영수증이 없어도 주문 번호만 확인되면 처리됩니다. " +
      "교환은 동일 모델의 재고가 있을 때만 가능하고, 재고가 없으면 환불로 전환됩니다.\n\n" +
      "보증 기간은 수령일로부터 1년입니다. 소모품과 사용자 과실로 인한 파손은 보증 대상에서 " +
      "제외되며, 액체 유입이나 낙하 흔적이 확인되면 유상 수리로 안내됩니다. 보증 기간이 지난 " +
      "뒤에도 유상 수리는 계속 가능합니다."
  }
];

// ── 프리셋 질문 ────────────────────────────────────────────────
// teach: 화면 해설 배너에 그대로 뜨는 문장 (강사 대사를 대신한다)
// evidence: 이 문자열이 프롬프트에 들어와야 제대로 된 답이 나온다고 본다.
//           (실제 LLM을 부르지 않으므로, 답변은 미리 두 가지만 써 둔다)
const RAG_QUERIES = [
  {
    id: "q1",
    text: "배터리가 빨리 닳아요",
    tag: "기준선",
    teach: "질문의 단어가 문서에 그대로 있습니다. 이럴 때는 두 방식 모두 잘 찾아옵니다.",
    answerDoc: "d1",
    evidence: "500회",
    answerGood:
      "리튬이온 셀은 500회 정도의 사이클을 지나면 설계 용량의 80% 수준으로 내려앉습니다. " +
      "고장이 아니라 자연스러운 노화입니다. 화면 밝기를 낮추고 절전 모드를 켜면 사용 시간을 늘릴 수 있습니다.",
    answerPoor:
      "배터리 사용 시간이 줄어드는 현상에 대한 내용은 찾았지만, 얼마나 줄어드는 것이 정상인지에 대한 " +
      "구체적인 기준이 검색된 내용에 없습니다."
  },
  {
    id: "q2",
    text: "충전해도 얼마 못 써요",
    tag: "Sparse가 지는 장면",
    teach: "문서에는 '충전'이라는 단어가 한 번도 없습니다. 키워드 검색은 아무것도 못 찾았고, 의미 검색은 같은 뜻이라는 걸 알아봤습니다.",
    answerDoc: "d1",
    evidence: "지속 시간",
    answerGood:
      "완충 후 지속 시간이 짧아지는 것은 셀 노화로 생기는 자연스러운 변화입니다. " +
      "밝기를 낮추고 절전 모드를 켜는 것이 가장 효과가 크며, 잔량 표시가 튀거나 방전이 지나치게 빠르면 " +
      "완전 방전 후 완충을 한 번 해 보시길 권합니다.",
    answerPoor:
      "검색된 내용에는 사용 시간이 짧아지는 이유에 대한 설명이 들어 있지 않습니다. " +
      "질문에 답하기 어렵습니다."
  },
  {
    id: "q3",
    text: "XPS-9520 펌웨어 업데이트",
    tag: "Dense가 지는 장면",
    teach: "모델명은 뜻이 없는 기호입니다. 의미 검색은 그냥 '업데이트 이야기'로만 알아듣고 엉뚱한 문단을 올렸습니다. 키워드 검색은 정확히 짚었습니다.",
    answerDoc: "d3",
    evidence: "XPS-9520",
    answerGood:
      "XPS-9520은 초기 출고 물량에서 깜빡임 보고가 많아 전용 펌웨어가 따로 배포되어 있습니다. " +
      "일반 업데이트와 별도로 이 펌웨어를 설치하셔야 하며, 적용 후에는 밝기 단계가 더 촘촘하게 나뉘는 것이 정상입니다.",
    answerPoor:
      "일반적인 소프트웨어 업데이트 절차는 확인되지만, XPS-9520 모델에 대한 내용은 검색된 내용에 " +
      "포함되어 있지 않아 이 모델에 해당하는 답을 드릴 수 없습니다."
  },
  {
    id: "q4",
    text: "환불은 언제까지 신청해요?",
    tag: "청킹에 달린 장면",
    teach: "답은 문서에 분명히 있습니다. 다만 그 문장이 청크 경계에서 잘렸다면, 검색이 아무리 잘돼도 답을 만들 수 없습니다.",
    answerDoc: "d4",
    // 문장 전체가 한 청크 안에 온전히 들어와야 답이 된다.
    // 일부만 걸치면 "며칠 이내인지"나 "조건이 무엇인지" 중 하나가 빠진다.
    evidence: "환불 신청은 제품 수령일로부터 14일 이내에 접수해야 하며, 개봉 흔적이 없고 구성품이 모두 들어 있어야 전액 환불이 가능합니다.",
    answerGood:
      "제품 수령일로부터 14일 이내에 접수하셔야 합니다. 개봉 흔적이 없고 구성품이 모두 들어 있어야 " +
      "전액 환불이 가능하며, 이 기간을 넘기면 감가를 적용한 부분 환불만 가능합니다.",
    answerPoor:
      "환불에 대한 내용은 찾았지만 문장이 중간에서 끊겨 있어, 기한이 며칠인지와 조건이 무엇인지를 " +
      "확실하게 말씀드릴 수 없습니다."
  },
  {
    id: "q5",
    text: "팬 소리가 시끄러워요",
    tag: "둘을 섞는 장면",
    teach: "둘 다 어느 정도 찾아내지만 1등이 다릅니다. 이럴 때 두 점수를 섞으면 더 안정적인 순위가 나옵니다.",
    answerDoc: "d2",
    evidence: "통풍구",
    answerGood:
      "먼저 바닥의 통풍구가 막히지 않았는지 확인해 보세요. 침대나 무릎 위처럼 푹신한 곳에 올려 두면 " +
      "공기가 들어갈 자리가 없어 팬 회전 속도가 계속 올라갑니다. 1년 이상 사용하셨다면 먼지 청소도 권장합니다.",
    answerPoor:
      "소음이 커지는 상황에 대한 언급은 있으나, 무엇을 확인하고 어떻게 조치해야 하는지가 검색된 내용에 " +
      "들어 있지 않습니다."
  }
];

// 청킹 단계에서 "이 문장이 잘렸는가"를 판정할 정답 문장 (질문 q4와 짝)
const RAG_ANSWER_SENTENCE =
  "환불 신청은 제품 수령일로부터 14일 이내에 접수해야 하며, 개봉 흔적이 없고 구성품이 모두 들어 있어야 전액 환불이 가능합니다.";

const RAG_CHUNK_DEFAULTS = { size: 300, overlap: 50, mode: "fixed" };

const RAG_MODE_LABEL = { fixed: "고정 길이", sentence: "문장 경계", paragraph: "문단 경계" };

// ── 토크나이즈 (Sparse 검색용) ─────────────────────────────────
// 형태소 분석기 없이 어절을 쪼개고 흔한 조사만 떼어 낸다. 완벽할 필요는 없다 —
// 프리셋 질문과 코퍼스가 이 규칙에서 의도대로 동작하도록 데이터를 맞춰 두었다.
const PARTICLES = ["으로", "에서", "까지", "부터", "에게", "이나", "라도", "은", "는", "이", "가", "을", "를", "에", "의", "도", "만", "와", "과", "로", "요"];

function ragTokenize(text) {
  const raw = String(text).toLowerCase().split(/[^0-9a-z가-힣\-]+/);
  const out = [];
  for (const w of raw) {
    if (!w) continue;
    let t = w;
    // 모델명·코드(XPS-9520 같은 것)는 그대로 둔다. 조사를 떼면 오히려 망가진다.
    if (!/[가-힣]/.test(t)) {
      if (t.length >= 2) out.push(t);
      continue;
    }
    for (const p of PARTICLES) {
      if (t.length > p.length + 1 && t.endsWith(p)) { t = t.slice(0, -p.length); break; }
    }
    if (t.length >= 2) out.push(t);
  }
  return out;
}

// ── 청킹 ───────────────────────────────────────────────────────
// 세 가지 방식 모두 {start, end, text}를 돌려준다. start/end는 원문 문자 인덱스라
// 청킹 페이지에서 원문 위에 경계를 그대로 칠할 수 있다.
function ragChunkDoc(doc, size, overlap, mode) {
  const text = doc.text;
  // 겹침이 크기 이상이면 앞으로 나아가질 못해 청크가 무한정 늘어난다.
  // 호출하는 쪽(저장된 설정 등)을 믿지 말고 여기서 항상 눌러 둔다.
  const safeOverlap = Math.max(0, Math.min(overlap, size - 20));
  let spans;
  if (mode === "paragraph") spans = chunkByParagraph(text, size);
  else if (mode === "sentence") spans = chunkBySentence(text, size, safeOverlap);
  else spans = chunkFixed(text, size, safeOverlap);

  return spans.map((s, i) => ({
    id: `${doc.id}-${i}`,
    docId: doc.id,
    docTitle: doc.title,
    index: i,
    start: s.start,
    end: s.end,
    text: text.slice(s.start, s.end)
  }));
}

// 고정 길이: 글자 수만 세고 자른다. 가장 흔하고, 가장 쉽게 문장을 두 동강 낸다.
function chunkFixed(text, size, overlap) {
  const step = Math.max(1, size - overlap);
  const spans = [];
  for (let start = 0; start < text.length; start += step) {
    const end = Math.min(text.length, start + size);
    spans.push({ start, end });
    if (end >= text.length) break;
  }
  return spans;
}

// 문장 경계: 문장을 절대 쪼개지 않고 size를 넘기 직전까지 담는다.
// overlap만큼은 앞 청크의 마지막 문장들을 다시 넣어 맥락을 잇는다.
function chunkBySentence(text, size, overlap) {
  const sents = splitSentences(text);
  const spans = [];
  let cur = [];
  let curLen = 0;

  const flush = () => {
    if (!cur.length) return;
    spans.push({ start: cur[0].start, end: cur[cur.length - 1].end });
  };

  for (const s of sents) {
    const sLen = s.end - s.start;
    if (curLen > 0 && curLen + sLen > size) {
      flush();
      // 뒤에서부터 overlap 글자만큼 문장을 되가져온다
      const carry = [];
      let carryLen = 0;
      for (let i = cur.length - 1; i >= 0; i--) {
        const len = cur[i].end - cur[i].start;
        if (carryLen + len > overlap) break;
        carry.unshift(cur[i]);
        carryLen += len;
      }
      cur = carry;
      curLen = carryLen;
    }
    cur.push(s);
    curLen += sLen;
  }
  flush();
  return spans;
}

// 문단 경계: 빈 줄로 나눈다. 너무 짧은 문단은 다음 문단과 합친다.
function chunkByParagraph(text, size) {
  const spans = [];
  let pos = 0;
  const parts = text.split("\n\n");
  for (const p of parts) {
    const start = pos;
    pos += p.length + 2;
    const end = Math.min(text.length, start + p.length);
    const last = spans[spans.length - 1];
    if (last && (last.end - last.start) + (end - start) < size * 0.6) last.end = end;
    else spans.push({ start, end });
  }
  return spans;
}

// 문장 분리: 마침표/물음표/느낌표 뒤 공백, 그리고 문단 경계에서 끊는다.
function splitSentences(text) {
  const out = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const isEnd = (c === "." || c === "?" || c === "!") && (i + 1 >= text.length || /[\s]/.test(text[i + 1]));
    const isBreak = c === "\n" && text[i + 1] === "\n";
    if (isEnd || isBreak) {
      let end = i + 1;
      while (end < text.length && /\s/.test(text[end])) end++;
      if (end > start) out.push({ start, end });
      start = end;
      i = end - 1;
    }
  }
  if (start < text.length) out.push({ start, end: text.length });
  return out;
}

// 문서 전체를 한 번에 청킹
function ragBuildChunks(size, overlap, mode) {
  const all = [];
  for (const doc of RAG_DOCS) all.push(...ragChunkDoc(doc, size, overlap, mode));
  return all;
}

// ── 임베딩 (미니 개념벡터) ─────────────────────────────────────
// 텍스트 안에 등장한 개념어들의 벡터 평균. 실제 임베딩 모델이 하는 일과 구조가 같고,
// 청크가 어떻게 잘리든 벡터가 따라 계산된다는 점이 중요하다.
function ragEmbed(text) {
  const v = new Array(RAG_AXES.length).fill(0);
  let hits = 0;
  for (const word in CONCEPT_LEXICON) {
    let from = 0;
    let count = 0;
    while (true) {
      const at = text.indexOf(word, from);
      if (at === -1) break;
      count++;
      from = at + word.length;
      if (count >= 3) break;   // 같은 단어가 많이 나와도 한 청크가 독점하지 않게 상한
    }
    if (!count) continue;
    const vec = CONCEPT_LEXICON[word];
    // 등장 횟수는 제곱근으로 눌러 담는다 (긴 청크가 무조건 이기지 않도록)
    const w = Math.sqrt(count);
    for (let i = 0; i < v.length; i++) v[i] += vec[i] * w;
    hits += w;
  }
  return { vec: normalize(v), hits };
}

function normalize(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  if (n === 0) return v.slice();
  return v.map(x => x / n);
}

function ragCosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// 6차원 → 2차원 고정 투영. 런타임 PCA를 쓰면 문서가 매번 다른 자리에 찍혀
// 강의 중 설명이 흔들린다. 축마다 방향을 손으로 정해 두었다 (대략 육각형).
const PROJECTION = [
  [-0.90,  0.50],   // 배터리/전원
  [ 0.20,  1.00],   // 발열/소음
  [ 1.00,  0.30],   // 화면/디스플레이
  [ 0.80, -0.80],   // 소프트웨어/업데이트
  [-0.50, -1.00],   // 구매/환불/배송
  [-1.00, -0.20]    // 키보드/입력
];

function ragProject2d(vec) {
  let x = 0, y = 0;
  for (let i = 0; i < vec.length; i++) {
    x += vec[i] * PROJECTION[i][0];
    y += vec[i] * PROJECTION[i][1];
  }
  return { x, y };
}

// ── BM25 (Sparse 검색) ─────────────────────────────────────────
// 교과서 그대로. 페이지에 수식은 띄우지 않지만 계산은 진짜로 한다.
function ragBuildBm25(chunks, k1 = 1.5, b = 0.75) {
  const docs = chunks.map(c => ragTokenize(c.text));
  const N = docs.length;
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / Math.max(1, N);

  const df = new Map();
  const tf = docs.map(d => {
    const m = new Map();
    for (const t of d) m.set(t, (m.get(t) || 0) + 1);
    for (const t of m.keys()) df.set(t, (df.get(t) || 0) + 1);
    return m;
  });

  const idf = t => {
    const n = df.get(t) || 0;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  };

  // 점수와 함께 "어떤 단어가 얼마나 기여했는지"를 돌려준다 — 하이라이트/칩의 근거가 된다.
  function score(queryTokens, i) {
    const len = docs[i].length;
    let total = 0;
    const parts = [];
    for (const t of new Set(queryTokens)) {
      const f = tf[i].get(t) || 0;
      if (!f) continue;
      const contrib = idf(t) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * len / avgLen));
      total += contrib;
      parts.push({ term: t, count: f, contrib });
    }
    parts.sort((x, y) => y.contrib - x.contrib);
    return { score: total, parts };
  }

  return { score, idf, df, N, avgLen, docTokens: docs };
}

// ── 페이지 간 설정 공유 ────────────────────────────────────────
// 청킹 페이지에서 만진 값을 색인/검색 페이지가 이어받는다.
const SETTINGS_KEY = "rag-viz-chunk-settings";

function ragLoadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...RAG_CHUNK_DEFAULTS, inherited: false };
    const s = JSON.parse(raw);
    return {
      size: clampNum(s.size, 100, 600, RAG_CHUNK_DEFAULTS.size),
      overlap: clampNum(s.overlap, 0, 150, RAG_CHUNK_DEFAULTS.overlap),
      mode: RAG_MODE_LABEL[s.mode] ? s.mode : RAG_CHUNK_DEFAULTS.mode,
      inherited: true
    };
  } catch (e) {
    return { ...RAG_CHUNK_DEFAULTS, inherited: false };
  }
}

function ragSaveSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ size: s.size, overlap: s.overlap, mode: s.mode }));
  } catch (e) { /* 사생활 보호 모드 등에서 실패할 수 있다. 무시해도 페이지는 동작한다 */ }
}

function clampNum(v, lo, hi, fallback) {
  const n = Number(v);
  if (!isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

// node에서 검증 스크립트를 돌릴 때만 쓰인다 (브라우저에서는 무시됨)
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    RAG_AXES, RAG_DOCS, RAG_QUERIES, RAG_CHUNK_DEFAULTS, RAG_ANSWER_SENTENCE, RAG_MODE_LABEL,
    ragTokenize, ragChunkDoc, ragBuildChunks, ragEmbed, ragCosine, ragProject2d, ragBuildBm25
  };
}

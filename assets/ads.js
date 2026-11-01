// TacLog affiliate ads ("PR"). Paste the links you get from A8.net / もしもアフィリエイト into ITEMS below.
// Only items with a url are shown. Paid teams see no ads inside the app.
//
//   cat:   pc | capture | mic | camera | mouse | keyboard | headset | monitor | net | other (other = only in the side banner columns)
//   title: product name shown on the card            note: one short line on why it helps (written by you)
//   url:   the affiliate link (https://...)          pixel: optional impression image URL that A8.net gives with the link
//   img:   optional banner image URL (A8.net "バナー" ads); shown instead of the text card
//   wide:  true for 728x90 banners: shown only in the horizontal slots (bottom of pages), not in cards or side columns
//   hold:  true = not shown for now (kept for later, e.g. while Riot reviews the product)
//   price: optional, e.g. "¥12,800"(prices change, so leave it empty if unsure)
window.TACLOG_ADS = {
  ITEMS: [
    // { cat: "pc", title: "ゲーミングPC ○○", note: "配信しながら録画してもカクつきにくい", url: "https://px.a8.net/...", pixel: "" },
    { cat: "pc", title: "ゲーミングPC(MDL)", note: "配信・録画もするなら、性能に余裕のあるBTOパソコンを",
      url: "https://px.a8.net/svt/ejp?a8mat=4BGAV1+AC3XV6+5HXK+5YZ75",
      img: "https://www28.a8.net/svt/bgt?aid=261101053625&wid=001&eno=01&mid=s00000025652001003000&mc=1",
      pixel: "https://www10.a8.net/0.gif?a8mat=4BGAV1+AC3XV6+5HXK+5YZ75" },
    { cat: "pc", title: "ゲーミングPC(OZ)", note: "構成を選んで注文できるBTOゲーミングPC",
      url: "https://px.a8.net/svt/ejp?a8mat=4BGAV1+AF33W2+5U1O+5YZ75",
      img: "https://www20.a8.net/svt/bgt?aid=261101053630&wid=001&eno=01&mid=s00000027222001003000&mc=1",
      pixel: "https://www10.a8.net/0.gif?a8mat=4BGAV1+AF33W2+5U1O+5YZ75" },
    { cat: "other", hold: true, title: "GEMY(オンラインゲームで景品ゲット)", note: "無料で始められるオンラインゲームサイト",
      url: "https://px.a8.net/svt/ejp?a8mat=4BGAV1+B0IPO2+1J3M+NV1XD",
      img: "https://www25.a8.net/svt/bgt?aid=261101053666&wid=001&eno=01&mid=s00000007141004008000&mc=1",
      pixel: "https://www18.a8.net/0.gif?a8mat=4BGAV1+B0IPO2+1J3M+NV1XD" },
    { cat: "other", wide: true, hold: true, title: "GEMY(オンラインゲームで景品ゲット)",
      url: "https://px.a8.net/svt/ejp?a8mat=4BGAV1+B0IPO2+1J3M+NY1Y9",
      img: "https://www25.a8.net/svt/bgt?aid=261101053666&wid=001&eno=01&mid=s00000007141004022000&mc=1",
      pixel: "https://www14.a8.net/0.gif?a8mat=4BGAV1+B0IPO2+1J3M+NY1Y9" },
    { cat: "monitor", title: "Pixio ゲーミングモニター", note: "SNSで話題のカラフルなゲーミングモニター",
      url: "https://px.a8.net/svt/ejp?a8mat=4BGAV1+A4DB02+XTI+15RZIP",
      img: "https://www22.a8.net/svt/bgt?aid=261101053612&wid=001&eno=01&mid=s00000004383007017000&mc=1",
      pixel: "https://www18.a8.net/0.gif?a8mat=4BGAV1+A4DB02+XTI+15RZIP" },
  ],
  // which categories each place shows
  PLACES: {
    guide: ["pc", "capture", "net"],                       // OBS guide: when recording is heavy
    dash: ["mouse", "keyboard", "headset", "monitor"],     // dashboard (free plan only)
    top: ["pc", "monitor", "mouse", "headset", "capture"],            // top page
  },
};

window.TLAds = (function () {
  const CAT = { other: "ゲーム", pc: "ゲーミングPC", capture: "キャプチャーボード", mic: "マイク", camera: "Webカメラ", mouse: "マウス", keyboard: "キーボード", headset: "ヘッドセット", monitor: "モニター", net: "回線" };
  const ok = (u) => /^https:\/\//.test(String(u || ""));
  const live = () => window.TACLOG_ADS.ITEMS.filter((x) => !x.hold);
  function items(place, max) {
    const cats = (window.TACLOG_ADS.PLACES[place] || []);
    return live().filter((x) => ok(x.url) && !x.wide && (!place || cats.includes(x.cat))).slice(0, max || 4);
  }
  function card(x) {
    const { h } = TL;
    const a = h("a", { class: "adcard", href: x.url, target: "_blank", rel: "sponsored noopener" },
      h("span", { class: "adcat" }, CAT[x.cat] || x.cat),
      ok(x.img) ? h("img", { src: x.img, alt: x.title, loading: "lazy", class: "adimg" }) : null,
      h("strong", {}, x.title), x.note ? h("span", { class: "small muted" }, x.note) : null, x.price ? h("span", { class: "adprice" }, x.price) : null);
    if (ok(x.pixel)) a.append(h("img", { src: x.pixel, width: "1", height: "1", alt: "", style: "position:absolute;width:1px;height:1px;opacity:0" }));
    return a;
  }
  // Logged-in members of a paid team never see ads (on any page).
  let paidP = null;
  function isPaid() {
    if (!paidP) paidP = (async () => { try { if (!TL.sb || !(await TL.session())) return false; const ts = await TL.myTeams(); return (ts || []).some((t) => t.plan && t.plan !== "free"); } catch (e) { return false; } })();
    return paidP;
  }
  // Fill a container. Leaves it hidden when there is nothing to show or the viewer is on a paid plan.
  function fill(el, place, opts) {
    if (!el) return false;
    el.hidden = true;
    isPaid().then((paid) => { if (!paid) show(el, place, opts); });
    return true;
  }
  function show(el, place, opts) {
    const list = items(place, (opts && opts.max) || 4);
    if (!list.length) { el.hidden = true; return false; }
    const { h } = TL;
    el.hidden = false; el.className = "adbox";
    el.replaceChildren(
      h("div", { class: "adhead" }, h("span", { class: "adpr" }, "PR"), h("strong", {}, (opts && opts.title) || "おすすめ機材"), h("a", { href: "/gear", class: "small" }, "もっと見る")),
      h("div", { class: "adgrid" }, list.map(card)),
      h("p", { class: "small muted", style: "margin:0" }, "広告(アフィリエイト)です。リンクから購入されると、TacLogの運営費になります。"));
    return true;
  }
  // Banner column in the empty space right of the content on wide screens. Hidden on narrow screens and for paid teams.
  function rail() {
    const all = live().filter((x) => ok(x.url) && !x.wide);
    if (!all.length || document.getElementById("adRail")) return;
    isPaid().then((paid) => {
      if (paid) return;
      const { h } = TL;
      const big = all.filter((x) => ok(x.img)), rest = all.filter((x) => !ok(x.img));
      const right = big.concat(rest);   // all banners in one column on the right (the left side is kept free for the app, e.g. question history)
      const col = (id, side, list) => h("aside", { id, class: "adrail " + side, "aria-label": "広告" },
        h("div", { class: "adhead" }, h("span", { class: "adpr" }, "PR"), h("a", { href: "/gear", class: "small" }, "おすすめ機材")), ...list.slice(0, 4).map(card));
      const els = [col("adRail", "r", right)];
      els.forEach((e) => document.body.append(e));
      // sit at the screen edges, and only where there is room next to the page content (never on top of it)
      const fit = () => {
        const m = document.querySelector("main"), r = m ? m.getBoundingClientRect() : { left: 0, right: window.innerWidth };
        const cs = m ? getComputedStyle(m) : null, padL = cs ? parseFloat(cs.paddingLeft) || 0 : 0, padR = cs ? parseFloat(cs.paddingRight) || 0 : 0;
        const left = r.left + padL, right = window.innerWidth - (r.right - padR);
        els.forEach((e) => { e.hidden = right < 300 + 40; });
      };
      fit(); window.addEventListener("resize", fit);
    });
  }
  // Horizontal 728x90 banner slot (e.g. at the bottom of a page). Picks one wide banner at random.
  function wide(el) {
    if (!el) return;
    el.hidden = true;
    const list = live().filter((x) => ok(x.url) && x.wide && ok(x.img));
    if (!list.length) return;
    isPaid().then((paid) => {
      if (paid) return;
      const { h } = TL, x = list[Math.floor(Math.random() * list.length)];
      const a = h("a", { href: x.url, target: "_blank", rel: "sponsored noopener", class: "adwide" }, h("img", { src: x.img, alt: x.title, loading: "lazy" }));
      if (ok(x.pixel)) a.append(h("img", { src: x.pixel, width: "1", height: "1", alt: "", style: "position:absolute;width:1px;height:1px;opacity:0" }));
      el.className = "adwidebox"; el.hidden = false;
      el.replaceChildren(h("span", { class: "adpr" }, "PR"), a);
    });
  }
  return { fill, items, card, CAT, isPaid, rail, wide, live };
})();

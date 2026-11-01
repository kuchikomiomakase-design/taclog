// TacLog affiliate ads ("PR"). Paste the links you get from A8.net / もしもアフィリエイト into ITEMS below.
// Only items with a url are shown. Paid teams see no ads inside the app.
//
//   cat:   pc | capture | mic | camera | mouse | keyboard | headset | monitor | net
//   title: product name shown on the card            note: one short line on why it helps (written by you)
//   url:   the affiliate link (https://...)          pixel: optional impression image URL that A8.net gives with the link
//   img:   optional banner image URL (A8.net "バナー" ads); shown instead of the text card
//   price: optional, e.g. "¥12,800"(prices change, so leave it empty if unsure)
window.TACLOG_ADS = {
  ITEMS: [
    // { cat: "pc", title: "ゲーミングPC ○○", note: "配信しながら録画してもカクつきにくい", url: "https://px.a8.net/...", pixel: "" },
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
  const CAT = { pc: "ゲーミングPC", capture: "キャプチャーボード", mic: "マイク", camera: "Webカメラ", mouse: "マウス", keyboard: "キーボード", headset: "ヘッドセット", monitor: "モニター", net: "回線" };
  const ok = (u) => /^https:\/\//.test(String(u || ""));
  function items(place, max) {
    const cats = (window.TACLOG_ADS.PLACES[place] || []);
    return window.TACLOG_ADS.ITEMS.filter((x) => ok(x.url) && (!place || cats.includes(x.cat))).slice(0, max || 4);
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
  // Right-hand banner column on wide screens (the empty space beside the 1000px content). Hidden on narrow screens and for paid teams.
  function rail() {
    const all = window.TACLOG_ADS.ITEMS.filter((x) => ok(x.url));
    if (!all.length || document.getElementById("adRail")) return;
    isPaid().then((paid) => {
      if (paid) return;
      const { h } = TL;
      const pick = all.filter((x) => ok(x.img)).concat(all.filter((x) => !ok(x.img))).slice(0, 3);
      const el = h("aside", { id: "adRail", class: "adrail", "aria-label": "広告" },
        h("div", { class: "adhead" }, h("span", { class: "adpr" }, "PR"), h("a", { href: "/gear", class: "small" }, "おすすめ機材")),
        ...pick.map(card));
      document.body.append(el);
      const fit = () => { el.hidden = window.innerWidth < 1660; };
      fit(); window.addEventListener("resize", fit);
    });
  }
  return { fill, items, card, CAT, isPaid, rail };
})();

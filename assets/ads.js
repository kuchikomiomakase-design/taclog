// TacLog affiliate ads ("PR"). Paste the links you get from A8.net / もしもアフィリエイト into ITEMS below.
// Only items with a url are shown. Paid teams see no ads inside the app.
//
//   cat:   pc | capture | mic | camera | mouse | keyboard | headset | monitor | net
//   title: product name shown on the card            note: one short line on why it helps (written by you)
//   url:   the affiliate link (https://...)          pixel: optional impression image URL that A8.net gives with the link
//   price: optional, e.g. "¥12,800"(prices change, so leave it empty if unsure)
window.TACLOG_ADS = {
  ITEMS: [
    // { cat: "pc", title: "ゲーミングPC ○○", note: "配信しながら録画してもカクつきにくい", url: "https://px.a8.net/...", pixel: "" },
  ],
  // which categories each place shows
  PLACES: {
    guide: ["pc", "capture", "net"],                       // OBS guide: when recording is heavy
    dash: ["mouse", "keyboard", "headset", "monitor"],     // dashboard (free plan only)
    top: ["pc", "mouse", "headset", "capture"],            // top page
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
      h("span", { class: "adcat" }, CAT[x.cat] || x.cat), h("strong", {}, x.title), x.note ? h("span", { class: "small muted" }, x.note) : null, x.price ? h("span", { class: "adprice" }, x.price) : null);
    if (ok(x.pixel)) a.append(h("img", { src: x.pixel, width: "1", height: "1", alt: "", style: "position:absolute;width:1px;height:1px;opacity:0" }));
    return a;
  }
  // Fill a container. Returns false (and leaves it hidden) when there is nothing to show.
  function fill(el, place, opts) {
    if (!el) return false;
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
  return { fill, items, card, CAT };
})();

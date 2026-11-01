// Round pictures kept on this PC (browser storage for TacLog only, never uploaded), so a question can look at a round later
// even after the recording was deleted. Old ones are removed automatically after the number of days set in Settings.
window.TLSnaps = (function () {
  const supported = !!(navigator.storage && navigator.storage.getDirectory);
  const KEY = "taclog_snap_days";
  const days = () => { try { const v = localStorage.getItem(KEY); return v == null ? 30 : Math.max(0, parseInt(v, 10) || 0); } catch (e) { return 30; } };   // 0 = keep
  const setDays = (n) => { try { localStorage.setItem(KEY, String(n)); } catch (e) {} };
  async function root() { const r = await navigator.storage.getDirectory(); return r.getDirectoryHandle("snaps", { create: true }); }
  async function save(matchId, rounds) {   // rounds: {roundNumber: [Blob, ...]}
    if (!supported || !matchId || !rounds) return;
    try { if (navigator.storage.persist) await navigator.storage.persist(); } catch (e) {}
    const dir = await (await root()).getDirectoryHandle(String(matchId), { create: true });
    const tag = Math.random().toString(36).slice(2, 6);   // another view of the same match gets its own files
    for (const [n, blobs] of Object.entries(rounds)) {
      for (let k = 0; k < blobs.length; k++) { const f = await dir.getFileHandle("r" + n + "_" + tag + "_" + k + ".jpg", { create: true }); const w = await f.createWritable(); await w.write(blobs[k]); await w.close(); }
    }
    const m = await dir.getFileHandle("meta.json", { create: true }); const w = await m.createWritable(); await w.write(JSON.stringify({ saved: Date.now() })); await w.close();
    cleanup().catch(() => {});
  }
  // pictures of one round (all views), in time order; max = most images to return (evenly picked when there are more)
  async function load(matchId, round, max) {
    if (!supported) return [];
    let dir; try { dir = await (await root()).getDirectoryHandle(String(matchId)); } catch (e) { return []; }
    const files = [];
    for await (const [name, hd] of dir.entries()) { const m = name.match(/^r(\d+)_([a-z0-9]+)_(\d+)\.jpg$/); if (m && +m[1] === +round) files.push({ tag: m[2], k: +m[3], hd }); }
    if (!files.length) return [];
    const first = files[0].tag, list = files.filter((f) => f.tag === first).sort((a, b) => a.k - b.k);   // one view is enough to see the round
    const pick = list.length <= (max || 8) ? list : Array.from({ length: max || 8 }, (_, i) => list[Math.round((i * (list.length - 1)) / ((max || 8) - 1))]);
    return Promise.all(pick.map((f) => f.hd.getFile()));
  }
  async function has(matchId) { if (!supported) return false; try { await (await root()).getDirectoryHandle(String(matchId)); return true; } catch (e) { return false; } }
  async function cleanup() {
    if (!supported) return; const d = days(); if (!d) return;
    const r = await root(), limit = Date.now() - d * 864e5, old = [];
    for await (const [name, hd] of r.entries()) {
      if (hd.kind !== "directory") continue;
      try { const f = await (await hd.getFileHandle("meta.json")).getFile(); const meta = JSON.parse(await f.text()); if (meta.saved < limit) old.push(name); } catch (e) { old.push(name); }
    }
    for (const name of old) { try { await r.removeEntry(name, { recursive: true }); } catch (e) {} }
  }
  async function clearAll() { if (!supported) return; const r = await navigator.storage.getDirectory(); try { await r.removeEntry("snaps", { recursive: true }); } catch (e) {} }
  async function usage() { try { const e = await navigator.storage.estimate(); return { used: e.usage || 0, quota: e.quota || 0 }; } catch (e) { return null; } }
  if (supported) setTimeout(() => cleanup().catch(() => {}), 5000);
  return { supported, days, setDays, save, load, has, cleanup, clearAll, usage };
})();

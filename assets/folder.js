// TacLog recording folder link (File System Access API, Chrome / Edge on PC).
// The browser remembers the OBS recording folder; new recordings are found and analyzed on this PC.
window.TLFolder = (function () {
  const supported = typeof window.showDirectoryPicker === "function";
  const DB = "taclog", STORE = "kv";
  const VIDEO = /\.(mp4|mov|mkv|webm|m4v|ts|flv)$/i;

  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function get(k) { try { const db = await idb(); return await new Promise((res, rej) => { const q = db.transaction(STORE).objectStore(STORE).get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); } catch (e) { return undefined; } }
  async function set(k, v) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction(STORE, "readwrite"); t.objectStore(STORE).put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
  async function del(k) { const db = await idb(); return new Promise((res) => { const t = db.transaction(STORE, "readwrite"); t.objectStore(STORE).delete(k); t.oncomplete = () => res(); t.onerror = () => res(); }); }

  async function link() {
    const h = await window.showDirectoryPicker({ id: "taclog-recordings", mode: (await getDeleteAfter()) ? "readwrite" : "read" });
    await set("folder", h); return h;
  }
  async function unlink() { await del("folder"); }
  async function handle() { return (await get("folder")) || null; }
  async function permission(h, ask, mode) {
    const o = { mode: mode || ((await getDeleteAfter()) ? "readwrite" : "read") };
    try { if ((await h.queryPermission(o)) === "granted") return true; if (!ask) return false; return (await h.requestPermission(o)) === "granted"; } catch (e) { return false; }
  }
  // Video files in the folder, newest first. Files changed in the last 90 seconds are skipped (OBS may still be writing them).
  async function videos(h) {
    const out = []; out.stats = { files: 0, others: [] };
    async function scan(dir, prefix, depth) {
      for await (const [name, entry] of dir.entries()) {
        if (entry.kind === "directory") { if (depth < 1) await scan(entry, prefix + name + "/", depth + 1); continue; }
        out.stats.files++;
        if (!VIDEO.test(name)) { if (out.stats.others.length < 5) out.stats.others.push(prefix + name); continue; }
        const file = await entry.getFile();
        out.push({ name: prefix + name, entryName: name, dir, file, size: file.size, mtime: file.lastModified, recording: Date.now() - file.lastModified < 90000 });
      }
    }
    await scan(h, "", 0); // also looks one folder deeper
    return out.sort((a, b) => b.mtime - a.mtime);
  }
  const key = (teamId, v) => teamId + "|" + v.name + "|" + v.size;
  async function doneList() { return (await get("done")) || []; }
  async function isDone(teamId, v) { return (await doneList()).includes(key(teamId, v)); }
  async function markDone(teamId, v) { const d = await doneList(); d.push(key(teamId, v)); await set("done", d.slice(-1000)); }
  // recordings that could not be analyzed (not VALORANT, no rounds…): not retried automatically, so AI is not paid for again and again
  async function failedMap() { return (await get("failed")) || {}; }
  async function failedReason(teamId, v) { return (await failedMap())[key(teamId, v)] || null; }
  async function markFailed(teamId, v, reason) { const m = await failedMap(); m[key(teamId, v)] = String(reason || "分析できませんでした"); const ks = Object.keys(m); if (ks.length > 300) delete m[ks[0]]; await set("failed", m); }
  async function unmarkFailed(teamId, v) { const m = await failedMap(); delete m[key(teamId, v)]; await set("failed", m); }
  async function unmarkDone(teamId, v) { const k = key(teamId, v); await set("done", (await doneList()).filter((x) => x !== k)); }
  // forget every "analyzed" mark for a file name (used when its match is deleted, so the same recording can be analyzed again)
  async function unmarkByFile(teamId, fileName) {
    if (!fileName) return; const base = String(fileName).split("/").pop();
    await set("done", (await doneList()).filter((x) => { if (!x.startsWith(teamId + "|")) return true; const n = x.slice(teamId.length + 1).replace(/\|\d+$/, ""); return n.split("/").pop() !== base; }));
  }
  async function remove(h, name, v) { await ((v && v.dir) || h).removeEntry((v && v.entryName) || name); }
  async function getDeleteAfter() { const v = await get("deleteAfter"); return v === undefined ? true : !!v; } // on by default
  async function setDeleteAfter(v) { await set("deleteAfter", !!v); }
  async function getAuto() { const v = await get("autoAnalyze"); return v === undefined ? true : !!v; } // on by default
  async function setAuto(v) { await set("autoAnalyze", !!v); }

  return { supported, link, unlink, handle, permission, videos, isDone, markDone, unmarkDone, unmarkByFile, failedReason, markFailed, unmarkFailed, remove, getDeleteAfter, setDeleteAfter, getAuto, setAuto };
})();

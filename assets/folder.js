// TacLog recording folder link (File System Access API, Chrome / Edge on PC).
// The browser remembers the OBS recording folder; new recordings are found and analyzed on this PC.
window.TLFolder = (function () {
  const supported = typeof window.showDirectoryPicker === "function";
  const DB = "taclog", STORE = "kv";
  const VIDEO = /\.(mp4|mov|mkv|webm|m4v)$/i;

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
    const out = [];
    for await (const [name, entry] of h.entries()) {
      if (entry.kind !== "file" || !VIDEO.test(name)) continue;
      const file = await entry.getFile();
      out.push({ name, file, size: file.size, mtime: file.lastModified, recording: Date.now() - file.lastModified < 90000 });
    }
    return out.sort((a, b) => b.mtime - a.mtime);
  }
  const key = (teamId, v) => teamId + "|" + v.name + "|" + v.size;
  async function doneList() { return (await get("done")) || []; }
  async function isDone(teamId, v) { return (await doneList()).includes(key(teamId, v)); }
  async function markDone(teamId, v) { const d = await doneList(); d.push(key(teamId, v)); await set("done", d.slice(-1000)); }
  async function remove(h, name) { await h.removeEntry(name); }
  async function getDeleteAfter() { return !!(await get("deleteAfter")); }
  async function setDeleteAfter(v) { await set("deleteAfter", !!v); }

  return { supported, link, unlink, handle, permission, videos, isDone, markDone, remove, getDeleteAfter, setDeleteAfter };
})();

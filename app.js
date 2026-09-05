/* ============================================================
   Thesis Journal — vanilla JS + IndexedDB. No build, no server.
   ============================================================ */

(() => {
  "use strict";

  /* ---------- config ---------- */

  const PROJECTS = [
    { id: "256", label: "256" },
    { id: "prototype-1", label: "Prototype 1" },
    { id: "prototype-2", label: "Prototype 2" },
    { id: "thesis-proposal", label: "Thesis Proposal" },
    { id: "general", label: "General" },
  ];
  const PROJECT_LABEL = Object.fromEntries(PROJECTS.map((p) => [p.id, p.label]));

  const KIND_LABEL = {
    reading: "Reading",
    reference: "Reference",
    website: "Resource",
    image: "Image",
    document: "Document",
    journal: "Journal",
  };

  const MAX_FILE_MB = 30;

  /* ---------- IndexedDB ---------- */

  const DB_NAME = "thesis-journal";
  const STORE = "entries";
  let _db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE))
          db.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function db() {
    if (!_db) _db = await openDB();
    return _db;
  }
  async function dbAll() {
    const d = await db();
    return new Promise((res, rej) => {
      const r = d.transaction(STORE, "readonly").objectStore(STORE).getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    });
  }
  async function dbPut(entry) {
    const d = await db();
    return new Promise((res, rej) => {
      const tx = d.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  }
  async function dbDelete(id) {
    const d = await db();
    return new Promise((res, rej) => {
      const tx = d.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  }
  async function dbReplaceAll(list) {
    const d = await db();
    return new Promise((res, rej) => {
      const tx = d.transaction(STORE, "readwrite");
      const os = tx.objectStore(STORE);
      os.clear();
      (list || []).forEach((e) => e && e.id && os.put(e));
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  }

  /* ---------- state ---------- */

  const UI_KEY = "thesis-journal:ui";
  let entries = [];
  const filters = {
    view: "files",
    search: "",
    projects: new Set(),
    tags: new Set(),
    sort: "date-desc",
  };
  let calMonth = startOfMonth(new Date());
  let calSelected = null; // ISO date string
  let filesOrder = "week"; // project | type | tag | week
  let filesOpenKey = null;
  let filesLanded = false; // one-shot: auto-open the top folder on first paint
  let filesFlip = null; // geometry snapshot for the open/close morph
  let filesTabSeed = Math.floor(Math.random() * 1e9); // reshuffles tab x-positions per load

  function loadUI() {
    try {
      const s = JSON.parse(localStorage.getItem(UI_KEY) || "{}");
      if (s.view) filters.view = s.view;
      if (s.sort) filters.sort = s.sort;
      if (s.theme) document.documentElement.setAttribute("data-theme", s.theme);
    } catch (e) {}
  }
  function saveUI() {
    try {
      localStorage.setItem(
        UI_KEY,
        JSON.stringify({
          view: filters.view,
          sort: filters.sort,
          theme: document.documentElement.getAttribute("data-theme"),
        })
      );
    } catch (e) {}
  }

  /* ---------- helpers ---------- */

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const uid = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const todayISO = () => toISO(new Date());

  function toISO(d) {
    const x = new Date(d);
    x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
    return x.toISOString().slice(0, 10);
  }
  function startOfMonth(d) {
    const x = new Date(d);
    x.setDate(1);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  function addMonths(d, n) {
    const x = new Date(d);
    x.setMonth(x.getMonth() + n);
    return x;
  }
  function mondayOf(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    const day = (x.getDay() + 6) % 7; // Mon=0
    x.setDate(x.getDate() - day);
    return x;
  }
  function isoWeek(d) {
    const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = (x.getUTCDay() + 6) % 7;
    x.setUTCDate(x.getUTCDate() - day + 3);
    const firstThu = new Date(Date.UTC(x.getUTCFullYear(), 0, 4));
    const week =
      1 +
      Math.round(
        ((x - firstThu) / 86400000 -
          3 +
          ((firstThu.getUTCDay() + 6) % 7)) /
          7
      );
    return { year: x.getUTCFullYear(), week };
  }
  function weekTag(iso) {
    if (!iso) return "";
    const { year, week } = isoWeek(new Date(iso + "T00:00:00"));
    return `${year} · Week ${week}`;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(
      /[&<>"']/g,
      (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );
  }
  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso.length <= 10 ? iso + "T00:00:00" : iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  const entryDate = (e) => e.date || (e.dateAdded || "").slice(0, 10);

  function fmtFullDate(iso) {
    if (!iso) return "";
    const d = new Date(iso.length <= 10 ? iso + "T00:00:00" : iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  // Notes: turn lines that start with - – — > • ↳ into hanging "↳" sub-points
  function noteHTML(text) {
    return esc(text)
      .split("\n")
      .map((ln) => {
        const m = ln.match(/^\s*(?:[-–—>•]|&gt;|↳)\s+(.*)$/);
        return m
          ? `<span class="note-sub">${m[1]}</span>`
          : `<span class="note-line">${ln}</span>`;
      })
      .join("");
  }

  function fileToDataURL(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(file);
    });
  }

  /* ---------- filtering / sorting ---------- */

  function matchesView(e) {
    switch (filters.view) {
      case "files":
        return true;
      case "all":
        return e.kind !== "journal";
      case "reading":
        return e.kind === "reading" || e.kind === "reference";
      case "website":
        return e.kind === "website" || (!!e.url && e.kind !== "journal");
      case "image":
        return e.kind === "image" || (e.attachments || []).some((a) => a.isImage);
      case "document":
        return (
          e.kind === "document" ||
          (e.attachments || []).some((a) => a.type === "application/pdf")
        );
      case "journal":
        return e.kind === "journal";
      case "calendar":
        return true;
      default:
        return true;
    }
  }

  function haystack(e) {
    return [
      e.title,
      e.author,
      e.publication,
      e.url,
      e.note,
      KIND_LABEL[e.kind],
      weekTag(entryDate(e)),
      (e.tags || []).join(" "),
      (e.projects || []).map((p) => PROJECT_LABEL[p] || p).join(" "),
      (e.attachments || []).map((a) => a.name).join(" "),
    ]
      .join("  ")
      .toLowerCase();
  }

  function passesCommon(e) {
    if (filters.search) {
      const q = filters.search.toLowerCase().trim();
      if (q && !haystack(e).includes(q)) return false;
    }
    if (filters.projects.size) {
      const ps = e.projects || [];
      if (![...filters.projects].some((p) => ps.includes(p))) return false;
    }
    if (filters.tags.size) {
      const ts = e.tags || [];
      if (![...filters.tags].some((t) => ts.includes(t))) return false;
    }
    return true;
  }
  const matchesFilters = (e) => matchesView(e) && passesCommon(e);

  function sortEntries(list) {
    const by = {
      "date-desc": (a, b) => entryDate(b).localeCompare(entryDate(a)),
      "date-asc": (a, b) => entryDate(a).localeCompare(entryDate(b)),
      "added-desc": (a, b) =>
        (b.dateAdded || "").localeCompare(a.dateAdded || ""),
      "title-asc": (a, b) =>
        (a.title || "").localeCompare(b.title || "", undefined, {
          sensitivity: "base",
        }),
    };
    return [...list].sort(by[filters.sort] || by["date-desc"]);
  }

  /* ---------- toolbar filters ---------- */

  function renderFilters() {
    const pf = $("#projectFilters");
    pf.innerHTML = "";
    PROJECTS.forEach((p) => {
      const b = document.createElement("button");
      b.className = "chip" + (filters.projects.has(p.id) ? " is-on" : "");
      b.textContent = p.label;
      b.onclick = () => {
        filters.projects.has(p.id)
          ? filters.projects.delete(p.id)
          : filters.projects.add(p.id);
        render();
      };
      pf.appendChild(b);
    });

    const allTags = [...new Set(entries.flatMap((e) => e.tags || []))].sort();
    $("#tagFilterBlock").hidden = allTags.length === 0;
    const tf = $("#tagFilters");
    tf.innerHTML = "";
    allTags.forEach((t) => {
      const b = document.createElement("button");
      b.className = "chip" + (filters.tags.has(t) ? " is-on" : "");
      b.textContent = "#" + t;
      b.onclick = () => {
        filters.tags.has(t) ? filters.tags.delete(t) : filters.tags.add(t);
        render();
      };
      tf.appendChild(b);
    });
    $("#tagSuggestions").innerHTML = allTags
      .map((t) => `<option value="${esc(t)}">`)
      .join("");
  }

  /* ---------- render ---------- */

  function render() {
    renderFilters();
    $("#sort").value = filters.sort;
    $("#search").value = filters.search;
    $$("#views .view-btn").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.view === filters.view)
    );
    document.body.classList.toggle("view-files", filters.view === "files");

    const content = $("#content");
    content.innerHTML = "";

    if (filters.view === "files") {
      renderFiles(content);
      $("#count").textContent = "";
      return;
    }

    if (!entries.length) {
      content.innerHTML = `<div class="empty">
        <h3>Your journal is empty</h3>
        <p>Add a reading, a link, an image, an annotated document, or this week's comment.</p>
        <button class="add-btn" onclick="document.getElementById('addBtn').click()">Add the first entry</button>
      </div>`;
      $("#count").textContent = "";
      return;
    }

    if (filters.view === "calendar") {
      renderCalendar(content);
      $("#count").textContent = "";
      return;
    }

    const matched = sortEntries(entries.filter(matchesFilters));
    if (!matched.length) {
      content.innerHTML = `<div class="empty"><h3>Nothing matches</h3><p>Try clearing a filter or the search box.</p></div>`;
      $("#count").textContent = "0 shown";
      return;
    }

    if (filters.view === "image") renderGallery(matched, content);
    else if (filters.view === "journal") renderJournal(matched, content);
    else renderByProject(matched, content);

    const total = entries.filter((e) =>
      filters.view === "journal" ? e.kind === "journal" : e.kind !== "journal"
    ).length;
    $("#count").textContent =
      matched.length === total
        ? `${total} ${total === 1 ? "entry" : "entries"}`
        : `${matched.length} of ${total} shown`;
  }

  function groupByProject(list) {
    const groups = new Map();
    PROJECTS.forEach((p) => groups.set(p.id, []));
    groups.set("__none", []);
    list.forEach((e) => {
      const ps = (e.projects || []).filter((p) => groups.has(p));
      if (!ps.length) groups.get("__none").push(e);
      else ps.forEach((p) => groups.get(p).push(e));
    });
    const out = [];
    [...PROJECTS.map((p) => p.id), "__none"].forEach((id) => {
      const items = groups.get(id);
      if (items && items.length)
        out.push({
          id,
          label: id === "__none" ? "Unfiled" : PROJECT_LABEL[id],
          items,
        });
    });
    return out;
  }

  function renderByProject(matched, content) {
    const groups = groupByProject(matched);
    const single = filters.projects.size === 1 && groups.length === 1;
    groups.forEach((g) => {
      if (!single) {
        const h = document.createElement("div");
        h.className = "group-head";
        h.textContent = `${g.label} — ${g.items.length}`;
        content.appendChild(h);
      }
      sortEntries(g.items).forEach((e) => content.appendChild(entryRow(e)));
    });
  }

  function renderJournal(matched, content) {
    // dated log — one full-date header per day (openstudioprocess style)
    const groups = new Map();
    matched.forEach((e) => {
      const key = entryDate(e) || "unknown";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    });
    const keys = [...groups.keys()].sort((a, b) =>
      filters.sort === "date-asc" ? a.localeCompare(b) : b.localeCompare(a)
    );
    keys.forEach((k) => {
      const h = document.createElement("div");
      h.className = "group-head";
      h.textContent =
        k === "unknown" ? "Undated" : fmtFullDate(k) + "  ·  " + weekTag(k);
      content.appendChild(h);
      sortEntries(groups.get(k)).forEach((e) =>
        content.appendChild(entryRow(e))
      );
    });
  }

  function entryRow(e) {
    const el = document.createElement("article");
    el.className = "entry" + (e.kind === "journal" ? " is-journal" : "");

    const d = entryDate(e);
    const meta = [];
    if (e.kind === "journal") {
      if (d) meta.push(fmtDate(d));
      if (d) meta.push(weekTag(d));
    } else {
      if (e.author) meta.push(esc(e.author));
      if (e.publication) meta.push(`<i>${esc(e.publication)}</i>`);
      if (d) meta.push(`${e.date ? "Read" : "Added"} ${fmtDate(d)}`);
    }

    const pills = [
      ...(e.projects || []).map(
        (p) => `<span class="pill project">${esc(PROJECT_LABEL[p] || p)}</span>`
      ),
      ...(e.tags || []).map((t) => `<span class="pill tag">${esc(t)}</span>`),
    ].join("");

    const atts = (e.attachments || [])
      .map((a, i) =>
        a.isImage
          ? `<img class="thumb" src="${a.dataUrl}" alt="${esc(a.name)}" data-att="${i}">`
          : `<a class="file-chip" href="${a.dataUrl}" target="_blank" rel="noopener" download="${esc(
              a.name
            )}">▤ ${esc(a.name)}</a>`
      )
      .join("");

    const title =
      e.title ||
      (e.kind === "journal" ? "Week of " + fmtDate(mondayOf(new Date(d))) : "Untitled");

    el.innerHTML = `
      <div class="entry-kind">${esc(KIND_LABEL[e.kind] || e.kind)}</div>
      <div class="entry-main">
        <h3 class="entry-title">${esc(title)}${
          e.url
            ? ` <a class="ext" href="${esc(e.url)}" target="_blank" rel="noopener">↗ visit</a>`
            : ""
        }</h3>
        ${meta.length ? `<div class="entry-meta">${meta.join('<span class="dot">·</span>')}</div>` : ""}
        ${e.note ? `<div class="entry-note">${noteHTML(e.note)}</div>` : ""}
        ${pills ? `<div class="entry-tags">${pills}</div>` : ""}
        ${atts ? `<div class="entry-attach">${atts}</div>` : ""}
      </div>
      <div class="entry-actions">
        <button data-act="edit">edit</button>
        <button data-act="del">delete</button>
      </div>`;

    el.querySelector('[data-act="edit"]').onclick = () => openModal(e);
    el.querySelector('[data-act="del"]').onclick = () => removeEntry(e);
    $$(".thumb", el).forEach((img) => {
      img.onclick = () => openLightbox(e.attachments[+img.dataset.att], e);
    });
    return el;
  }

  function renderGallery(matched, content) {
    const tiles = [];
    matched.forEach((e) =>
      (e.attachments || []).forEach((a, i) => {
        if (a.isImage) tiles.push({ e, a, i });
      })
    );
    if (!tiles.length) {
      content.innerHTML = `<div class="empty"><h3>No images yet</h3><p>Attach images to any entry — they appear here, grouped by project.</p></div>`;
      return;
    }
    const groups = new Map();
    PROJECTS.forEach((p) => groups.set(p.id, []));
    groups.set("__none", []);
    tiles.forEach((t) => {
      const ps = (t.e.projects || []).filter((p) => groups.has(p));
      if (!ps.length) groups.get("__none").push(t);
      else ps.forEach((p) => groups.get(p).push(t));
    });
    [...PROJECTS.map((p) => p.id), "__none"].forEach((gid) => {
      const list = groups.get(gid);
      if (!list || !list.length) return;
      const label = gid === "__none" ? "Unfiled" : PROJECT_LABEL[gid];
      const h = document.createElement("div");
      h.className = "group-head";
      h.textContent = `${label} — ${list.length} image${list.length === 1 ? "" : "s"}`;
      content.appendChild(h);
      const grid = document.createElement("div");
      grid.className = "gallery";
      list.forEach(({ e, a }) => {
        const fig = document.createElement("figure");
        fig.innerHTML = `
          <img src="${a.dataUrl}" alt="${esc(a.name)}">
          <figcaption>
            <span class="cap-title">${esc(e.title || a.name)}</span>
            ${e.tags && e.tags.length ? `<br>${e.tags.map((t) => "#" + esc(t)).join(" ")}` : ""}
          </figcaption>`;
        fig.querySelector("img").onclick = () => openLightbox(a, e);
        fig.querySelector("figcaption").onclick = () => openModal(e);
        grid.appendChild(fig);
      });
      content.appendChild(grid);
    });
  }

  /* ---------- files view (folder drawer) ---------- */

  const TAB_ROT = [-0.5, 0.35, -0.25, 0.5, -0.4, 0.2, -0.35, 0.45, -0.2, 0.3, -0.45, 0.25];

  // spread the folder tabs right across the drawer, scattered (not left-to-right),
  // re-scattered whenever the folder count changes (new week / new folder) or the
  // page reloads — seed folds in the order + count + the per-load random.
  function tabPositions(n, order) {
    if (n <= 1) return [8];
    let oh = 0;
    for (let k = 0; k < order.length; k++)
      oh = (oh * 131 + order.charCodeAt(k)) >>> 0;
    let s = (filesTabSeed + n * 2654435761 + oh * 40503) >>> 0;
    const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const lo = 2,
      hi = 82; // percent range for the tab's left edge
    const slots = [];
    for (let i = 0; i < n; i++) slots.push(lo + ((hi - lo) * i) / (n - 1));
    // Fisher–Yates on the evenly-spaced slots → full-width but shuffled
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = slots[i];
      slots[i] = slots[j];
      slots[j] = t;
    }
    // nudge each a little so it never looks like a fixed grid
    return slots.map((x) => Math.max(lo, Math.min(hi, x + (rand() - 0.5) * 6)));
  }
  const FILE_ORDERS = [
    ["week", "week"],
    ["project", "project"],
    ["type", "type"],
    ["tag", "tag"],
  ];

  /* ---- semester: 15 weekly classes, first class Fri 28 Aug 2026 ---- */
  const TERM_START = "2026-08-28"; // week 1 opens 00:00 this Friday
  const TERM_WEEKS = 15;
  const WEEK_MS = 7 * 86400000;

  function termWeekOf(iso) {
    // 1-based class week a date belongs to (clamped to 1..TERM_WEEKS)
    const n =
      Math.floor(
        (new Date(iso + "T00:00:00") - new Date(TERM_START + "T00:00:00")) /
          WEEK_MS
      ) + 1;
    return Math.max(1, Math.min(TERM_WEEKS, n));
  }
  function weeksOpen() {
    // how many class weeks have started as of now (each opens on its Friday 00:00)
    const n =
      Math.floor((Date.now() - new Date(TERM_START + "T00:00:00")) / WEEK_MS) + 1;
    return Math.max(1, Math.min(TERM_WEEKS, n));
  }
  function weekFriday(n) {
    const d = new Date(TERM_START + "T00:00:00");
    d.setDate(d.getDate() + (n - 1) * 7);
    return d;
  }

  function firstImage(items) {
    for (const e of items)
      for (const a of e.attachments || []) if (a.isImage) return a.dataUrl;
    return null;
  }

  function buildFolders(order) {
    const pool = entries.filter(passesCommon); // honour search + project/tag filters
    const narrowing =
      !!filters.search.trim() || filters.projects.size || filters.tags.size;
    let groups = [];
    if (order === "project") {
      PROJECTS.forEach((p) =>
        groups.push({
          key: p.id,
          label: p.label,
          items: pool.filter((e) => (e.projects || []).includes(p.id)),
        })
      );
      const unfiled = pool.filter(
        (e) => !(e.projects || []).some((x) => PROJECT_LABEL[x])
      );
      if (unfiled.length)
        groups.push({ key: "__none", label: "Unfiled", items: unfiled });
    } else if (order === "type") {
      Object.keys(KIND_LABEL).forEach((k) => {
        groups.push({
          key: k,
          label:
            KIND_LABEL[k] === "Resource" ? "Resources" : KIND_LABEL[k] + "s",
          items: pool.filter((e) => e.kind === k),
        });
      });
    } else if (order === "tag") {
      [...new Set(pool.flatMap((e) => e.tags || []))]
        .sort()
        .forEach((t) =>
          groups.push({
            key: t,
            label: "#" + t,
            items: pool.filter((e) => (e.tags || []).includes(t)),
          })
        );
    } else if (order === "week") {
      const open = weeksOpen();
      const byWeek = new Map();
      pool.forEach((e) => {
        const d = entryDate(e);
        if (!d) return;
        const n = Math.min(termWeekOf(d), open);
        if (!byWeek.has(n)) byWeek.set(n, []);
        byWeek.get(n).push(e);
      });
      for (let n = open; n >= 1; n--) {
        groups.push({
          key: "w" + n,
          label: "Week " + n,
          sub:
            weekFriday(n).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
            }) + " · class " + n + "/" + TERM_WEEKS,
          items: byWeek.get(n) || [],
        });
      }
      // ghost: the next class week, opens on its Friday
      if (open < TERM_WEEKS && !narrowing) {
        groups.unshift({
          key: "w" + (open + 1),
          label: "Week " + (open + 1),
          sub:
            "opens " +
            weekFriday(open + 1).toLocaleDateString("en-GB", {
              weekday: "short",
              day: "numeric",
              month: "short",
            }),
          items: [],
          locked: true,
        });
      }
    }
    if (narrowing) groups = groups.filter((g) => g.items.length);
    const AXIS = { project: "project", type: "type" };
    groups.forEach((g) => {
      g.cover = firstImage(g.items);
      if (!g.locked) g.axis = AXIS[order] || "";
      if (g.sub == null)
        g.sub =
          g.items.length + (g.items.length === 1 ? " item" : " items");
    });
    return groups;
  }

  // snapshot every folder tab's on-screen box so the next render can morph from it
  function snapshotFilesGeom() {
    const tabs = {};
    document.querySelectorAll(".files-tab").forEach((t) => {
      if (t.dataset.key) tabs[t.dataset.key] = t.getBoundingClientRect();
    });
    return { tabs };
  }

  // FLIP: after renderFiles has painted the new layout, slide/scale each tab
  // back to where it was and let it ease to its new spot — vertical <-> horizontal
  function flipFiles() {
    if (!filesFlip) return;
    const prev = filesFlip;
    filesFlip = null;
    const tabs = [...document.querySelectorAll(".files-tab")];
    const face = document.querySelector(".files-face");
    let moved = false;

    tabs.forEach((t) => {
      const o = prev.tabs[t.dataset.key];
      if (!o) return;
      const n = t.getBoundingClientRect();
      if (!n.width || !n.height) return;
      const dx = o.left - n.left;
      const dy = o.top - n.top;
      const sx = o.width / n.width;
      const sy = o.height / n.height;
      if (
        Math.abs(dx) < 1 &&
        Math.abs(dy) < 1 &&
        Math.abs(sx - 1) < 0.02 &&
        Math.abs(sy - 1) < 0.02
      )
        return;
      moved = true;
      const inner = t.querySelector(".ff-tab");
      t.style.transition = "none";
      t.style.transformOrigin = "top left";
      t.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
      if (inner) {
        inner.style.transition = "none";
        inner.style.transform = `scale(${1 / sx}, ${1 / sy})`;
      }
    });

    if (face) {
      face.style.transition = "none";
      face.style.opacity = "0";
      face.style.transform = "translateY(10px)";
    }
    if (!moved && !face) return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const ease = "cubic-bezier(.45,0,.15,1)";
        tabs.forEach((t) => {
          const inner = t.querySelector(".ff-tab");
          t.style.transition = `transform .44s ${ease}`;
          t.style.transform = "";
          if (inner) {
            inner.style.transition = `transform .44s ${ease}`;
            inner.style.transform = "";
          }
        });
        if (face) {
          face.style.transition =
            "opacity .34s ease .08s, transform .34s ease .08s";
          face.style.opacity = "";
          face.style.transform = "";
        }
      });
    });

    setTimeout(() => {
      tabs.forEach((t) => {
        t.style.transition = "";
        t.style.transform = "";
        t.style.transformOrigin = "";
        const inner = t.querySelector(".ff-tab");
        if (inner) {
          inner.style.transition = "";
          inner.style.transform = "";
        }
      });
      if (face) {
        face.style.transition = "";
        face.style.opacity = "";
        face.style.transform = "";
      }
    }, 580);
  }

  // jump straight to a folder from anywhere inside the Files view — an entry's
  // project/tag/week are all just doors into the same drawer
  function gotoFolder(order, key) {
    filesOrder = order;
    filesOpenKey = key;
    render();
  }

  function pillBtn(label, className, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = className;
    b.textContent = label;
    b.onclick = (ev) => {
      ev.stopPropagation();
      onClick();
    };
    return b;
  }

  function renderFiles(content) {
    const view = document.createElement("div");
    view.className = "files-view";

    const barWrap = document.createElement("div");
    barWrap.className = "files-orders-wrap";
    const bar = document.createElement("div");
    bar.className = "files-orders";
    bar.innerHTML =
      `<span class="files-orders-label">file by</span>` +
      FILE_ORDERS.map(
        ([k, lbl]) =>
          `<button class="files-order-btn${
            filesOrder === k ? " is-on" : ""
          }" data-order="${k}">${lbl}</button>`
      ).join("");
    bar.querySelectorAll("[data-order]").forEach((b) => {
      b.onclick = () => {
        filesOrder = b.dataset.order;
        filesOpenKey = null;
        render();
      };
    });
    barWrap.appendChild(bar);
    view.appendChild(barWrap);

    const folders = buildFolders(filesOrder);

    if (!folders.length) {
      const empty = document.createElement("div");
      empty.className = "files-empty-wrap";
      empty.innerHTML = filters.search.trim()
        ? `<p class="files-none">Nothing in the file matches “${esc(
            filters.search.trim()
          )}”.</p>`
        : `<div class="empty">
        <h3>The file is empty</h3>
        <p>Add a reading, a link, an image or this week's line — it drops into a folder here on its own.</p>
        <button class="add-btn" onclick="document.getElementById('addBtn').click()">Start the file</button>
      </div>`;
      view.appendChild(empty);
      content.appendChild(view);
      return;
    }

    const real = folders.filter((g) => !g.locked);
    const opened = real.find((g) => g.key === filesOpenKey) || null;
    if (!opened) filesOpenKey = null;
    const current = opened || real[0] || folders[0];
    const currentIdx = folders.indexOf(current);

    // ---- the folders: a vertical stack of bands, or a top row once one is opened ----
    const tabrow = document.createElement("div");
    tabrow.className = "files-tabrow" + (opened ? " is-open" : "");
    const tabX = tabPositions(folders.length, filesOrder);
    folders.forEach((g, i) => {
      const t = document.createElement("button");
      t.type = "button";
      t.className =
        "files-tab tone-" +
        (i % 10) +
        (g === current ? " is-current" : "") +
        (g.locked ? " is-locked" : "") +
        (g.cover ? " has-cover" : "");
      t.style.setProperty("--tab-x", tabX[i].toFixed(1) + "%");
      t.style.setProperty(
        "--rot",
        (opened && g === current ? 0 : TAB_ROT[i % TAB_ROT.length]) + "deg"
      );
      t.style.zIndex = g.locked ? 1 : opened && g === current ? 60 : i + 2;
      t.dataset.key = g.key;
      if (g.cover) t.style.setProperty("--cover", `url("${g.cover}")`);
      t.innerHTML = `<span class="ff-tab"><span class="ft-name">${esc(
        g.label
      )}</span>${
        g.axis ? `<span class="ft-axis">${esc(g.axis)}</span>` : ""
      }<span class="ft-sub">${esc(g.sub)}</span></span>`;
      if (!g.locked)
        t.onclick = () => {
          filesFlip = snapshotFilesGeom();
          filesOpenKey = filesOpenKey === g.key ? null : g.key;
          render();
        };
      tabrow.appendChild(t);
    });
    view.appendChild(tabrow);

    if (!opened) {
      content.appendChild(view);
      flipFiles();
      return;
    }

    // ---- opened folder: one full-page face with its contents ----
    const face = document.createElement("div");
    face.className = "files-face tone-" + (currentIdx % 10);
    if (current.cover) {
      face.classList.add("has-cover");
      face.style.setProperty("--cover", `url("${current.cover}")`);
    }
    face.innerHTML = `
      <div class="fp-head">
        <span class="fp-name">${esc(current.label)}</span>
        <span class="fp-sub">${esc(current.sub)}</span>
      </div>
      <div class="fp-sheet"></div>`;
    const sheet = face.querySelector(".fp-sheet");

    if (!current.items.length) {
      sheet.innerHTML = `<p class="folder-empty">Nothing filed in this ${
        filesOrder === "week" ? "week" : "folder"
      } yet.</p>`;
    } else {
      const paper = document.createElement("div");
      paper.className = "folder-sheet";
      sortEntries(current.items).forEach((e) => {
        const wrap = document.createElement("div");
        wrap.className = "folder-row";

        const row = document.createElement("button");
        row.type = "button";
        row.className = "folder-item";
        row.innerHTML = `<span class="fi-kind">${esc(
          KIND_LABEL[e.kind] || ""
        )}</span><span class="fi-title">${esc(
          e.title || "Untitled"
        )}</span><span class="fi-date">${esc(fmtDate(entryDate(e)))}</span>`;

        const detail = document.createElement("div");
        detail.className = "folder-detail";
        detail.hidden = true;
        detail.innerHTML = `<div class="entry-note">${
          e.note
            ? noteHTML(e.note)
            : `<span class="note-line" style="opacity:.5">No notes yet.</span>`
        }</div>`;

        const meta = document.createElement("div");
        meta.className = "folder-detail-meta";
        const d = entryDate(e);
        if (d) {
          const wk = "w" + Math.min(termWeekOf(d), weeksOpen());
          meta.appendChild(
            pillBtn("Week " + wk.slice(1), "pill week", () =>
              gotoFolder("week", wk)
            )
          );
        }
        (e.projects || []).forEach((p) =>
          meta.appendChild(
            pillBtn(PROJECT_LABEL[p] || p, "pill project", () =>
              gotoFolder("project", p)
            )
          )
        );
        (e.tags || []).forEach((t) =>
          meta.appendChild(pillBtn(t, "pill tag", () => gotoFolder("tag", t)))
        );
        meta.appendChild(
          pillBtn("Edit entry →", "folder-detail-edit", () => openModal(e))
        );
        detail.appendChild(meta);

        row.onclick = () => {
          const willOpen = detail.hidden;
          paper
            .querySelectorAll(".folder-detail:not([hidden])")
            .forEach((x) => (x.hidden = true));
          paper
            .querySelectorAll(".folder-item.is-expanded")
            .forEach((x) => x.classList.remove("is-expanded"));
          detail.hidden = !willOpen;
          row.classList.toggle("is-expanded", willOpen);
        };

        wrap.appendChild(row);
        wrap.appendChild(detail);
        paper.appendChild(wrap);
      });
      sheet.appendChild(paper);
    }
    view.appendChild(face);

    content.appendChild(view);
    flipFiles();
  }

  /* ---------- calendar ---------- */

  function entriesOn(iso) {
    return entries.filter((e) => passesCommon(e) && entryDate(e) === iso);
  }

  function renderCalendar(content) {
    const wrap = document.createElement("div");
    wrap.className = "cal-wrap";

    const monthLabel = calMonth.toLocaleDateString("en-GB", {
      month: "long",
      year: "numeric",
    });
    const head = document.createElement("div");
    head.className = "cal-head";
    head.innerHTML = `
      <h2>${monthLabel}</h2>
      <div class="cal-nav">
        <button data-nav="-1" aria-label="Previous month">‹</button>
        <button data-nav="1" aria-label="Next month">›</button>
      </div>
      <button class="cal-today">Today</button>`;
    head.querySelector('[data-nav="-1"]').onclick = () => {
      calMonth = addMonths(calMonth, -1);
      render();
    };
    head.querySelector('[data-nav="1"]').onclick = () => {
      calMonth = addMonths(calMonth, 1);
      render();
    };
    head.querySelector(".cal-today").onclick = () => {
      calMonth = startOfMonth(new Date());
      calSelected = todayISO();
      render();
    };
    wrap.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "cal-grid";
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].forEach((d) => {
      const c = document.createElement("div");
      c.className = "cal-dow";
      c.textContent = d;
      grid.appendChild(c);
    });

    const first = startOfMonth(calMonth);
    const gridStart = mondayOf(first);
    const today = todayISO();
    for (let i = 0; i < 42; i++) {
      const day = new Date(gridStart);
      day.setDate(gridStart.getDate() + i);
      const iso = toISO(day);
      const inMonth = day.getMonth() === calMonth.getMonth();
      const items = entriesOn(iso);

      const cell = document.createElement("button");
      cell.type = "button";
      cell.className =
        "cal-cell" +
        (inMonth ? "" : " other-month") +
        (items.length ? " has-items" : " is-empty") +
        (iso === today ? " is-today" : "") +
        (iso === calSelected ? " is-selected" : "");

      const ticks = items
        .slice(0, 3)
        .map(
          (e) =>
            `<span class="cal-tick"><span class="k">${esc(
              (KIND_LABEL[e.kind] || "").slice(0, 4)
            )}</span>${esc(e.title || "Untitled")}</span>`
        )
        .join("");
      cell.innerHTML =
        `<span class="cal-daynum">${day.getDate()}</span>` +
        ticks +
        (items.length > 3
          ? `<span class="cal-more">+${items.length - 3} more</span>`
          : "");

      if (items.length) {
        cell.onclick = () => {
          calSelected = calSelected === iso ? null : iso;
          render();
        };
      }
      grid.appendChild(cell);
    }
    wrap.appendChild(grid);

    if (calSelected) {
      const panel = document.createElement("div");
      panel.className = "cal-day-panel";
      const h = document.createElement("div");
      h.className = "group-head";
      h.textContent = fmtDate(calSelected);
      panel.appendChild(h);
      const list = sortEntries(entriesOn(calSelected));
      if (list.length) list.forEach((e) => panel.appendChild(entryRow(e)));
      else {
        const p = document.createElement("p");
        p.className = "hint";
        p.textContent = "Nothing on this day with the current filters.";
        panel.appendChild(p);
      }
      wrap.appendChild(panel);
    }

    content.appendChild(wrap);
  }

  /* ---------- lightbox ---------- */

  function openLightbox(att, entry) {
    if (!att) return;
    $("#lightboxImg").src = att.dataUrl;
    $("#lightboxImg").alt = att.name || "";
    const bits = [entry.title || att.name];
    if (entry.projects && entry.projects.length)
      bits.push(entry.projects.map((p) => PROJECT_LABEL[p] || p).join(", "));
    if (entry.tags && entry.tags.length)
      bits.push(entry.tags.map((t) => "#" + t).join(" "));
    if (entry.note) bits.push(entry.note);
    $("#lightboxCaption").textContent = bits.filter(Boolean).join("  —  ");
    $("#lightbox").hidden = false;
  }
  function closeLightbox() {
    $("#lightbox").hidden = true;
    $("#lightboxImg").src = "";
  }

  /* ---------- modal ---------- */

  let draftAttachments = [];
  let draftTags = [];

  function applyKindUI(kind) {
    const journal = kind === "journal";
    $("#f-sourceRow").hidden = journal;
    $("#f-urlField").hidden = journal;
    $("#f-titleLabel").innerHTML = journal
      ? "Heading <span class='hint' style='text-transform:none;letter-spacing:0'>(optional — defaults to “Week of…”)</span>"
      : 'Title <span class="req">*</span>';
    $("#f-title").placeholder = journal
      ? "e.g. Week 6 — narrowing the question"
      : "What is it called?";
    $("#f-dateLabel").textContent = journal ? "Date" : "Date read";
    $("#f-noteLabel").textContent = journal
      ? "Comment / reflection"
      : "Notes / annotation";
    $("#f-note").placeholder = journal
      ? "What happened this week, what you read, what shifted, what's next."
      : "Why it's useful, key quotes, page numbers, your reflections. For documents, paste the text you want to be able to search.";
    updateDateHint();
  }

  function updateDateHint() {
    const v = $("#f-date").value || todayISO();
    $("#f-todayHint").textContent = fmtDate(todayISO());
    const wk = weekTag(v);
    $("#f-dateHint").innerHTML =
      ($("#f-kind").value === "journal"
        ? `Defaults to today (${fmtDate(todayISO())}). `
        : `Leave blank and it defaults to today (${fmtDate(todayISO())}). `) +
      (wk ? `<b>${esc(wk)}</b>` : "");
  }

  function buildProjectChecks() {
    const wrap = $("#f-projects");
    wrap.innerHTML = "";
    PROJECTS.forEach((p) => {
      const l = document.createElement("label");
      l.innerHTML = `<input type="checkbox" value="${p.id}"> ${esc(p.label)}`;
      wrap.appendChild(l);
    });
  }

  function renderDraftTags() {
    $("#f-tagChips").innerHTML = draftTags
      .map(
        (t, i) =>
          `<span class="tag-chip">${esc(t)}<button type="button" data-i="${i}" aria-label="remove">✕</button></span>`
      )
      .join("");
    $$("#f-tagChips button").forEach((b) => {
      b.onclick = () => {
        draftTags.splice(+b.dataset.i, 1);
        renderDraftTags();
      };
    });
  }
  function commitTagInput() {
    const inp = $("#f-tagInput");
    inp.value
      .split(",")
      .map((s) => s.trim().replace(/^#/, ""))
      .filter(Boolean)
      .forEach((t) => {
        if (!draftTags.includes(t)) draftTags.push(t);
      });
    inp.value = "";
    renderDraftTags();
  }

  function renderDraftAttachments() {
    const wrap = $("#f-previews");
    wrap.innerHTML = "";
    draftAttachments.forEach((a, i) => {
      const d = document.createElement("div");
      d.className = "prev-item";
      d.innerHTML = a.isImage
        ? `<img src="${a.dataUrl}" alt="${esc(a.name)}">`
        : `<span>${esc(a.name.slice(0, 22))}</span>`;
      const rm = document.createElement("button");
      rm.type = "button";
      rm.textContent = "✕";
      rm.onclick = () => {
        draftAttachments.splice(i, 1);
        renderDraftAttachments();
      };
      d.appendChild(rm);
      wrap.appendChild(d);
    });
  }

  async function ingestFiles(fileList) {
    for (const file of fileList) {
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        alert(`"${file.name}" is over ${MAX_FILE_MB} MB and was skipped.`);
        continue;
      }
      const dataUrl = await fileToDataURL(file);
      draftAttachments.push({
        id: uid(),
        name: file.name || "pasted-image.png",
        type: file.type,
        size: file.size,
        dataUrl,
        isImage: (file.type || "").startsWith("image/"),
      });
    }
    renderDraftAttachments();
  }

  function openModal(entry) {
    const editing = !!entry;
    $("#modalTitle").textContent = editing ? "Edit entry" : "Add entry";
    $("#f-id").value = editing ? entry.id : "";
    $("#f-kind").value = editing ? entry.kind : "reading";
    $("#f-title").value = editing ? entry.title || "" : "";
    $("#f-author").value = editing ? entry.author || "" : "";
    $("#f-publication").value = editing ? entry.publication || "" : "";
    $("#f-url").value = editing ? entry.url || "" : "";
    $("#f-date").value = editing ? entry.date || "" : "";
    $("#f-note").value = editing ? entry.note || "" : "";

    buildProjectChecks();
    const chosen = new Set(editing ? entry.projects || [] : []);
    $$("#f-projects input").forEach((c) => (c.checked = chosen.has(c.value)));

    draftTags = editing ? [...(entry.tags || [])] : [];
    renderDraftTags();
    draftAttachments = editing
      ? (entry.attachments || []).map((a) => ({ ...a }))
      : [];
    renderDraftAttachments();

    applyKindUI($("#f-kind").value);
    $("#deleteBtn").hidden = !editing;
    $("#entryModal").hidden = false;
    setTimeout(() => $("#f-title").focus(), 30);
  }

  function closeModal() {
    $("#entryModal").hidden = true;
    $("#entryForm").reset();
    draftAttachments = [];
    draftTags = [];
  }

  async function saveEntry(ev) {
    ev.preventDefault();
    commitTagInput();

    const kind = $("#f-kind").value;
    const id = $("#f-id").value || uid();
    const existing = entries.find((e) => e.id === id);
    let title = $("#f-title").value.trim();
    const date = $("#f-date").value || todayISO();

    if (!title && kind !== "journal") {
      $("#f-title").focus();
      return;
    }
    if (!title && kind === "journal") {
      title = "Week of " + fmtDate(mondayOf(new Date(date + "T00:00:00")));
    }

    const entry = {
      id,
      kind,
      title,
      author: kind === "journal" ? "" : $("#f-author").value.trim(),
      publication: kind === "journal" ? "" : $("#f-publication").value.trim(),
      url: kind === "journal" ? "" : $("#f-url").value.trim(),
      note: $("#f-note").value.trim(),
      projects: $$("#f-projects input:checked").map((c) => c.value),
      tags: [...draftTags],
      date,
      dateAdded: existing ? existing.dateAdded : new Date().toISOString(),
      attachments: draftAttachments.map((a) => ({
        id: a.id || uid(),
        name: a.name,
        type: a.type,
        size: a.size,
        dataUrl: a.dataUrl,
        isImage: !!a.isImage,
      })),
    };

    await dbPut(entry);
    const idx = entries.findIndex((e) => e.id === id);
    if (idx >= 0) entries[idx] = entry;
    else entries.push(entry);

    closeModal();
    render();
    scheduleSync();
  }

  async function removeEntry(e) {
    if (!confirm(`Delete "${e.title || "this entry"}"? This cannot be undone.`))
      return;
    await dbDelete(e.id);
    entries = entries.filter((x) => x.id !== e.id);
    render();
    scheduleSync();
  }

  /* ---------- export / import ---------- */

  function exportData() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            app: "thesis-journal",
            version: 3,
            exported: new Date().toISOString(),
            entries,
            statusLog,
          },
          null,
          2
        ),
      ],
      { type: "application/json" }
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `thesis-journal-${todayISO()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function importData(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (e) {
      alert("That file isn't valid JSON.");
      return;
    }
    const incoming = Array.isArray(data) ? data : data.entries;
    if (!Array.isArray(incoming)) {
      alert("Couldn't find any entries in that file.");
      return;
    }
    if (
      !confirm(
        `Import ${incoming.length} ${
          incoming.length === 1 ? "entry" : "entries"
        }? Entries with the same id are overwritten; everything else is kept.`
      )
    )
      return;

    for (const raw of incoming) {
      if (!raw || !raw.id) continue;
      const entry = {
        id: String(raw.id),
        kind: raw.kind || "reading",
        title: raw.title || "Untitled",
        author: raw.author || "",
        publication: raw.publication || "",
        url: raw.url || "",
        note: raw.note || "",
        projects: Array.isArray(raw.projects) ? raw.projects : [],
        tags: Array.isArray(raw.tags) ? raw.tags : [],
        date: raw.date || raw.dateRead || (raw.dateAdded || "").slice(0, 10),
        dateAdded: raw.dateAdded || new Date().toISOString(),
        attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
      };
      await dbPut(entry);
      const idx = entries.findIndex((e) => e.id === entry.id);
      if (idx >= 0) entries[idx] = entry;
      else entries.push(entry);
    }

    if (Array.isArray(data.statusLog)) {
      data.statusLog.forEach((raw) => {
        if (!raw || !raw.id || !raw.text) return;
        const i = statusLog.findIndex((s) => s.id === raw.id);
        const note = {
          id: String(raw.id),
          date: raw.date || toISO(mondayOf(new Date())),
          text: raw.text,
          added: raw.added || new Date().toISOString(),
          edited: raw.edited,
        };
        if (i >= 0) statusLog[i] = note;
        else statusLog.push(note);
      });
      persistStatusLog(false);
      renderStatus();
    }

    render();
    scheduleSync();
  }

  /* ---------- weekly status log + archive (openstudioprocess style) ---------- */

  const STATUS_KEY = "thesis-journal:status-log";
  const LEGACY_KEY = "thesis-journal:currently";
  const STATUS_PROMPT =
    "No note yet this week. Hit “add this week's note” and write a quick, human line about what you're working on.";
  let statusLog = []; // [{ id, date (YYYY-MM-DD, the Monday), text, added, edited }]
  let statusArchiveOpen = false;
  let statusEditId = "";

  function loadStatusLog() {
    try {
      const a = JSON.parse(localStorage.getItem(STATUS_KEY) || "null");
      if (Array.isArray(a)) {
        statusLog = a;
        return;
      }
    } catch (e) {}
    // migrate the old single "currently" value into the log
    try {
      const s = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
      if (s && s.text) {
        const iso = (s.updated || new Date().toISOString()).slice(0, 10);
        statusLog = [
          { id: uid(), date: toISO(mondayOf(new Date(iso + "T00:00:00"))), text: s.text, added: s.updated || new Date().toISOString() },
        ];
        persistStatusLog();
        return;
      }
    } catch (e) {}
    statusLog = [];
  }
  function persistStatusLog(sync = true) {
    try {
      localStorage.setItem(STATUS_KEY, JSON.stringify(statusLog));
    } catch (e) {}
    if (sync) scheduleSync("status");
  }
  function sortedStatus() {
    return [...statusLog].sort(
      (a, b) =>
        (b.date || "").localeCompare(a.date || "") ||
        (b.added || "").localeCompare(a.added || "")
    );
  }

  function renderStatus() {
    const sorted = sortedStatus();
    const current = sorted[0];
    const archive = sorted.slice(1);

    if (current) {
      $("#statusCurrent").textContent = current.text;
      $("#statusCurrent").classList.remove("is-empty");
      $("#statusCurrentMeta").textContent =
        "Week of " + fmtFullDate(current.date) + "  ·  " + weekTag(current.date);
      $("#statusEditCurrent").hidden = false;
      $("#statusEditCurrent").onclick = () => openStatusEditor(current);
    } else {
      $("#statusCurrent").textContent = STATUS_PROMPT;
      $("#statusCurrent").classList.add("is-empty");
      $("#statusCurrentMeta").textContent = "";
      $("#statusEditCurrent").hidden = true;
    }

    const toggle = $("#statusArchiveToggle");
    toggle.hidden = archive.length === 0;
    toggle.textContent =
      (statusArchiveOpen ? "hide archive" : "archive") + ` (${archive.length})`;

    const list = $("#statusArchive");
    list.hidden = !statusArchiveOpen || archive.length === 0;
    list.innerHTML = "";
    if (statusArchiveOpen) {
      archive.forEach((it) => {
        const li = document.createElement("li");
        li.className = "status-arch";
        li.innerHTML = `
          <div class="status-arch-date">${esc(fmtDate(it.date))} · ${esc(weekTag(it.date))}</div>
          <div class="status-arch-text">${noteHTML(it.text)}</div>
          <div class="status-arch-actions">
            <button class="linkbtn" data-act="edit">edit</button>
            <button class="linkbtn" data-act="del">delete</button>
          </div>`;
        li.querySelector('[data-act="edit"]').onclick = () => openStatusEditor(it);
        li.querySelector('[data-act="del"]').onclick = () => deleteStatusNote(it.id);
        list.appendChild(li);
      });
    }
  }

  function openStatusEditor(item) {
    statusEditId = item ? item.id : "";
    $("#statusInput").value = item ? item.text : "";
    $("#statusDate").value = item
      ? item.date
      : toISO(mondayOf(new Date()));
    $("#statusEditor").hidden = false;
    $("#statusSave").textContent = item ? "update note" : "save note";
    $("#statusInput").focus();
  }
  function closeStatusEditor() {
    $("#statusEditor").hidden = true;
    statusEditId = "";
  }
  function saveStatusNote(ev) {
    if (ev) ev.preventDefault();
    const text = $("#statusInput").value.trim();
    if (!text) {
      $("#statusInput").focus();
      return;
    }
    const date = $("#statusDate").value || toISO(mondayOf(new Date()));
    if (statusEditId) {
      const it = statusLog.find((x) => x.id === statusEditId);
      if (it) {
        it.text = text;
        it.date = date;
        it.edited = new Date().toISOString();
      }
    } else {
      statusLog.push({ id: uid(), date, text, added: new Date().toISOString() });
    }
    persistStatusLog();
    closeStatusEditor();
    renderStatus();
  }
  function deleteStatusNote(id) {
    if (!confirm("Delete this weekly note?")) return;
    statusLog = statusLog.filter((x) => x.id !== id);
    persistStatusLog();
    renderStatus();
  }

  /* ---------- GitHub sync (optional) ---------- */

  const GH_KEY = "thesis-journal:gh";
  let gh = null; // { owner, repo, branch, path, token }
  let ghSha = null;
  let ghSyncTimer = null;
  let ghState = "off"; // off | idle | syncing | error

  function loadGH() {
    try {
      const c = JSON.parse(localStorage.getItem(GH_KEY) || "null");
      if (c && c.owner && c.repo && c.token) gh = c;
    } catch (e) {}
  }
  function saveGH() {
    try {
      localStorage.setItem(GH_KEY, gh ? JSON.stringify(gh) : "");
    } catch (e) {}
  }
  function setGhState(s, note) {
    ghState = s;
    const btn = $("#syncBtn");
    if (btn) {
      btn.classList.toggle("is-synced", s === "idle");
      btn.classList.toggle("is-syncing", s === "syncing");
      btn.classList.toggle("is-error", s === "error");
      btn.title =
        s === "off"
          ? "GitHub sync — off"
          : "GitHub sync — " + (note || s);
    }
    const el = $("#gh-status");
    if (el && note) el.textContent = note;
  }
  const b64encode = (str) =>
    btoa(unescape(encodeURIComponent(str)));
  const b64decode = (str) =>
    decodeURIComponent(escape(atob(str.replace(/\s/g, ""))));

  function ghHeaders() {
    return {
      Authorization: "Bearer " + gh.token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }
  function ghURL() {
    return `https://api.github.com/repos/${encodeURIComponent(
      gh.owner
    )}/${encodeURIComponent(gh.repo)}/contents/${gh.path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
  }

  async function ghGet() {
    const r = await fetch(ghURL() + "?ref=" + encodeURIComponent(gh.branch), {
      headers: ghHeaders(),
      cache: "no-store",
    });
    if (r.status === 404) return { data: null, sha: null };
    if (!r.ok) throw new Error("GitHub GET " + r.status + " " + (await r.text()).slice(0, 200));
    const j = await r.json();
    ghSha = j.sha;
    let data = null;
    try {
      data = JSON.parse(b64decode(j.content || ""));
    } catch (e) {}
    return { data, sha: j.sha };
  }

  async function ghPut(message) {
    const body = {
      message: message || "update thesis journal",
      content: b64encode(JSON.stringify(snapshot(), null, 2)),
      branch: gh.branch,
    };
    if (ghSha) body.sha = ghSha;
    let r = await fetch(ghURL(), {
      method: "PUT",
      headers: { ...ghHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.status === 409 || r.status === 422) {
      // stale sha — refetch and retry once
      const g = await ghGet();
      body.sha = g.sha || undefined;
      r = await fetch(ghURL(), {
        method: "PUT",
        headers: { ...ghHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    if (!r.ok) throw new Error("GitHub PUT " + r.status + " " + (await r.text()).slice(0, 200));
    const j = await r.json();
    ghSha = j.content && j.content.sha;
  }

  function snapshot() {
    return {
      app: "thesis-journal",
      version: 3,
      updated: new Date().toISOString(),
      entries,
      statusLog,
    };
  }
  async function applySnapshot(data) {
    if (!data) return;
    if (Array.isArray(data.entries)) {
      entries = data.entries;
      await dbReplaceAll(entries);
    }
    if (Array.isArray(data.statusLog)) {
      statusLog = data.statusLog;
      persistStatusLog(false);
    }
    renderStatus();
    render();
  }

  function scheduleSync() {
    if (!gh) return;
    setGhState("syncing", "saving to GitHub…");
    clearTimeout(ghSyncTimer);
    ghSyncTimer = setTimeout(pushToGitHub, 1500);
  }
  async function pushToGitHub() {
    if (!gh) return;
    try {
      setGhState("syncing", "saving to GitHub…");
      await ghPut("journal update — " + new Date().toISOString());
      setGhState("idle", "synced " + new Date().toLocaleTimeString());
    } catch (e) {
      console.error(e);
      setGhState("error", String(e.message || e));
    }
  }

  async function ghConnect() {
    const repo = $("#gh-repo").value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
    const [owner, name] = repo.split("/");
    const token = $("#gh-token").value.trim();
    if (!owner || !name || !token) {
      setGhState("error", "Need owner/repo and a token.");
      return;
    }
    gh = {
      owner,
      repo: name,
      branch: $("#gh-branch").value.trim() || "main",
      path: $("#gh-path").value.trim() || "data.json",
      token,
    };
    setGhState("syncing", "connecting…");
    try {
      const { data } = await ghGet();
      const localHasData = entries.length > 0 || statusLog.length > 0;
      const remoteHasData =
        data && ((data.entries || []).length > 0 || (data.statusLog || []).length > 0);

      if (remoteHasData && localHasData) {
        if (
          confirm(
            "GitHub already has a journal. Replace what's on THIS device with the GitHub copy?\n\nOK = use GitHub's copy   ·   Cancel = overwrite GitHub with this device"
          )
        ) {
          await applySnapshot(data);
        } else {
          await ghPut("overwrite from " + (navigator.platform || "device"));
        }
      } else if (remoteHasData) {
        await applySnapshot(data);
      } else {
        await ghPut("initial journal upload");
      }
      saveGH();
      updateSyncPanel();
      setGhState("idle", "connected · synced " + new Date().toLocaleTimeString());
    } catch (e) {
      console.error(e);
      gh = null;
      setGhState("error", String(e.message || e));
    }
  }
  function ghDisconnect() {
    gh = null;
    ghSha = null;
    saveGH();
    updateSyncPanel();
    setGhState("off");
  }
  async function ghPullNow() {
    if (!gh) return;
    try {
      setGhState("syncing", "pulling…");
      const { data } = await ghGet();
      if (data) await applySnapshot(data);
      setGhState("idle", "pulled · " + new Date().toLocaleTimeString());
    } catch (e) {
      setGhState("error", String(e.message || e));
    }
  }
  function updateSyncPanel() {
    $("#gh-repo").value = gh ? `${gh.owner}/${gh.repo}` : "";
    $("#gh-branch").value = gh ? gh.branch : "main";
    $("#gh-path").value = gh ? gh.path : "data.json";
    $("#gh-token").value = gh ? gh.token : "";
    $("#gh-disconnect").hidden = !gh;
    $("#gh-pull").hidden = !gh;
    $("#gh-connect").textContent = gh ? "Reconnect" : "Connect";
  }

  // Read-only bootstrap: if there's a data.json next to the page and nothing
  // stored yet, load it (lets a hosted copy show entries with no token).
  async function bootstrapFromFile() {
    if (entries.length || statusLog.length) return;
    try {
      const r = await fetch("data.json", { cache: "no-store" });
      if (!r.ok) return;
      const data = await r.json();
      if (
        data &&
        ((data.entries || []).length || (data.statusLog || []).length)
      ) {
        await applySnapshot(data);
      }
    } catch (e) {}
  }

  /* ---------- clock + theme ---------- */

  function tickClock() {
    $("#clock").textContent = new Date().toLocaleTimeString("en-US", {
      hour12: true,
    });
  }
  function toggleTheme() {
    const cur =
      document.documentElement.getAttribute("data-theme") ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light");
    document.documentElement.setAttribute(
      "data-theme",
      cur === "dark" ? "light" : "dark"
    );
    saveUI();
  }

  /* ---------- wiring ---------- */

  function wire() {
    $("#addBtn").onclick = () => openModal(null);
    $("#modalClose").onclick = closeModal;
    $("#cancelBtn").onclick = closeModal;
    $("#deleteBtn").onclick = () => {
      const e = entries.find((x) => x.id === $("#f-id").value);
      if (e) {
        closeModal();
        removeEntry(e);
      }
    };
    $("#entryForm").onsubmit = saveEntry;
    $("#entryModal").onclick = (ev) => {
      if (ev.target === $("#entryModal")) closeModal();
    };
    $("#f-kind").onchange = () => applyKindUI($("#f-kind").value);
    $("#f-date").onchange = updateDateHint;

    // weekly status log
    $("#statusAdd").onclick = () => openStatusEditor(null);
    $("#statusEditCurrent").onclick = () => {}; // set per-render
    $("#statusCancel").onclick = closeStatusEditor;
    $("#statusEditor").onsubmit = saveStatusNote;
    $("#statusInput").addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") saveStatusNote();
      if (e.key === "Escape") closeStatusEditor();
    });
    $("#statusArchiveToggle").onclick = () => {
      statusArchiveOpen = !statusArchiveOpen;
      renderStatus();
    };

    // GitHub sync panel
    $("#syncBtn").onclick = () => {
      updateSyncPanel();
      $("#syncPanel").hidden = false;
    };
    $("#syncClose").onclick = () => ($("#syncPanel").hidden = true);
    $("#syncPanel").onclick = (e) => {
      if (e.target === $("#syncPanel")) $("#syncPanel").hidden = true;
    };
    $("#gh-connect").onclick = ghConnect;
    $("#gh-disconnect").onclick = ghDisconnect;
    $("#gh-pull").onclick = ghPullNow;

    $$("#views .view-btn").forEach((b) => {
      b.onclick = () => {
        filters.view = b.dataset.view;
        saveUI();
        render();
      };
    });

    let t;
    $("#search").oninput = (e) => {
      clearTimeout(t);
      const v = e.target.value;
      t = setTimeout(() => {
        filters.search = v;
        render();
      }, 120);
    };
    $("#sort").onchange = (e) => {
      filters.sort = e.target.value;
      saveUI();
      render();
    };

    $("#exportBtn").onclick = exportData;
    $("#importBtn").onclick = () => $("#importInput").click();
    $("#importInput").onchange = (e) => {
      if (e.target.files[0]) importData(e.target.files[0]);
      e.target.value = "";
    };
    $("#themeBtn").onclick = toggleTheme;

    $("#f-tagInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        commitTagInput();
      } else if (e.key === "Backspace" && !e.target.value && draftTags.length) {
        draftTags.pop();
        renderDraftTags();
      }
    });
    $("#f-tagInput").addEventListener("blur", commitTagInput);
    $("#f-tagEditor").addEventListener("click", () => $("#f-tagInput").focus());

    const dz = $("#f-dropzone");
    dz.onclick = () => $("#f-files").click();
    dz.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        $("#f-files").click();
      }
    };
    $("#f-files").onchange = (e) => {
      ingestFiles([...e.target.files]);
      e.target.value = "";
    };
    ["dragenter", "dragover"].forEach((ev) =>
      dz.addEventListener(ev, (e) => {
        e.preventDefault();
        dz.classList.add("is-drag");
      })
    );
    ["dragleave", "drop"].forEach((ev) =>
      dz.addEventListener(ev, (e) => {
        e.preventDefault();
        dz.classList.remove("is-drag");
      })
    );
    dz.addEventListener("drop", (e) => {
      if (e.dataTransfer.files.length) ingestFiles([...e.dataTransfer.files]);
    });

    document.addEventListener("paste", (e) => {
      if ($("#entryModal").hidden) return;
      const imgs = [...(e.clipboardData?.items || [])]
        .filter((it) => it.type.startsWith("image/"))
        .map((it) => it.getAsFile())
        .filter(Boolean);
      if (imgs.length) {
        e.preventDefault();
        ingestFiles(imgs);
      }
    });

    $("#lightboxClose").onclick = closeLightbox;
    $("#lightbox").onclick = (e) => {
      if (e.target === $("#lightbox")) closeLightbox();
    };
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (!$("#lightbox").hidden) closeLightbox();
        else if (!$("#entryModal").hidden) closeModal();
      }
    });
  }

  /* ---------- init ---------- */

  async function init() {
    loadUI();
    loadGH();
    loadStatusLog();
    wire();
    renderStatus();
    setGhState(gh ? "idle" : "off");
    tickClock();
    setInterval(tickClock, 1000);
    try {
      entries = await dbAll();
    } catch (e) {
      console.error(e);
      entries = [];
    }
    render();
    await bootstrapFromFile();
    if (gh) ghPullNow();
  }

  document.addEventListener("DOMContentLoaded", init);
})();

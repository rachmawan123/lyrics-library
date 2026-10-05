/* ==========================================================================
   Lyrics Library
   Pure HTML / CSS / JavaScript
   IndexedDB persistence
   Offline-first
   ========================================================================== */

"use strict";

/* -------------------------------------------------------------------------- */
/* Lightweight Fuse-compatible fuzzy search engine                            */
/*
   The application intentionally keeps its search engine inside script.js so
   index.html works when opened directly without a web server or CDN.

   It exposes the same basic constructor/search shape used by Fuse.js:
     new Fuse(items, options).search(query)

   Search behavior:
   - exact substring matching
   - token matching
   - prefix matching
   - typo tolerance
   - Unicode-aware matching
   - multiple searchable fields
   - weighted title/artist/alias fields
*/
/* -------------------------------------------------------------------------- */

class Fuse {
  constructor(list = [], options = {}) {
    this.setCollection(list);
    this.options = {
      keys: options.keys || [],
      threshold: options.threshold ?? 0.42,
      ignoreLocation: options.ignoreLocation ?? true,
      includeScore: options.includeScore ?? true,
      minMatchCharLength: options.minMatchCharLength ?? 1,
      shouldSort: options.shouldSort ?? true
    };
  }

  setCollection(list) {
    this.list = Array.isArray(list) ? list : [];
  }

  search(pattern, options = {}) {
    const query = String(pattern ?? "").trim();

    if (!query) {
      return this.list.map((item, refIndex) => ({
        item,
        refIndex,
        score: 0
      }));
    }

    const queryTokens = tokenizeSearch(query);
    const results = [];

    this.list.forEach((item, refIndex) => {
      let bestScore = Infinity;
      let matched = false;

      const keys = this.options.keys.length
        ? this.options.keys
        : [{ name: "value", weight: 1 }];

      for (const keyConfig of keys) {
        const keyName =
          typeof keyConfig === "string"
            ? keyConfig
            : keyConfig.name;

        const weight =
          typeof keyConfig === "object"
            ? Number(keyConfig.weight || 1)
            : 1;

        const value = getNestedValue(item, keyName);

        if (Array.isArray(value)) {
          for (const entry of value) {
            const score = scoreTextAgainstQuery(
              String(entry ?? ""),
              query,
              queryTokens
            );

            if (score < bestScore) bestScore = score;
            if (score <= this.options.threshold * (1 / Math.max(weight, .01))) {
              matched = true;
            }
          }
        } else {
          const score = scoreTextAgainstQuery(
            String(value ?? ""),
            query,
            queryTokens
          );

          const weightedScore = score / Math.max(weight, .01);

          if (weightedScore < bestScore) bestScore = weightedScore;

          if (
            score <=
            this.options.threshold * (1 / Math.max(weight, .01))
          ) {
            matched = true;
          }
        }
      }

      if (matched || bestScore <= this.options.threshold) {
        results.push({
          item,
          refIndex,
          score: Math.max(0, Math.min(1, bestScore))
        });
      }
    });

    if (this.options.shouldSort !== false) {
      results.sort((a, b) => a.score - b.score);
    }

    const limit = options.limit;
    return Number.isFinite(limit)
      ? results.slice(0, limit)
      : results;
  }
}

/* -------------------------------------------------------------------------- */
/* Search helpers                                                             */
/* -------------------------------------------------------------------------- */

function normalizeSearch(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeSearch(value) {
  const normalized = normalizeSearch(value);

  const tokens = normalized
    .split(/\s+/)
    .filter(Boolean);

  return tokens.length ? tokens : [normalized];
}

function getNestedValue(object, path) {
  if (!object || !path) return "";

  return path.split(".").reduce(
    (value, part) => value == null ? undefined : value[part],
    object
  );
}

function levenshtein(a, b) {
  a = Array.from(a);
  b = Array.from(b);

  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 0; i < a.length; i++) {
    const current = [i + 1];

    for (let j = 0; j < b.length; j++) {
      const insertCost = current[j] + 1;
      const deleteCost = previous[j + 1] + 1;
      const replaceCost = previous[j] + (a[i] === b[j] ? 0 : 1);

      current.push(
        Math.min(insertCost, deleteCost, replaceCost)
      );
    }

    previous = current;
  }

  return previous[b.length];
}

function characterDistanceScore(query, target) {
  if (!query || !target) return 1;

  if (target === query) return 0;
  if (target.includes(query)) return .025;

  const queryLength = Array.from(query).length;
  const targetLength = Array.from(target).length;

  if (
    queryLength === 1 &&
    target.includes(query)
  ) {
    return .05;
  }

  const maxDistance = Math.max(
    1,
    Math.floor(Math.max(queryLength, targetLength) * .38)
  );

  if (Math.abs(queryLength - targetLength) > maxDistance) {
    return 1;
  }

  const distance = levenshtein(query, target);

  return distance / Math.max(queryLength, targetLength, 1);
}

function bestTokenMatch(queryToken, textTokens, normalizedText) {
  if (!queryToken) return 1;

  if (normalizedText.includes(queryToken)) {
    const index = normalizedText.indexOf(queryToken);

    if (index === 0) return .015;
    return .04;
  }

  let best = 1;

  for (const token of textTokens) {
    const score = characterDistanceScore(queryToken, token);
    if (score < best) best = score;
  }

  /*
    Partial Latin transliteration matching.
    "maba" -> "mabataki"
  */
  for (const token of textTokens) {
    if (
      queryToken.length >= 3 &&
      token.startsWith(queryToken)
    ) {
      best = Math.min(best, .035);
    }
  }

  return best;
}

function scoreTextAgainstQuery(text, query, queryTokens) {
  const normalizedText = normalizeSearch(text);

  if (!normalizedText) return 1;

  const textTokens = normalizedText.split(/\s+/);

  if (normalizedText === normalizeSearch(query)) {
    return 0;
  }

  /*
    For a multi-word search, require all tokens to have a reasonable
    match somewhere in the field.
  */
  const tokenScores = queryTokens.map(token =>
    bestTokenMatch(token, textTokens, normalizedText)
  );

  const worst = Math.max(...tokenScores);
  const average =
    tokenScores.reduce((sum, value) => sum + value, 0) /
    tokenScores.length;

  /*
    Full query substring gets a particularly strong result.
  */
  if (normalizedText.includes(normalizeSearch(query))) {
    return Math.min(.02, average);
  }

  return (worst * .7) + (average * .3);
}

/* -------------------------------------------------------------------------- */
/* Database                                                                  */
/* -------------------------------------------------------------------------- */

const DB_NAME = "lyrics-library-db";
const DB_VERSION = 1;
const SONG_STORE = "songs";
const META_STORE = "meta";

let db = null;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = event => {
      const database = event.target.result;

      if (!database.objectStoreNames.contains(SONG_STORE)) {
        const store = database.createObjectStore(
          SONG_STORE,
          { keyPath: "id", autoIncrement: true }
        );

        store.createIndex("title", "title", { unique: false });
        store.createIndex("artist", "artist", { unique: false });
        store.createIndex("created_at", "created_at", { unique: false });
        store.createIndex("last_viewed", "last_viewed", { unique: false });
        store.createIndex("favorite", "favorite", { unique: false });
        store.createIndex("pinned", "pinned", { unique: false });
      }

      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };

    request.onsuccess = () => {
      db = request.result;

      db.onversionchange = () => {
        db.close();
      };

      resolve(db);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

function transaction(storeName, mode = "readonly") {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAllSongs() {
  return idbRequest(transaction(SONG_STORE).getAll());
}

async function getSong(id) {
  return idbRequest(transaction(SONG_STORE).get(Number(id)));
}

async function putSong(song) {
  return idbRequest(
    transaction(SONG_STORE, "readwrite").put(song)
  );
}

async function addSong(song) {
  return idbRequest(
    transaction(SONG_STORE, "readwrite").add(song)
  );
}

async function deleteSongFromDB(id) {
  return idbRequest(
    transaction(SONG_STORE, "readwrite").delete(Number(id))
  );
}

async function clearSongDB() {
  return new Promise((resolve, reject) => {
    const request = transaction(SONG_STORE, "readwrite").clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function getMeta(key, fallback = null) {
  const result = await idbRequest(
    transaction(META_STORE).get(key)
  );

  return result ? result.value : fallback;
}

async function setMeta(key, value) {
  return idbRequest(
    transaction(META_STORE, "readwrite").put({
      key,
      value
    })
  );
}

/* -------------------------------------------------------------------------- */
/* Application state                                                          */
/* -------------------------------------------------------------------------- */

const state = {
  songs: [],
  fuse: null,

  currentView: "dashboard",
  libraryFilter: "all",

  searchQuery: "",
  searchHistory: [],

  sort: "title",
  layout: "list",

  currentSongId: null,
  readerSongId: null,

  readerFontSize: Number(
    localStorage.getItem("lyricsReaderFontSize") || 20
  ),

  readerLineHeight: Number(
    localStorage.getItem("lyricsReaderLineHeight") || 1.85
  ),

  readerScroll: {},

  pendingConfirm: null
};

const SEARCH_KEYS = [
  { name: "title", weight: 1.5 },
  { name: "artist", weight: 1.3 },
  { name: "aliases", weight: 1.25 },
  { name: "search_index", weight: 1.1 },
  { name: "lyrics", weight: .7 },
  { name: "translation", weight: .6 }
];

/* -------------------------------------------------------------------------- */
/* DOM helpers                                                                */
/* -------------------------------------------------------------------------- */

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeDate(value) {
  if (!value) return null;

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : date;
}

function formatDate(value) {
  const date = safeDate(value);

  if (!date) return "—";

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(date);
}

function formatDateTime(value) {
  const date = safeDate(value);

  if (!date) return "—";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function relativeDate(value) {
  const date = safeDate(value);

  if (!date) return "";

  const delta = Date.now() - date.getTime();

  if (delta < 60 * 1000) return "Just now";
  if (delta < 60 * 60 * 1000) {
    return `${Math.floor(delta / 60000)}m ago`;
  }

  if (delta < 24 * 60 * 60 * 1000) {
    return `${Math.floor(delta / 3600000)}h ago`;
  }

  if (delta < 7 * 24 * 60 * 60 * 1000) {
    return `${Math.floor(delta / 86400000)}d ago`;
  }

  return formatDate(value);
}

function debounce(fn, delay = 120) {
  let timer;

  return (...args) => {
    clearTimeout(timer);

    timer = setTimeout(
      () => fn(...args),
      delay
    );
  };
}

/* -------------------------------------------------------------------------- */
/* Song normalization                                                         */
/* -------------------------------------------------------------------------- */

function makeSearchIndex(song) {
  return [
    song.title,
    song.artist,
    ...(Array.isArray(song.aliases) ? song.aliases : [])
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeSong(song) {
  const now = new Date().toISOString();

  const aliases = Array.isArray(song.aliases)
    ? song.aliases
      .map(x => String(x).trim())
      .filter(Boolean)
    : [];

  const normalized = {
    id: song.id != null ? Number(song.id) : undefined,
    title: String(song.title ?? "").trim(),
    artist: String(song.artist ?? "").trim(),
    aliases,
    lyrics: String(song.lyrics ?? ""),
    translation: String(song.translation ?? ""),
    favorite: Boolean(song.favorite),
    pinned: Boolean(song.pinned),
    created_at: song.created_at || now,
    last_viewed: song.last_viewed || "",
    view_count: Number(song.view_count || 0)
  };

  normalized.search_index = makeSearchIndex(normalized);

  return normalized;
}

function rebuildSearchIndex() {
  state.songs.forEach(song => {
    song.search_index = makeSearchIndex(song);
  });

  state.fuse = new Fuse(state.songs, {
    keys: SEARCH_KEYS,
    threshold: .46,
    ignoreLocation: true,
    includeScore: true,
    shouldSort: true
  });
}

/* -------------------------------------------------------------------------- */
/* Sample data                                                                */
/* -------------------------------------------------------------------------- */

function sampleSongs() {
  const now = Date.now();

  return [
    normalizeSong({
      title: "瞬き",
      artist: "DAZBEE",
      aliases: ["Mabataki", "Blink"],
      lyrics:
        "Sample lyrics entry.\n\nReplace this with your own lyrics.",
      translation:
        "Sample translation.\n\nReplace this with your own translation.",
      favorite: true,
      pinned: true,
      created_at: new Date(now - 86400000 * 3).toISOString()
    }),

    normalizeSong({
      title: "アイドル",
      artist: "YOASOBI",
      aliases: ["Idol"],
      lyrics: "",
      translation: "",
      created_at: new Date(now - 86400000 * 2).toISOString()
    }),

    normalizeSong({
      title: "うっせぇわ",
      artist: "Ado",
      aliases: ["Usseewa", "Usseewa"],
      lyrics: "",
      translation: "",
      created_at: new Date(now - 86400000).toISOString()
    })
  ];
}

async function seedDatabaseIfEmpty() {
  const songs = await getAllSongs();

  if (songs.length > 0) return;

  for (const song of sampleSongs()) {
    delete song.id;
    await addSong(song);
  }
}

/* -------------------------------------------------------------------------- */
/* Search                                                                     */
/* -------------------------------------------------------------------------- */

function searchSongs(query) {
  const normalized = query.trim();

  if (!normalized) {
    return state.songs.slice();
  }

  return state.fuse
    .search(normalized)
    .map(result => result.item);
}

function filteredSongs() {
  let songs;

  if (state.searchQuery.trim()) {
    songs = searchSongs(state.searchQuery);
  } else {
    songs = state.songs.slice();
  }

  switch (state.libraryFilter) {
    case "favorites":
      songs = songs.filter(song => song.favorite);
      break;

    case "pinned":
      songs = songs.filter(song => song.pinned);
      break;

    default:
      break;
  }

  return sortSongs(songs);
}

function sortSongs(songs) {
  const result = songs.slice();

  result.sort((a, b) => {
    /*
      Pinned songs are always above ordinary songs in library views.
    */
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }

    switch (state.sort) {
      case "artist":
        return compareText(a.artist, b.artist) ||
          compareText(a.title, b.title);

      case "created_desc":
        return dateValue(b.created_at) - dateValue(a.created_at);

      case "viewed_desc":
        return dateValue(b.last_viewed) - dateValue(a.last_viewed);

      case "views_desc":
        return (b.view_count || 0) - (a.view_count || 0);

      case "title":
      default:
        return compareText(a.title, b.title);
    }
  });

  return result;
}

function compareText(a, b) {
  return String(a || "").localeCompare(
    String(b || ""),
    undefined,
    {
      numeric: true,
      sensitivity: "base"
    }
  );
}

function dateValue(value) {
  const time = Date.parse(value || "");

  return Number.isFinite(time)
    ? time
    : 0;
}

/* -------------------------------------------------------------------------- */
/* Search history                                                             */
/* -------------------------------------------------------------------------- */

async function loadSearchHistory() {
  state.searchHistory = await getMeta(
    "search_history",
    []
  );

  if (!Array.isArray(state.searchHistory)) {
    state.searchHistory = [];
  }
}

async function saveSearchTerm(term) {
  term = term.trim();

  if (!term) return;

  const normalized = normalizeSearch(term);

  state.searchHistory = state.searchHistory.filter(
    entry => normalizeSearch(entry.term) !== normalized
  );

  state.searchHistory.unshift({
    term,
    created_at: new Date().toISOString()
  });

  state.searchHistory = state.searchHistory.slice(0, 30);

  await setMeta(
    "search_history",
    state.searchHistory
  );
}

async function clearSearchHistory() {
  state.searchHistory = [];
  await setMeta("search_history", []);
  renderSearchHistory();
  renderDashboardSearchHistory();
  renderFullHistory();
  updateBackupStats();
}

/* -------------------------------------------------------------------------- */
/* Duplicate detection                                                        */
/* -------------------------------------------------------------------------- */

function duplicateScore(candidate, existing) {
  const candidateTitle = normalizeSearch(candidate.title);
  const existingTitle = normalizeSearch(existing.title);

  if (!candidateTitle || !existingTitle) return 1;

  const titleScore = scoreTextAgainstQuery(
    existingTitle,
    candidateTitle,
    [candidateTitle]
  );

  let artistScore = 1;

  if (candidate.artist && existing.artist) {
    artistScore = scoreTextAgainstQuery(
      normalizeSearch(existing.artist),
      normalizeSearch(candidate.artist),
      [normalizeSearch(candidate.artist)]
    );
  }

  const candidateAliases = candidate.aliases || [];
  const existingAliases = existing.aliases || [];

  let aliasScore = 1;

  for (const alias of candidateAliases) {
    for (const existingAlias of existingAliases) {
      aliasScore = Math.min(
        aliasScore,
        characterDistanceScore(
          normalizeSearch(alias),
          normalizeSearch(existingAlias)
        )
      );
    }
  }

  /*
    Strong title match is the most important signal.
  */
  return (
    titleScore * .58 +
    artistScore * .27 +
    aliasScore * .15
  );
}

function findPotentialDuplicates(candidate, editingId = null) {
  return state.songs
    .filter(song => Number(song.id) !== Number(editingId))
    .map(song => ({
      song,
      score: duplicateScore(candidate, song)
    }))
    .filter(result => result.score < .34)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);
}

/* -------------------------------------------------------------------------- */
/* Rendering: dashboard                                                       */
/* -------------------------------------------------------------------------- */

function renderDashboard() {
  const songs = state.songs;

  $("#statSongs").textContent = songs.length;

  const artists = new Set(
    songs
      .map(song => normalizeSearch(song.artist))
      .filter(Boolean)
  );

  $("#statArtists").textContent = artists.size;
  $("#statFavorites").textContent =
    songs.filter(song => song.favorite).length;
  $("#statPinned").textContent =
    songs.filter(song => song.pinned).length;

  $("#navSongCount").textContent = songs.length;
  $("#navFavoriteCount").textContent =
    songs.filter(song => song.favorite).length;
  $("#navPinnedCount").textContent =
    songs.filter(song => song.pinned).length;

  const mostViewed = songs
    .slice()
    .sort((a,b) =>
      (b.view_count || 0) - (a.view_count || 0)
    )
    .filter(song => song.view_count > 0)
    .slice(0, 6);

  const recentlyViewed = songs
    .slice()
    .filter(song => song.last_viewed)
    .sort((a,b) =>
      dateValue(b.last_viewed) - dateValue(a.last_viewed)
    )
    .slice(0, 6);

  $("#mostViewedList").innerHTML =
    renderDashboardRows(
      mostViewed,
      "No songs have been viewed yet."
    );

  $("#recentViewedList").innerHTML =
    renderDashboardRows(
      recentlyViewed,
      "Recently opened songs will appear here."
    );

  $("#emptyDashboard").classList.toggle(
    "hidden",
    songs.length > 0
  );

  renderSidebarRecent(recentlyViewed.slice(0, 5));
  renderDashboardSearchHistory();
}

function renderDashboardRows(songs, emptyText) {
  if (!songs.length) {
    return `
      <div class="empty-state" style="padding:30px 15px">
        <p style="margin:0">${escapeHTML(emptyText)}</p>
      </div>
    `;
  }

  return songs
    .map(song => renderSongRow(song, {
      dashboard: true
    }))
    .join("");
}

function renderSidebarRecent(songs) {
  const container = $("#sidebarRecent");

  if (!songs.length) {
    container.innerHTML =
      `<div class="empty-sidebar">Nothing viewed yet</div>`;
    return;
  }

  container.innerHTML = songs.map(song => `
    <div
      class="sidebar-recent-item"
      data-open-song="${song.id}"
      title="${escapeHTML(song.title)}"
    >
      <div class="sidebar-recent-art">♪</div>
      <div>
        <div class="sidebar-recent-title">${escapeHTML(song.title || "Untitled")}</div>
        <div class="sidebar-recent-artist">${escapeHTML(song.artist || "Unknown artist")}</div>
      </div>
    </div>
  `).join("");
}

function renderDashboardSearchHistory() {
  const container = $("#dashboardSearchHistory");

  if (!state.searchHistory.length) {
    container.innerHTML =
      `<div class="empty-chip">No searches yet.</div>`;
    return;
  }

  container.innerHTML = state.searchHistory
    .slice(0, 12)
    .map(entry => `
      <button
        class="search-chip"
        type="button"
        data-history-search="${escapeHTML(entry.term)}"
        title="${escapeHTML(entry.term)}"
      >
        <span>⌕ ${escapeHTML(entry.term)}</span>
      </button>
    `)
    .join("");
}

/* -------------------------------------------------------------------------- */
/* Rendering: library                                                         */
/* -------------------------------------------------------------------------- */

function renderLibrary() {
  const songs = filteredSongs();

  const titleMap = {
    all: "All Songs",
    favorites: "Favorites",
    pinned: "Pinned"
  };

  const subtitleMap = {
    all: "Your complete lyrics collection.",
    favorites: "Songs you marked as favorites.",
    pinned: "Songs kept at the top of your library."
  };

  $("#libraryTitle").textContent =
    titleMap[state.libraryFilter] || "All Songs";

  $("#librarySubtitle").textContent =
    subtitleMap[state.libraryFilter] ||
    "Your lyrics collection.";

  $("#libraryEyebrow").textContent =
    state.searchQuery
      ? "SEARCH RESULTS"
      : "LIBRARY";

  $("#resultCount").textContent =
    `${songs.length.toLocaleString()} ${
      songs.length === 1 ? "song" : "songs"
    }`;

  renderActiveFilters();

  const list = $("#libraryList");

  list.classList.toggle(
    "list-layout",
    state.layout === "list"
  );

  list.classList.toggle(
    "compact-layout",
    state.layout === "compact"
  );

  list.classList.toggle(
    "card-layout",
    state.layout === "card"
  );

  if (!songs.length) {
    list.innerHTML = "";

    $("#libraryEmpty").classList.remove("hidden");

    if (state.searchQuery) {
      $("#libraryEmptyTitle").textContent =
        "No matching songs";

      $("#libraryEmptyText").textContent =
        `Nothing matched “${state.searchQuery}”.`;
    } else if (state.libraryFilter === "favorites") {
      $("#libraryEmptyTitle").textContent =
        "No favorites yet";

      $("#libraryEmptyText").textContent =
        "Star songs to keep them in your favorites.";
    } else if (state.libraryFilter === "pinned") {
      $("#libraryEmptyTitle").textContent =
        "Nothing is pinned";

      $("#libraryEmptyText").textContent =
        "Pin important songs to keep them at the top.";
    } else {
      $("#libraryEmptyTitle").textContent =
        "Your library is empty";

      $("#libraryEmptyText").textContent =
        "Add your first song to get started.";
    }

    return;
  }

  $("#libraryEmpty").classList.add("hidden");

  list.innerHTML = songs
    .map(song => renderSongRow(song))
    .join("");
}

function renderActiveFilters() {
  const container = $("#activeFilterChips");

  const chips = [];

  if (state.libraryFilter === "favorites") {
    chips.push("★ Favorites");
  }

  if (state.libraryFilter === "pinned") {
    chips.push("⌖ Pinned");
  }

  if (state.searchQuery) {
    chips.push(`⌕ ${state.searchQuery}`);
  }

  container.innerHTML = chips
    .map(chip => `
      <span class="filter-chip">${escapeHTML(chip)}</span>
    `)
    .join("");
}

function renderSongRow(song) {
  const title = song.title || "Untitled";
  const artist = song.artist || "Unknown artist";

  const aliases = Array.isArray(song.aliases)
    ? song.aliases.filter(Boolean)
    : [];

  const aliasText =
    aliases.length
      ? aliases.slice(0, 3).join(" · ")
      : "";

  const favoriteClass = song.favorite
    ? "active"
    : "";

  const pinClass = song.pinned
    ? "active"
    : "";

  const badges = `
    <span class="song-badges">
      ${song.favorite ? `<span class="song-badge">★</span>` : ""}
      ${song.pinned ? `<span class="song-badge">⌖</span>` : ""}
    </span>
  `;

  return `
    <article class="song-row" data-song-row="${song.id}">
      <div class="song-art" data-open-song="${song.id}">♪</div>

      <div class="song-main" data-open-song="${song.id}">
        <div class="song-title-line">
          <div class="song-title">${escapeHTML(title)}</div>
          ${badges}
        </div>

        <div class="song-artist">${escapeHTML(artist)}</div>

        ${
          aliasText
            ? `<div class="song-alias">${escapeHTML(aliasText)}</div>`
            : ""
        }
      </div>

      <div class="song-actions">
        <span class="song-view-count">
          ${song.view_count ? `${song.view_count} views` : ""}
        </span>

        <button
          class="song-action favorite ${favoriteClass}"
          data-favorite-song="${song.id}"
          type="button"
          aria-label="${song.favorite ? "Remove favorite" : "Favorite"}"
          title="${song.favorite ? "Remove favorite" : "Favorite"}"
        >${song.favorite ? "★" : "☆"}</button>

        <button
          class="song-action pin ${pinClass}"
          data-pin-song="${song.id}"
          type="button"
          aria-label="${song.pinned ? "Unpin song" : "Pin song"}"
          title="${song.pinned ? "Unpin song" : "Pin song"}"
        >⌖</button>

        <button
          class="song-action"
          data-edit-song="${song.id}"
          type="button"
          aria-label="Edit song"
          title="Edit song"
        >✎</button>
      </div>
    </article>
  `;
}

/* -------------------------------------------------------------------------- */
/* Rendering: history                                                        */
/* -------------------------------------------------------------------------- */

function renderSearchHistory() {
  const container = $("#searchHistoryList");

  if (!state.searchHistory.length) {
    container.innerHTML = `
      <div class="empty-state" style="padding:30px">
        <p style="margin:0">No recent searches.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = state.searchHistory
    .slice(0, 10)
    .map(entry => `
      <div
        class="history-search-row"
        data-history-search="${escapeHTML(entry.term)}"
      >
        <span class="history-search-icon">◷</span>
        <span class="history-search-term">${escapeHTML(entry.term)}</span>
        <span class="history-search-date">${relativeDate(entry.created_at)}</span>
      </div>
    `)
    .join("");
}

function renderFullHistory() {
  const container = $("#fullSearchHistory");

  if (!state.searchHistory.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-art">◷</div>
        <h2>No search history</h2>
        <p>Your recent searches will appear here.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = state.searchHistory
    .map(entry => `
      <div class="history-full-row">
        <div class="history-full-icon">◷</div>

        <div class="history-full-main">
          <div class="history-full-term">${escapeHTML(entry.term)}</div>
          <div class="history-full-date">${formatDateTime(entry.created_at)}</div>
        </div>

        <button
          class="secondary-btn"
          type="button"
          data-history-search="${escapeHTML(entry.term)}"
        >Search</button>
      </div>
    `)
    .join("");
}

/* -------------------------------------------------------------------------- */
/* Navigation                                                                 */
/* -------------------------------------------------------------------------- */

function setActiveNav(view) {
  $$(".nav-item[data-view]").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.view === view
    );
  });
}

function showView(view) {
  state.currentView = view;

  $$(".view").forEach(element => {
    element.classList.remove("active-view");
  });

  const target = $(`#${view}View`);

  if (target) {
    target.classList.add("active-view");
  }

  setActiveNav(
    view === "history"
      ? "none"
      : view === "backup"
        ? "none"
        : view
  );

  if (view === "dashboard") {
    renderDashboard();
  }

  if (view === "library") {
    renderLibrary();
  }

  if (view === "history") {
    renderFullHistory();
  }

  if (view === "backup") {
    updateBackupStats();
  }

  closeMobileSidebar();
}

function setLibraryFilter(filter) {
  state.libraryFilter = filter;
  state.searchQuery = "";

  $("#globalSearch").value = "";

  updateSearchVisualState();
  showView("library");
  renderLibrary();
}

function setSearch(query, saveHistory = true) {
  state.searchQuery = query.trim();

  $("#globalSearch").value = state.searchQuery;

  updateSearchVisualState();

  if (state.searchQuery) {
    state.libraryFilter = "all";

    if (saveHistory) {
      saveSearchTerm(state.searchQuery)
        .then(() => {
          renderSearchHistory();
          renderDashboardSearchHistory();
          renderFullHistory();
          updateBackupStats();
        });
    }

    showView("library");
  } else {
    if (state.currentView === "library") {
      renderLibrary();
    }
  }

  renderLibrary();
}

function updateSearchVisualState() {
  const box = $(".search-box");

  box.classList.toggle(
    "has-value",
    Boolean($("#globalSearch").value)
  );
}

/* -------------------------------------------------------------------------- */
/* Song editor                                                                */
/* -------------------------------------------------------------------------- */

function openAddSong() {
  state.currentSongId = null;

  $("#editorTitle").textContent = "Add Song";
  $("#songId").value = "";
  $("#titleInput").value = "";
  $("#artistInput").value = "";
  $("#aliasesInput").value = "";
  $("#lyricsInput").value = "";
  $("#translationInput").value = "";

  $("#deleteSongBtn").classList.add("hidden");
  $("#duplicateWarning").classList.add("hidden");

  openModal("editorModal");

  setTimeout(() => {
    $("#titleInput").focus();
  }, 80);
}

async function openEditSong(id) {
  const song = await getSong(id);

  if (!song) {
    showToast("Song could not be found.", "error");
    return;
  }

  state.currentSongId = song.id;

  $("#editorTitle").textContent = "Edit Song";
  $("#songId").value = song.id;
  $("#titleInput").value = song.title || "";
  $("#artistInput").value = song.artist || "";
  $("#aliasesInput").value =
    (song.aliases || []).join("\n");
  $("#lyricsInput").value = song.lyrics || "";
  $("#translationInput").value = song.translation || "";

  $("#deleteSongBtn").classList.remove("hidden");
  $("#duplicateWarning").classList.add("hidden");

  openModal("editorModal");
}

function getFormSong() {
  const aliases = $("#aliasesInput")
    .value
    .split(/\r?\n/)
    .map(value => value.trim())
    .filter(Boolean);

  return normalizeSong({
    id: $("#songId").value
      ? Number($("#songId").value)
      : undefined,

    title: $("#titleInput").value,

    artist: $("#artistInput").value,

    aliases,

    lyrics: $("#lyricsInput").value,

    translation: $("#translationInput").value
  });
}

function updateDuplicateWarning() {
  const candidate = getFormSong();

  if (!candidate.title.trim()) {
    $("#duplicateWarning").classList.add("hidden");
    return;
  }

  const duplicates = findPotentialDuplicates(
    candidate,
    state.currentSongId
  );

  if (!duplicates.length) {
    $("#duplicateWarning").classList.add("hidden");
    return;
  }

  const names = duplicates
    .map(result => {
      const artist = result.song.artist
        ? ` — ${result.song.artist}`
        : "";

      return `${result.song.title}${artist}`;
    })
    .join(", ");

  $("#duplicateWarningText").textContent =
    `This may already exist: ${names}. You can still save this song.`;

  $("#duplicateWarning").classList.remove("hidden");
}

async function saveSongFromForm(event) {
  event.preventDefault();

  const candidate = getFormSong();

  if (!candidate.title.trim()) {
    $("#titleInput").focus();
    showToast("Title is required.", "error");
    return;
  }

  const editingId = state.currentSongId;

  if (editingId) {
    const old = await getSong(editingId);

    candidate.id = Number(editingId);
    candidate.created_at =
      old?.created_at ||
      new Date().toISOString();

    candidate.last_viewed =
      old?.last_viewed || "";

    candidate.view_count =
      old?.view_count || 0;

    candidate.favorite =
      old?.favorite || false;

    candidate.pinned =
      old?.pinned || false;

    await putSong(candidate);

    showToast("Song updated.", "success");
  } else {
    candidate.created_at =
      new Date().toISOString();

    const id = await addSong(candidate);

    candidate.id = Number(id);

    showToast("Song added to your library.", "success");
  }

  await refreshSongs();

  closeModal("editorModal");

  if (
    state.currentView === "library" ||
    state.currentView === "dashboard"
  ) {
    renderDashboard();
    renderLibrary();
  }
}

async function deleteCurrentSong() {
  const id = Number(state.currentSongId);

  if (!id) return;

  const song = await getSong(id);

  if (!song) return;

  closeModal("editorModal");

  askConfirm(
    "Delete song?",
    `“${song.title || "Untitled"}” will be permanently removed from this device.`,
    async () => {
      await deleteSongFromDB(id);

      if (state.readerSongId === id) {
        closeReader();
      }

      await refreshSongs();
      renderDashboard();
      renderLibrary();

      showToast("Song deleted.", "success");
    }
  );
}

/* -------------------------------------------------------------------------- */
/* Song actions                                                               */
/* -------------------------------------------------------------------------- */

async function toggleFavorite(id) {
  const song = await getSong(id);

  if (!song) return;

  song.favorite = !song.favorite;

  await putSong(song);
  await refreshSongs();

  renderDashboard();
  renderLibrary();

  if (state.readerSongId === id) {
    updateReaderControls(song);
  }
}

async function togglePinned(id) {
  const song = await getSong(id);

  if (!song) return;

  song.pinned = !song.pinned;

  await putSong(song);
  await refreshSongs();

  renderDashboard();
  renderLibrary();

  if (state.readerSongId === id) {
    updateReaderControls(song);
  }
}

/* -------------------------------------------------------------------------- */
/* Reader                                                                     */
/* -------------------------------------------------------------------------- */

async function openReader(id) {
  const song = await getSong(id);

  if (!song) {
    showToast("Song could not be found.", "error");
    return;
  }

  song.last_viewed = new Date().toISOString();
  song.view_count = Number(song.view_count || 0) + 1;

  await putSong(song);
  await refreshSongs();

  state.readerSongId = song.id;

  renderReader(song);

  $("#readerModal").classList.remove("hidden");
  document.body.style.overflow = "hidden";

  requestAnimationFrame(() => {
    const saved = state.readerScroll[song.id];

    $("#readerModal .reader-body").scrollTop =
      Number(saved || 0);
  });
}

function renderReader(song) {
  $("#readerTitle").textContent =
    song.title || "Untitled";

  $("#readerArtist").textContent =
    song.artist || "Unknown artist";

  $("#readerViewCount").textContent =
    `${song.view_count || 0} views`;

  $("#readerCreated").textContent =
    `Added ${formatDate(song.created_at)}`;

  const lyrics = song.lyrics || "";
  const translation = song.translation || "";

  $("#readerLyrics").textContent = lyrics;

  $("#readerNoLyrics").classList.toggle(
    "hidden",
    Boolean(lyrics.trim())
  );

  $("#readerTranslation").textContent =
    translation;

  $("#translationSection").classList.toggle(
    "hidden",
    !translation.trim()
  );

  applyReaderTypography();
  updateReaderControls(song);
}

function updateReaderControls(song) {
  $("#readerFavorite").classList.toggle(
    "active",
    song.favorite
  );

  $("#readerFavorite").textContent =
    song.favorite ? "★" : "☆";

  $("#readerPin").classList.toggle(
    "active",
    song.pinned
  );

  $("#readerPin").textContent =
    song.pinned ? "⌖" : "⌖";
}

function closeReader() {
  const body = $("#readerModal .reader-body");

  if (state.readerSongId && body) {
    state.readerScroll[state.readerSongId] =
      body.scrollTop;

    localStorage.setItem(
      "lyricsReaderScroll",
      JSON.stringify(state.readerScroll)
    );
  }

  $("#readerModal").classList.add("hidden");
  document.body.style.overflow = "";

  state.readerSongId = null;
}

function changeReaderFont(delta) {
  state.readerFontSize = Math.max(
    14,
    Math.min(38, state.readerFontSize + delta)
  );

  localStorage.setItem(
    "lyricsReaderFontSize",
    String(state.readerFontSize)
  );

  applyReaderTypography();
}

function applyReaderTypography() {
  document.documentElement.style.setProperty(
    "--reader-font-size",
    `${state.readerFontSize}px`
  );

  document.documentElement.style.setProperty(
    "--reader-line-height",
    String(state.readerLineHeight)
  );
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage, "success");
  } catch {
    /*
      Clipboard API can be unavailable when index.html is opened from
      file://. Fall back to a temporary textarea.
    */
    const textarea = document.createElement("textarea");

    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";

    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
      document.execCommand("copy");
      showToast(successMessage, "success");
    } catch {
      showToast(
        "Copy is unavailable in this browser.",
        "error"
      );
    }

    textarea.remove();
  }
}

/* -------------------------------------------------------------------------- */
/* Backup / restore                                                           */
/* -------------------------------------------------------------------------- */

async function exportBackup() {
  const songs = await getAllSongs();

  const backup = {
    version: 1,
    exported_at: new Date().toISOString(),
    songs: songs.map(song => normalizeSong(song))
  };

  const blob = new Blob(
    [JSON.stringify(backup, null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = "lyrics_library.json";

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);

  showToast(
    `${songs.length} songs exported.`,
    "success"
  );
}

async function importBackupFile(file) {
  if (!file) return;

  try {
    const text = await file.text();
    const backup = JSON.parse(text);

    if (
      !backup ||
      Number(backup.version) !== 1 ||
      !Array.isArray(backup.songs)
    ) {
      throw new Error("Invalid backup format.");
    }

    const songs = backup.songs.map(normalizeSong);

    askConfirm(
      "Restore backup?",
      `This backup contains ${songs.length} songs. Existing songs with matching IDs will be replaced.`,
      async () => {
        for (const song of songs) {
          if (!Number.isFinite(Number(song.id))) {
            delete song.id;
          }

          if (song.id) {
            await putSong(song);
          } else {
            await addSong(song);
          }
        }

        await refreshSongs();

        renderDashboard();
        renderLibrary();
        updateBackupStats();

        showToast(
          `${songs.length} songs restored.`,
          "success"
        );
      }
    );
  } catch (error) {
    console.error(error);

    showToast(
      "Could not import that backup file.",
      "error"
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Backup stats                                                               */
/* -------------------------------------------------------------------------- */

function updateBackupStats() {
  $("#backupSongCount").textContent =
    state.songs.length;

  $("#backupFavoriteCount").textContent =
    state.songs.filter(song => song.favorite).length;

  $("#backupPinnedCount").textContent =
    state.songs.filter(song => song.pinned).length;

  $("#backupSearchCount").textContent =
    state.searchHistory.length;
}

/* -------------------------------------------------------------------------- */
/* Modal utilities                                                            */
/* -------------------------------------------------------------------------- */

function openModal(id) {
  $(`#${id}`).classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeModal(id) {
  $(`#${id}`).classList.add("hidden");

  if (
    $("#editorModal").classList.contains("hidden") &&
    $("#confirmModal").classList.contains("hidden") &&
    $("#readerModal").classList.contains("hidden")
  ) {
    document.body.style.overflow = "";
  }
}

function askConfirm(title, text, callback) {
  $("#confirmTitle").textContent = title;
  $("#confirmText").textContent = text;

  state.pendingConfirm = callback;

  openModal("confirmModal");
}

/* -------------------------------------------------------------------------- */
/* Toast                                                                      */
/* -------------------------------------------------------------------------- */

function showToast(message, type = "") {
  const container = $("#toastContainer");

  const toast = document.createElement("div");

  toast.className = `toast ${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(6px)";

    setTimeout(() => toast.remove(), 180);
  }, 2600);
}

/* -------------------------------------------------------------------------- */
/* Refresh                                                                    */
/* -------------------------------------------------------------------------- */

async function refreshSongs() {
  state.songs = await getAllSongs();

  state.songs = state.songs.map(normalizeSong);

  rebuildSearchIndex();
}

/* -------------------------------------------------------------------------- */
/* Mobile sidebar                                                             */
/* -------------------------------------------------------------------------- */

function closeMobileSidebar() {
  $("#sidebar").classList.remove("mobile-open");
}

function toggleMobileSidebar() {
  $("#sidebar").classList.toggle("mobile-open");
}

/* -------------------------------------------------------------------------- */
/* Event handlers                                                             */
/* -------------------------------------------------------------------------- */

function bindEvents() {
  /*
    Navigation.
  */
  $$(".nav-item[data-view]").forEach(button => {
    button.addEventListener("click", () => {
      const view = button.dataset.view;

      if (view === "favorites") {
        setLibraryFilter("favorites");
        return;
      }

      if (view === "pinned") {
        setLibraryFilter("pinned");
        return;
      }

      showView(view);
    });
  });

  $$(".nav-item[data-action]").forEach(button => {
    button.addEventListener("click", () => {
      const action = button.dataset.action;

      if (action === "search-history") {
        showView("history");
      }

      if (action === "backup") {
        showView("backup");
      }
    });
  });

  /*
    Add buttons.
  */
  $("#newSongBtn").addEventListener(
    "click",
    openAddSong
  );

  $("#addSongTopBtn").addEventListener(
    "click",
    openAddSong
  );

  $("#dashboardAddBtn").addEventListener(
    "click",
    openAddSong
  );

  $("#emptyAddBtn").addEventListener(
    "click",
    openAddSong
  );

  $("#libraryEmptyBtn").addEventListener(
    "click",
    openAddSong
  );

  /*
    Mobile sidebar.
  */
  $("#mobileMenuBtn").addEventListener(
    "click",
    toggleMobileSidebar
  );

  /*
    Search.
  */
  const searchInput = $("#globalSearch");

  searchInput.addEventListener(
    "input",
    debounce(() => {
      setSearch(searchInput.value, false);
    }, 100)
  );

  searchInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      const value = searchInput.value.trim();

      if (value) {
        saveSearchTerm(value).then(() => {
          renderSearchHistory();
          renderDashboardSearchHistory();
          renderFullHistory();
          updateBackupStats();
        });
      }

      showView("library");
    }

    if (event.key === "Escape") {
      searchInput.value = "";
      state.searchQuery = "";
      updateSearchVisualState();
      renderLibrary();
      searchInput.blur();
    }
  });

  searchInput.addEventListener("focus", () => {
    renderSearchHistory();

    if (!state.searchQuery) {
      $("#searchHistoryDropdown").classList.remove("hidden");
    }
  });

  document.addEventListener("click", event => {
    const searchArea = $("#searchArea");

    if (!searchArea.contains(event.target)) {
      $("#searchHistoryDropdown").classList.add("hidden");
    }
  });

  $("#clearSearchBtn").addEventListener("click", () => {
    searchInput.value = "";
    state.searchQuery = "";
    updateSearchVisualState();
    renderLibrary();
    searchInput.focus();
  });

  $("#topSearchBtn").addEventListener("click", () => {
    searchInput.focus();
    searchInput.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  });

  /*
    Search history.
  */
  $("#clearSearchHistoryBtn").addEventListener(
    "click",
    clearSearchHistory
  );

  $("#dashboardClearHistory").addEventListener(
    "click",
    clearSearchHistory
  );

  $("#historyClearBtn").addEventListener(
    "click",
    clearSearchHistory
  );

  /*
    Sorting.
  */
  $("#sortSelect").addEventListener("change", event => {
    state.sort = event.target.value;
    renderLibrary();
  });

  /*
    Library layout.
  */
  $$(".view-btn[data-layout]").forEach(button => {
    button.addEventListener("click", () => {
      state.layout = button.dataset.layout;

      $$(".view-btn[data-layout]").forEach(btn => {
        btn.classList.toggle(
          "active",
          btn === button
        );
      });

      localStorage.setItem(
        "lyricsLibraryLayout",
        state.layout
      );

      renderLibrary();
    });
  });

  /*
    Dashboard statistic cards.
  */
  $$(".stat-card[data-stat-view]").forEach(button => {
    button.addEventListener("click", () => {
      const target = button.dataset.statView;

      if (target === "artists") {
        state.sort = "artist";
        state.libraryFilter = "all";
        showView("library");
        renderLibrary();
        return;
      }

      if (target === "favorites") {
        setLibraryFilter("favorites");
        return;
      }

      if (target === "pinned") {
        setLibraryFilter("pinned");
        return;
      }

      showView("library");
    });
  });

  $$(".text-btn[data-open-view]").forEach(button => {
    button.addEventListener("click", () => {
      showView(button.dataset.openView);
    });
  });

  /*
    Song form.
  */
  $("#songForm").addEventListener(
    "submit",
    saveSongFromForm
  );

  [
    "#titleInput",
    "#artistInput",
    "#aliasesInput"
  ].forEach(selector => {
    $(selector).addEventListener(
      "input",
      debounce(updateDuplicateWarning, 180)
    );
  });

  $("#deleteSongBtn").addEventListener(
    "click",
    deleteCurrentSong
  );

  /*
    Modal close buttons.
  */
  document.addEventListener("click", event => {
    const button = event.target.closest(
      "[data-close-modal]"
    );

    if (!button) return;

    closeModal(button.dataset.closeModal);
  });

  /*
    Confirm.
  */
  $("#confirmCancel").addEventListener("click", () => {
    state.pendingConfirm = null;
    closeModal("confirmModal");
  });

  $("#confirmOkay").addEventListener("click", async () => {
    const callback = state.pendingConfirm;

    state.pendingConfirm = null;
    closeModal("confirmModal");

    if (callback) {
      await callback();
    }
  });

  /*
    Song row delegation.
  */
  document.addEventListener("click", async event => {
    const openTarget =
      event.target.closest("[data-open-song]");

    if (openTarget) {
      const id = Number(
        openTarget.dataset.openSong
      );

      if (Number.isFinite(id)) {
        await openReader(id);
      }

      return;
    }

    const favoriteTarget =
      event.target.closest("[data-favorite-song]");

    if (favoriteTarget) {
      event.stopPropagation();

      await toggleFavorite(
        Number(favoriteTarget.dataset.favoriteSong)
      );

      return;
    }

    const pinTarget =
      event.target.closest("[data-pin-song]");

    if (pinTarget) {
      event.stopPropagation();

      await togglePinned(
        Number(pinTarget.dataset.pinSong)
      );

      return;
    }

    const editTarget =
      event.target.closest("[data-edit-song]");

    if (editTarget) {
      event.stopPropagation();

      await openEditSong(
        Number(editTarget.dataset.editSong)
      );
    }
  });

  /*
    Search history delegation.
  */
  document.addEventListener("click", event => {
    const target =
      event.target.closest("[data-history-search]");

    if (!target) return;

    const term = target.dataset.historySearch;

    setSearch(term, true);

    $("#searchHistoryDropdown").classList.add("hidden");
  });

  /*
    Sidebar recent.
  */
  document.addEventListener("click", event => {
    const target =
      event.target.closest(".sidebar-recent-item");

    if (!target) return;

    openReader(Number(target.dataset.openSong));
  });

  /*
    Reader.
  */
  $("#readerBackBtn").addEventListener(
    "click",
    closeReader
  );

  $("#readerFontDown").addEventListener(
    "click",
    () => changeReaderFont(-1)
  );

  $("#readerFontUp").addEventListener(
    "click",
    () => changeReaderFont(1)
  );

  $("#readerCopyLyrics").addEventListener(
    "click",
    async () => {
      const song = await getSong(state.readerSongId);

      if (song) {
        await copyText(
          song.lyrics || "",
          "Lyrics copied."
        );
      }
    }
  );

  $("#readerCopyLyricsText").addEventListener(
    "click",
    async () => {
      const song = await getSong(state.readerSongId);

      if (song) {
        await copyText(
          song.lyrics || "",
          "Lyrics copied."
        );
      }
    }
  );

  $("#readerCopyTranslation").addEventListener(
    "click",
    async () => {
      const song = await getSong(state.readerSongId);

      if (song) {
        await copyText(
          song.translation || "",
          "Translation copied."
        );
      }
    }
  );

  $("#readerEdit").addEventListener(
    "click",
    async () => {
      if (state.readerSongId) {
        const id = state.readerSongId;
        closeReader();
        await openEditSong(id);
      }
    }
  );

  $("#readerFavorite").addEventListener(
    "click",
    async () => {
      if (state.readerSongId) {
        await toggleFavorite(state.readerSongId);
      }
    }
  );

  $("#readerPin").addEventListener(
    "click",
    async () => {
      if (state.readerSongId) {
        await togglePinned(state.readerSongId);
      }
    }
  );

  $("#readerFullscreen").addEventListener(
    "click",
    async () => {
      try {
        if (!document.fullscreenElement) {
          await $("#readerModal").requestFullscreen();
        } else {
          await document.exitFullscreen();
        }
      } catch {
        showToast(
          "Fullscreen is unavailable in this browser.",
          "error"
        );
      }
    }
  );

  $("#readerModal .reader-body").addEventListener(
    "scroll",
    debounce(() => {
      if (!state.readerSongId) return;

      state.readerScroll[state.readerSongId] =
        $("#readerModal .reader-body").scrollTop;

      localStorage.setItem(
        "lyricsReaderScroll",
        JSON.stringify(state.readerScroll)
      );
    }, 250)
  );

  /*
    Backup.
  */
  $("#exportBtn").addEventListener(
    "click",
    exportBackup
  );

  $("#importBtn").addEventListener(
    "click",
    () => $("#importFile").click()
  );

  $("#importFile").addEventListener(
    "change",
    event => {
      importBackupFile(event.target.files[0]);

      event.target.value = "";
    }
  );

  /*
    Keyboard shortcuts.
  */
  document.addEventListener("keydown", event => {
    if (
      event.key === "/" &&
      !["INPUT","TEXTAREA","SELECT"].includes(
        document.activeElement.tagName
      )
    ) {
      event.preventDefault();
      searchInput.focus();
    }

    if (
      event.key === "Escape" &&
      !$("#readerModal").classList.contains("hidden")
    ) {
      closeReader();
    }

    if (
      event.key === "Escape" &&
      $("#sidebar").classList.contains("mobile-open")
    ) {
      closeMobileSidebar();
    }
  });

  /*
    Reader close with browser back-like click outside isn't used because
    accidental taps are undesirable on tablets.
  */
}

/* -------------------------------------------------------------------------- */
/* App initialization                                                         */
/* -------------------------------------------------------------------------- */

async function init() {
  try {
    if (!("indexedDB" in window)) {
      throw new Error(
        "IndexedDB is not available in this browser."
      );
    }

    await openDatabase();

    await seedDatabaseIfEmpty();

    await loadSearchHistory();

    const savedLayout =
      localStorage.getItem("lyricsLibraryLayout");

    if (
      savedLayout === "list" ||
      savedLayout === "compact" ||
      savedLayout === "card"
    ) {
      state.layout = savedLayout;

      $$(".view-btn[data-layout]").forEach(button => {
        button.classList.toggle(
          "active",
          button.dataset.layout === savedLayout
        );
      });
    }

    const savedScroll =
      localStorage.getItem("lyricsReaderScroll");

    if (savedScroll) {
      try {
        state.readerScroll = JSON.parse(savedScroll);
      } catch {
        state.readerScroll = {};
      }
    }

    await refreshSongs();

    bindEvents();

    applyReaderTypography();

    renderDashboard();
    renderLibrary();
    renderSearchHistory();
    renderFullHistory();
    updateBackupStats();

    $("#sortSelect").value = state.sort;

    /*
      Show the app immediately. No network operation is performed.
    */
    console.info(
      `Lyrics Library initialized with ${state.songs.length} songs.`
    );
  } catch (error) {
    console.error(error);

    document.body.innerHTML = `
      <main style="
        min-height:100vh;
        display:grid;
        place-items:center;
        padding:30px;
        background:#0c0d0f;
        color:#f2f3f5;
        font-family:system-ui,sans-serif;
      ">
        <section style="
          max-width:500px;
          padding:25px;
          border:1px solid #282c33;
          border-radius:14px;
          background:#15171c;
        ">
          <h1 style="margin-top:0">Lyrics Library</h1>
          <p style="color:#b6bac3;line-height:1.6">
            The local database could not be opened.
            Try opening this page in a modern browser with
            IndexedDB enabled.
          </p>
          <p style="color:#7d828d;font-size:12px">
            ${escapeHTML(error.message)}
          </p>
        </section>
      </main>
    `;
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
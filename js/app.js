/* app.js — Calm Screens
 * Low-stimulation video grid for 1–2 year olds.
 *   one calm grid -> one show -> back to the calm grid
 *   no autoplay-next, no recommendations surfaced, no search for the child
 *   in-app search-to-add for the grown-up (YouTube + cross-service)
 */
(function () {
  "use strict";

  var C = window.CalmContent;
  var state = C.load();

  var $ = function (sel) { return document.querySelector(sel); };
  var screens = { home: $("#home"), player: $("#player"), caregiver: $("#caregiver") };
  var grid = $("#grid");
  var emptyHint = $("#emptyHint");

  var ytHolder = $("#ytHolder");
  var ytFrame = $("#ytFrame");
  var localVideo = $("#localVideo");
  var endCard = $("#endCard");
  var endText = endCard.querySelector(".end-card__text");
  var muteBtn = $("#muteBtn");

  // session timer state (resets when a grown-up opens Settings)
  var sessionStartedAt = null;
  var muted = false;

  function show(name) {
    Object.keys(screens).forEach(function (k) {
      var on = k === name;
      screens[k].classList.toggle("is-active", on);
      screens[k].setAttribute("aria-hidden", on ? "false" : "true");
    });
  }

  /* ================= HOME GRID ================= */
  function visibleItems() {
    var items = state.items || [];
    if (state.settings.showOnlyStarred) {
      var starred = items.filter(function (i) { return i.starred; });
      if (starred.length) return starred;
    }
    return items;
  }

  function renderGrid() {
    grid.innerHTML = "";
    var items = visibleItems();
    emptyHint.hidden = items.length > 0;
    grid.classList.toggle("few", items.length <= 3);

    items.forEach(function (item, i) {
      var tile = document.createElement("button");
      tile.className = "tile c" + (i % 6) + (item.thumb ? " has-thumb" : "");
      tile.setAttribute("role", "listitem");
      tile.setAttribute("aria-label", item.label);

      if (item.thumb) {
        var img = document.createElement("img");
        img.className = "tile__thumb";
        img.src = item.thumb;
        img.alt = "";
        img.loading = "lazy";
        img.onerror = function () { tile.classList.remove("has-thumb"); img.remove(); };
        tile.appendChild(img);
        var veil = document.createElement("div");
        veil.className = "tile__veil";
        tile.appendChild(veil);
      }

      var emoji = document.createElement("div");
      emoji.className = "tile__emoji";
      emoji.textContent = item.emoji || badgeEmoji(item.type);
      tile.appendChild(emoji);

      var label = document.createElement("div");
      label.className = "tile__label";
      label.textContent = item.label;
      tile.appendChild(label);

      if (item.type === "link") {
        var badge = document.createElement("div");
        badge.className = "tile__badge";
        badge.textContent = "opens app";
        tile.appendChild(badge);
      }

      tile.addEventListener("click", function () { openItem(item); });
      grid.appendChild(tile);
    });
  }

  function badgeEmoji(type) {
    return type === "youtube" ? "▶️" : type === "local" ? "🎬" : "📺";
  }

  /* ================= PLAYER ================= */
  var ytPlayer = null;
  var ytApiLoading = false;
  var pendingYT = null;

  function openItem(item) {
    if (item.type === "link") return confirmDeepLink(item);

    // gentle time limit: a grown-up re-decides via Settings (PIN) to continue
    var limitMs = (state.settings.sessionLimitMin || 0) * 60000;
    if (limitMs > 0) {
      if (sessionStartedAt == null) sessionStartedAt = Date.now();
      if (Date.now() - sessionStartedAt >= limitMs) return showAllDoneForNow();
    }

    muted = !!state.settings.muteByDefault;
    show("player");
    endCard.hidden = true;
    muteBtn.hidden = false;
    updateMuteBtn();
    if (item.type === "youtube") playYouTube(item);
    else if (item.type === "local") playLocal(item);
  }

  function closePlayer() { stopAllMedia(); endCard.hidden = true; muteBtn.hidden = true; show("home"); }

  function stopAllMedia() {
    if (!localVideo.hidden) {
      try { localVideo.pause(); } catch (e) {}
      localVideo.removeAttribute("src");
      localVideo.load();
      localVideo.hidden = true;
    }
    if (ytPlayer && typeof ytPlayer.stopVideo === "function") {
      try { ytPlayer.stopVideo(); } catch (e) {}
    }
    ytHolder.hidden = true;
  }

  function showEndCard(text) {
    stopAllMedia();
    muteBtn.hidden = true;
    endText.textContent = text || "All done";
    endCard.hidden = false;
  }

  function showAllDoneForNow() {
    show("player");
    showEndCard("All done for now");
  }

  /* ---- mute ---- */
  function updateMuteBtn() {
    muteBtn.firstElementChild.textContent = muted ? "🔇" : "🔊";
  }
  function applyMute() {
    if (!localVideo.hidden) localVideo.muted = muted;
    if (ytPlayer) {
      try { muted ? ytPlayer.mute() : ytPlayer.unMute(); } catch (e) {}
    }
  }
  function toggleMute() { muted = !muted; updateMuteBtn(); applyMute(); }

  /* ---- local mp4 ---- */
  function playLocal(item) {
    ytHolder.hidden = true;
    localVideo.hidden = false;
    localVideo.muted = muted;
    localVideo.src = item.source;
    localVideo.currentTime = 0;
    localVideo.onended = function () { showEndCard("All done"); };
    var p = localVideo.play();
    if (p && p.catch) p.catch(function () {});
  }

  /* ---- youtube ---- */
  function playYouTube(item) {
    localVideo.hidden = true;
    ytHolder.hidden = false;
    pendingYT = item;
    if (window.YT && window.YT.Player) return mountYT(item);
    loadYTApi();
  }
  function loadYTApi() {
    if (ytApiLoading) return;
    ytApiLoading = true;
    window.onYouTubeIframeAPIReady = function () { if (pendingYT) mountYT(pendingYT); };
    var s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = function () { ytApiLoading = false; closePlayer(); };
    document.head.appendChild(s);
  }
  function ytVars() {
    return {
      rel: 0, controls: 1, playsinline: 1, iv_load_policy: 3,
      disablekb: 1, modestbranding: 1, fs: 0, autoplay: 1,
      mute: muted ? 1 : 0,
    };
  }
  function mountYT(item) {
    var vars = ytVars();
    var opts = {
      host: "https://www.youtube-nocookie.com",
      width: "100%", height: "100%", playerVars: vars,
      events: {
        onReady: function (e) { muted ? e.target.mute() : e.target.unMute(); e.target.playVideo(); },
        onStateChange: function (e) {
          if (e.data === window.YT.PlayerState.ENDED) showEndCard("All done");
        },
        onError: function () { closePlayer(); },
      },
    };
    if (item.kind === "playlist") { vars.listType = "playlist"; vars.list = item.source; }
    else { opts.videoId = item.source; }

    if (ytPlayer && typeof ytPlayer.destroy === "function") {
      try { ytPlayer.destroy(); } catch (e) {}
      ytPlayer = null;
    }
    ytFrame.innerHTML = "<div id=\"ytPlayerEl\"></div>";
    ytPlayer = new window.YT.Player("ytPlayerEl", opts);
  }

  /* ---- deep link confirm ---- */
  var confirmEl = null;
  function confirmDeepLink(item) {
    if (!confirmEl) confirmEl = buildConfirm();
    confirmEl.querySelector(".confirm__title").textContent = "Open " + item.label + "?";
    confirmEl.querySelector(".confirm__yes").onclick = function () {
      hideConfirm();
      window.location.href = item.source;
    };
    confirmEl.classList.add("is-active");
  }
  function hideConfirm() { if (confirmEl) confirmEl.classList.remove("is-active"); }
  function buildConfirm() {
    var el = document.createElement("div");
    el.className = "confirm";
    el.innerHTML =
      '<div class="confirm__card">' +
      '<h3 class="confirm__title">Open app?</h3>' +
      '<p>This leaves Calm Screens and opens another app. ' +
      "It won't come back on its own — you'll switch back by hand. " +
      "(Tip: keep Guided Access on the app you open.)</p>" +
      '<div class="confirm__row">' +
      '<button class="confirm__no">Stay here</button>' +
      '<button class="confirm__yes">Open</button>' +
      "</div></div>";
    el.querySelector(".confirm__no").onclick = hideConfirm;
    el.addEventListener("click", function (e) { if (e.target === el) hideConfirm(); });
    document.body.appendChild(el);
    return el;
  }

  /* ================= CAREGIVER ================= */
  var pinBuffer = "";
  var pinDots = $("#pinDots").querySelectorAll("span");
  var pinError = $("#pinError");
  var pinGate = $("#pinGate");
  var cgPanel = $("#cgPanel");

  function openCaregiver() {
    sessionStartedAt = null; // grown-up present -> fresh session
    pinBuffer = ""; renderPinDots();
    pinError.hidden = true;
    pinGate.hidden = false; cgPanel.hidden = true;
    show("caregiver");
  }
  function renderPinDots() {
    pinDots.forEach(function (d, i) { d.classList.toggle("filled", i < pinBuffer.length); });
  }
  function handlePinKey(key) {
    if (key === "cancel") return closeCaregiver();
    if (key === "del") { pinBuffer = pinBuffer.slice(0, -1); return renderPinDots(); }
    if (pinBuffer.length >= 4) return;
    pinBuffer += key; renderPinDots();
    if (pinBuffer.length === 4) {
      if (pinBuffer === String(state.pin)) unlockCaregiver();
      else { pinError.hidden = false; pinBuffer = ""; setTimeout(renderPinDots, 200); }
    }
  }
  function unlockCaregiver() {
    pinGate.hidden = true; cgPanel.hidden = false;
    renderCgList();
    syncSettingsForm();
  }
  function closeCaregiver() { show("home"); renderGrid(); }

  function renderCgList() {
    var ul = $("#cgList");
    ul.innerHTML = "";
    state.items.forEach(function (item, idx) {
      var li = document.createElement("li");
      li.className = "cg-item";

      var star = document.createElement("button");
      star.className = "cg-star" + (item.starred ? " on" : "");
      star.textContent = item.starred ? "⭐" : "☆";
      star.setAttribute("aria-label", "Star for Today's picks");
      star.onclick = function () { item.starred = !item.starred; C.save(state); renderCgList(); };
      li.appendChild(star);

      var em = document.createElement("span");
      em.className = "cg-item__emoji";
      if (item.thumb) {
        var im = document.createElement("img");
        im.src = item.thumb; im.alt = ""; im.className = "cg-item__thumb";
        im.onerror = function () { im.replaceWith(document.createTextNode(item.emoji || badgeEmoji(item.type))); };
        em.appendChild(im);
      } else {
        em.textContent = item.emoji || badgeEmoji(item.type);
      }
      li.appendChild(em);

      var meta = document.createElement("div");
      meta.className = "cg-item__meta";
      meta.innerHTML = '<div class="cg-item__name"></div><div class="cg-item__type"></div>';
      meta.querySelector(".cg-item__name").textContent = item.label;
      meta.querySelector(".cg-item__type").textContent = typeDesc(item);
      li.appendChild(meta);

      var up = document.createElement("button");
      up.className = "cg-move"; up.textContent = "↑";
      up.setAttribute("aria-label", "Move up");
      up.disabled = idx === 0;
      up.onclick = function () { moveItem(idx, -1); };
      li.appendChild(up);

      var del = document.createElement("button");
      del.className = "cg-item__del"; del.textContent = "Remove";
      del.onclick = function () { removeItem(idx); };
      li.appendChild(del);

      ul.appendChild(li);
    });
  }
  function typeDesc(item) {
    if (item.type === "youtube") return "YouTube " + (item.kind || "video");
    if (item.type === "local") return "Local file · " + item.source;
    return "Opens app · " + shortHost(item.source);
  }
  function shortHost(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return u; } }
  function moveItem(idx, dir) {
    var j = idx + dir;
    if (j < 0 || j >= state.items.length) return;
    var t = state.items[idx]; state.items[idx] = state.items[j]; state.items[j] = t;
    C.save(state); renderCgList();
  }
  function removeItem(idx) { state.items.splice(idx, 1); C.save(state); renderCgList(); }

  function addItem(item, announce) {
    item.id = item.id || C.makeId();
    state.items.push(item);
    C.save(state);
    renderCgList();
    if (announce) flash(announce, "Added “" + item.label + "” ✓");
  }
  function flash(el, msg) { if (typeof el === "string") el = $(el); if (el) el.textContent = msg; }

  /* ---- in-app YouTube search ---- */
  function searchYouTube(q) {
    var msg = $("#ytSearchMsg"), out = $("#ytResults");
    out.innerHTML = "";
    var key = state.settings.youtubeKey;
    if (!key) { msg.innerHTML = needKeyMsg("YouTube Data API", "yt"); return; }
    msg.textContent = "Searching…";
    var url = "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&safeSearch=strict&maxResults=12&q=" +
      encodeURIComponent(q) + "&key=" + encodeURIComponent(key);
    fetch(url).then(toJson).then(function (data) {
      if (data.error) { msg.textContent = "YouTube: " + (data.error.message || "search failed"); return; }
      var items = (data.items || []).filter(function (i) { return i.id && i.id.videoId; });
      if (!items.length) { msg.textContent = "No results."; return; }
      msg.textContent = "";
      items.forEach(function (r) {
        var vid = r.id.videoId;
        var title = decodeEntities(r.snippet.title);
        var thumb = r.snippet.thumbnails && (r.snippet.thumbnails.medium || r.snippet.thumbnails.default);
        out.appendChild(resultCard({
          title: title,
          sub: decodeEntities(r.snippet.channelTitle || "YouTube"),
          thumb: thumb ? thumb.url : C.youtubeThumb(vid),
          onAdd: function () {
            addItem({ type: "youtube", kind: "video", source: vid, label: title.slice(0, 40), thumb: C.youtubeThumb(vid) },
              "#ytSearchMsg");
          },
        }));
      });
    }).catch(function () { msg.textContent = "Couldn't reach YouTube (offline or quota)."; });
  }

  /* ---- in-app cross-service show search (TMDB) ---- */
  function searchShows(q) {
    var msg = $("#showSearchMsg"), out = $("#showResults");
    out.innerHTML = "";
    var key = state.settings.tmdbKey;
    if (!key) { msg.innerHTML = needKeyMsg("TMDB", "tmdb"); return; }
    msg.textContent = "Searching…";
    var url = "https://api.themoviedb.org/3/search/multi?include_adult=false&query=" +
      encodeURIComponent(q) + tmdbAuth(key);
    fetch(url, tmdbInit(key)).then(toJson).then(function (data) {
      if (data.status_code) { msg.textContent = "TMDB: " + (data.status_message || "search failed"); return; }
      var items = (data.results || []).filter(function (r) {
        return (r.media_type === "tv" || r.media_type === "movie") && r.poster_path;
      }).slice(0, 12);
      if (!items.length) { msg.textContent = "No results."; return; }
      msg.textContent = "Tap a show to pick where to watch.";
      items.forEach(function (r) {
        var title = r.name || r.title;
        var poster = "https://image.tmdb.org/t/p/w342" + r.poster_path;
        out.appendChild(resultCard({
          title: title,
          sub: (r.media_type === "tv" ? "TV" : "Movie") + (r.first_air_date || r.release_date ? " · " + String(r.first_air_date || r.release_date).slice(0, 4) : ""),
          thumb: poster,
          addLabel: "Where?",
          onAdd: function (card) { pickProviders(r, title, poster, card); },
        }));
      });
    }).catch(function () { msg.textContent = "Couldn't reach TMDB (offline or bad key)."; });
  }

  function pickProviders(r, title, poster, card) {
    var key = state.settings.tmdbKey;
    var region = (state.settings.region || "US").toUpperCase();
    var url = "https://api.themoviedb.org/3/" + r.media_type + "/" + r.id + "/watch/providers" + tmdbAuth(key);
    var row = card.querySelector(".result__providers") || (function () {
      var d = document.createElement("div"); d.className = "result__providers"; d.textContent = "…";
      card.appendChild(d); return d;
    })();
    row.textContent = "…";
    fetch(url, tmdbInit(key)).then(toJson).then(function (data) {
      var reg = (data.results && data.results[region]) || {};
      var names = {};
      ["flatrate", "free", "ads", "rent", "buy"].forEach(function (k) {
        (reg[k] || []).forEach(function (p) { names[p.provider_name] = true; });
      });
      var mapped = [];
      Object.keys(names).forEach(function (n) {
        var prov = C.providerFor(n);
        if (prov && mapped.indexOf(prov.label) === -1) mapped.push(prov);
      });
      row.innerHTML = "";
      if (!mapped.length) {
        row.textContent = "Not on a supported app in " + region + ".";
        return;
      }
      mapped.forEach(function (prov) {
        var b = document.createElement("button");
        b.className = "prov-btn";
        b.textContent = prov.emoji + " " + prov.label;
        b.onclick = function () {
          addItem({ type: "link", label: title.slice(0, 40), emoji: prov.emoji, source: prov.url(title), thumb: poster },
            "#showSearchMsg");
          row.innerHTML = "<span class=\"prov-done\">Added → " + prov.label + " ✓</span>";
        };
        row.appendChild(b);
      });
    }).catch(function () { row.textContent = "Couldn't load providers."; });
  }

  // TMDB keys come in two flavours: a v3 key (query param) or a v4 bearer token.
  function tmdbAuth(key) { return /^ey/.test(key) ? "" : "&api_key=" + encodeURIComponent(key); }
  function tmdbInit(key) { return /^ey/.test(key) ? { headers: { Authorization: "Bearer " + key } } : undefined; }

  function resultCard(o) {
    var card = document.createElement("div");
    card.className = "result";
    var img = document.createElement("img");
    img.className = "result__thumb"; img.src = o.thumb; img.alt = ""; img.loading = "lazy";
    card.appendChild(img);
    var body = document.createElement("div");
    body.className = "result__body";
    body.innerHTML = '<div class="result__title"></div><div class="result__sub"></div>';
    body.querySelector(".result__title").textContent = o.title;
    body.querySelector(".result__sub").textContent = o.sub || "";
    card.appendChild(body);
    var add = document.createElement("button");
    add.className = "result__add"; add.textContent = o.addLabel || "Add";
    add.onclick = function () { o.onAdd(card); };
    card.appendChild(add);
    return card;
  }

  function needKeyMsg(name, which) {
    return "Add a free <strong>" + name + "</strong> key in “Search keys” below to enable in-app search. " +
      "<a href=\"#\" data-openkeys=\"" + which + "\">Open setup</a>";
  }

  /* ---- helpers ---- */
  function toJson(r) { return r.json(); }
  function decodeEntities(s) {
    var t = document.createElement("textarea"); t.innerHTML = s || ""; return t.value;
  }

  /* ---- manual add form ---- */
  var addType = $("#addType"), addSource = $("#addSource"), srcLabel = $("#srcLabel"), addNote = $("#addNote");
  function updateAddHints() {
    var t = addType.value;
    if (t === "youtube") {
      srcLabel.textContent = "YouTube link or ID";
      addSource.placeholder = "https://youtu.be/…  or a playlist link";
      addNote.textContent = "Paste any YouTube video or playlist link. A curated playlist of one show keeps it calm.";
    } else if (t === "local") {
      srcLabel.textContent = "File path (in this app's media folder)";
      addSource.placeholder = "media/puffin-rock.mp4";
      addNote.textContent = "Put .mp4 files in /media, then reference them here. Local files are most reliable on a flight.";
    } else {
      srcLabel.textContent = "App link (Netflix / PBS / Apple TV)";
      addSource.placeholder = "https://www.netflix.com/title/…";
      addNote.textContent = "Opens another app. One-way handoff — pair with Guided Access on the app you open.";
    }
  }
  function onAddSubmit(e) {
    e.preventDefault();
    var label = $("#addLabel").value.trim();
    var emoji = $("#addEmoji").value.trim();
    var type = addType.value;
    var srcVal = addSource.value.trim();
    if (!label || !srcVal) { addNote.textContent = "Add a name and a link/path."; return; }
    var item = { type: type, label: label, emoji: emoji };
    if (type === "youtube") {
      var parsed = C.parseYouTube(srcVal);
      if (!parsed) { addNote.textContent = "That doesn't look like a YouTube link or ID."; return; }
      item.kind = parsed.kind; item.source = parsed.source;
      if (parsed.kind === "video") item.thumb = C.youtubeThumb(parsed.source);
    } else if (type === "link") {
      if (!/^https?:\/\//i.test(srcVal)) srcVal = "https://" + srcVal;
      item.source = srcVal;
    } else { item.source = srcVal; }
    addItem(item);
    e.target.reset(); updateAddHints();
    addNote.textContent = "Added “" + label + "” ✓";
  }

  /* ---- settings form ---- */
  function syncSettingsForm() {
    $("#setStarred").checked = !!state.settings.showOnlyStarred;
    $("#setMute").checked = !!state.settings.muteByDefault;
    $("#setLimit").value = state.settings.sessionLimitMin || 0;
    $("#ytKey").value = state.settings.youtubeKey || "";
    $("#tmdbKey").value = state.settings.tmdbKey || "";
    $("#regionKey").value = state.settings.region || "US";
  }
  function wireSettings() {
    $("#setStarred").addEventListener("change", function (e) {
      state.settings.showOnlyStarred = e.target.checked; C.save(state);
    });
    $("#setMute").addEventListener("change", function (e) {
      state.settings.muteByDefault = e.target.checked; C.save(state);
    });
    $("#setLimit").addEventListener("change", function (e) {
      state.settings.sessionLimitMin = Math.max(0, parseInt(e.target.value, 10) || 0); C.save(state);
    });
    $("#keysForm").addEventListener("submit", function (e) {
      e.preventDefault();
      state.settings.youtubeKey = $("#ytKey").value.trim();
      state.settings.tmdbKey = $("#tmdbKey").value.trim();
      state.settings.region = ($("#regionKey").value.trim() || "US").toUpperCase();
      C.save(state);
      var s = $("#keysSaved"); s.hidden = false; setTimeout(function () { s.hidden = true; }, 1800);
    });
  }

  /* ---- change PIN ---- */
  function onPinSubmit(e) {
    e.preventDefault();
    var v = $("#newPin").value.trim();
    if (!/^\d{4}$/.test(v)) { $("#newPin").focus(); return; }
    state.pin = v; C.save(state);
    var saved = $("#pinSaved"); saved.hidden = false; setTimeout(function () { saved.hidden = true; }, 1800);
    e.target.reset();
  }
  function onReset() { state = C.reset(); renderCgList(); syncSettingsForm(); }

  /* ---- export / import ---- */
  function exportText() { return JSON.stringify(C.exportData(state), null, 2); }
  function onExportCopy() {
    var txt = exportText();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(txt).then(function () { flashTmp("exportCopyBtn", "Copied ✓"); },
        function () { fallbackCopy(txt); });
    } else { fallbackCopy(txt); }
  }
  function fallbackCopy(txt) {
    $("#importBox").value = txt;
    $("#importBox").closest("details").open = true;
    flashTmp("exportCopyBtn", "Shown below ↓");
  }
  function onExportFile() {
    var blob = new Blob([exportText()], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "calm-screens-library.json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function onImport(mode) {
    var box = $("#importBox"), msg = $("#importMsg");
    try {
      state = C.importData(state, box.value, mode);
      renderCgList(); syncSettingsForm();
      msg.textContent = (mode === "merge" ? "Merged" : "Replaced") + " ✓ (" + state.items.length + " shows)";
      box.value = "";
    } catch (e) { msg.textContent = "That didn't look like a Calm Screens backup."; }
  }
  function flashTmp(id, msg) {
    var b = document.getElementById(id); if (!b) return;
    var old = b.textContent; b.textContent = msg;
    setTimeout(function () { b.textContent = old; }, 1600);
  }

  /* ---- search tabs ---- */
  function wireTabs() {
    var tabs = document.querySelectorAll(".search-tab");
    tabs.forEach(function (t) {
      t.addEventListener("click", function () {
        tabs.forEach(function (x) { x.classList.remove("is-active"); });
        t.classList.add("is-active");
        $("#searchYt").hidden = t.dataset.tab !== "yt";
        $("#searchShow").hidden = t.dataset.tab !== "show";
      });
    });
  }

  /* ================= wiring ================= */
  function wire() {
    $("#caregiverBtn").addEventListener("click", openCaregiver);
    $("#cgCloseBtn").addEventListener("click", closeCaregiver);
    $("#backBtn").addEventListener("click", closePlayer);
    $("#endBackBtn").addEventListener("click", closePlayer);
    muteBtn.addEventListener("click", toggleMute);

    document.querySelectorAll(".pin-key").forEach(function (btn) {
      btn.addEventListener("click", function () { handlePinKey(btn.dataset.key); });
    });

    addType.addEventListener("change", updateAddHints);
    $("#addForm").addEventListener("submit", onAddSubmit);
    $("#pinForm").addEventListener("submit", onPinSubmit);
    $("#resetBtn").addEventListener("click", onReset);

    $("#ytSearchForm").addEventListener("submit", function (e) {
      e.preventDefault(); var q = $("#ytQuery").value.trim(); if (q) searchYouTube(q);
    });
    $("#showSearchForm").addEventListener("submit", function (e) {
      e.preventDefault(); var q = $("#showQuery").value.trim(); if (q) searchShows(q);
    });

    $("#exportCopyBtn").addEventListener("click", onExportCopy);
    $("#exportFileBtn").addEventListener("click", onExportFile);
    $("#importReplaceBtn").addEventListener("click", function () { onImport("replace"); });
    $("#importMergeBtn").addEventListener("click", function () { onImport("merge"); });

    // "Open setup" links inside the no-key message
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("[data-openkeys]");
      if (a) { e.preventDefault(); openKeysDetails(); }
    });

    wireTabs();
    wireSettings();
    updateAddHints();
    renderGrid();

    document.addEventListener("gesturestart", function (e) { e.preventDefault(); });
    document.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }

  function openKeysDetails() {
    var d = document.querySelectorAll("details.advanced");
    d.forEach(function (x) { if (x.querySelector("#keysForm")) { x.open = true; x.scrollIntoView({ behavior: "smooth" }); } });
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }

  wire();
})();

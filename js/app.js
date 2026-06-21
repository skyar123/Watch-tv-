/* app.js — Calm Screens
 * A self-contained, low-stimulation video grid for 1–2 year olds.
 * Core principles, baked in:
 *   - one calm grid -> one show -> back to the calm grid
 *   - NO autoplay chaining, NO recommendations surfaced, NO search
 *   - on episode end we return to the grid (the main anti-dysregulation feature)
 *   - grown-up settings are PIN-gated and visually de-emphasised
 */
(function () {
  "use strict";

  var C = window.CalmContent;
  var state = C.load();

  /* ---------- element refs ---------- */
  var $ = function (sel) { return document.querySelector(sel); };
  var screens = {
    home: $("#home"),
    player: $("#player"),
    caregiver: $("#caregiver"),
  };
  var grid = $("#grid");
  var emptyHint = $("#emptyHint");

  // player
  var ytHolder = $("#ytHolder");
  var ytFrame = $("#ytFrame");
  var localVideo = $("#localVideo");
  var endCard = $("#endCard");

  /* ---------- screen switching ---------- */
  function show(name) {
    Object.keys(screens).forEach(function (k) {
      var on = k === name;
      screens[k].classList.toggle("is-active", on);
      screens[k].setAttribute("aria-hidden", on ? "false" : "true");
    });
  }

  /* ================= HOME GRID ================= */
  function renderGrid() {
    grid.innerHTML = "";
    var items = state.items || [];
    emptyHint.hidden = items.length > 0;
    grid.classList.toggle("few", items.length <= 3);

    items.forEach(function (item, i) {
      var tile = document.createElement("button");
      tile.className = "tile c" + (i % 6);
      tile.setAttribute("role", "listitem");
      tile.setAttribute("aria-label", item.label);

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
    show("player");
    endCard.hidden = true;
    if (item.type === "youtube") playYouTube(item);
    else if (item.type === "local") playLocal(item);
  }

  function closePlayer() {
    stopAllMedia();
    endCard.hidden = true;
    show("home");
  }

  function stopAllMedia() {
    // local
    if (!localVideo.hidden) {
      try { localVideo.pause(); } catch (e) {}
      localVideo.removeAttribute("src");
      localVideo.load();
      localVideo.hidden = true;
    }
    // youtube
    if (ytPlayer && typeof ytPlayer.stopVideo === "function") {
      try { ytPlayer.stopVideo(); } catch (e) {}
    }
    ytHolder.hidden = true;
  }

  function showEndCard() {
    // calm ending: stop media, fade to "All done", wait for a tap.
    stopAllMedia();
    endCard.hidden = false;
  }

  /* ---- local mp4 ---- */
  function playLocal(item) {
    ytHolder.hidden = true;
    localVideo.hidden = false;
    localVideo.src = item.source;
    localVideo.currentTime = 0;
    localVideo.onended = showEndCard;
    var p = localVideo.play();
    if (p && p.catch) p.catch(function () { /* tap-to-play fallback */ });
  }

  /* ---- youtube (IFrame API, nocookie host) ---- */
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
    window.onYouTubeIframeAPIReady = function () {
      if (pendingYT) mountYT(pendingYT);
    };
    var s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = function () {
      // offline / blocked: tell the grown-up gently by bailing to home
      ytApiLoading = false;
      closePlayer();
    };
    document.head.appendChild(s);
  }

  function ytVars() {
    return {
      rel: 0,              // limits (cannot fully remove) related videos
      controls: 1,
      playsinline: 1,
      iv_load_policy: 3,   // hide annotations
      disablekb: 1,
      modestbranding: 1,   // deprecated but harmless
      fs: 0,               // no fullscreen button
      autoplay: 1,
    };
  }

  function mountYT(item) {
    var vars = ytVars();
    var opts = {
      host: "https://www.youtube-nocookie.com",
      width: "100%",
      height: "100%",
      playerVars: vars,
      events: {
        onReady: function (e) { e.target.playVideo(); },
        onStateChange: function (e) {
          // 0 === ENDED -> calm return to grid (no autoplay next)
          if (e.data === window.YT.PlayerState.ENDED) showEndCard();
        },
        onError: function () { closePlayer(); },
      },
    };
    if (item.kind === "playlist") {
      vars.listType = "playlist";
      vars.list = item.source;
    } else {
      opts.videoId = item.source;
    }

    if (ytPlayer && typeof ytPlayer.loadVideoById === "function") {
      try { ytPlayer.destroy(); } catch (e) {}
      ytPlayer = null;
    }
    // fresh mount each time keeps state clean for a toddler
    ytFrame.innerHTML = "<div id=\"ytPlayerEl\"></div>";
    ytPlayer = new window.YT.Player("ytPlayerEl", opts);
  }

  /* ---- deep link confirm (one-way handoff out of the app) ---- */
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
    pinBuffer = "";
    renderPinDots();
    pinError.hidden = true;
    pinGate.hidden = false;
    cgPanel.hidden = true;
    show("caregiver");
  }

  function renderPinDots() {
    pinDots.forEach(function (d, i) {
      d.classList.toggle("filled", i < pinBuffer.length);
    });
  }

  function handlePinKey(key) {
    if (key === "cancel") return closeCaregiver();
    if (key === "del") { pinBuffer = pinBuffer.slice(0, -1); return renderPinDots(); }
    if (pinBuffer.length >= 4) return;
    pinBuffer += key;
    renderPinDots();
    if (pinBuffer.length === 4) {
      if (pinBuffer === String(state.pin)) {
        unlockCaregiver();
      } else {
        pinError.hidden = false;
        pinBuffer = "";
        setTimeout(renderPinDots, 200);
      }
    }
  }

  function unlockCaregiver() {
    pinGate.hidden = true;
    cgPanel.hidden = false;
    renderCgList();
  }
  function closeCaregiver() { show("home"); renderGrid(); }

  function renderCgList() {
    var ul = $("#cgList");
    ul.innerHTML = "";
    state.items.forEach(function (item, idx) {
      var li = document.createElement("li");
      li.className = "cg-item";

      var em = document.createElement("span");
      em.className = "cg-item__emoji";
      em.textContent = item.emoji || badgeEmoji(item.type);
      li.appendChild(em);

      var meta = document.createElement("div");
      meta.className = "cg-item__meta";
      meta.innerHTML =
        '<div class="cg-item__name"></div><div class="cg-item__type"></div>';
      meta.querySelector(".cg-item__name").textContent = item.label;
      meta.querySelector(".cg-item__type").textContent = typeDesc(item);
      li.appendChild(meta);

      var up = document.createElement("button");
      up.className = "cg-move";
      up.textContent = "↑";
      up.setAttribute("aria-label", "Move up");
      up.disabled = idx === 0;
      up.onclick = function () { moveItem(idx, -1); };
      li.appendChild(up);

      var del = document.createElement("button");
      del.className = "cg-item__del";
      del.textContent = "Remove";
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
  function shortHost(u) {
    try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return u; }
  }

  function moveItem(idx, dir) {
    var j = idx + dir;
    if (j < 0 || j >= state.items.length) return;
    var tmp = state.items[idx];
    state.items[idx] = state.items[j];
    state.items[j] = tmp;
    C.save(state);
    renderCgList();
  }

  function removeItem(idx) {
    state.items.splice(idx, 1);
    C.save(state);
    renderCgList();
  }

  /* ---- add form ---- */
  var addType = $("#addType");
  var addSource = $("#addSource");
  var srcLabel = $("#srcLabel");
  var addNote = $("#addNote");

  function updateAddHints() {
    var t = addType.value;
    if (t === "youtube") {
      srcLabel.textContent = "YouTube link or ID";
      addSource.placeholder = "https://youtu.be/…  or a playlist link";
      addNote.textContent =
        "Paste any YouTube video or playlist link. Tip: a curated playlist of one show keeps it calm. Note: YouTube needs a connection, and its logo/link can't be fully hidden.";
    } else if (t === "local") {
      srcLabel.textContent = "File path (in this app's media folder)";
      addSource.placeholder = "media/puffin-rock.mp4";
      addNote.textContent =
        "Put your own .mp4 files in the app's /media folder, then reference them here. Local files are the most reliable for a flight (fully offline).";
    } else {
      srcLabel.textContent = "App link (Netflix / PBS / Apple TV)";
      addSource.placeholder = "https://www.netflix.com/title/…";
      addNote.textContent =
        "Opens another app to a page. It's a one-way handoff — you switch back by hand. Best paired with Guided Access on the app you open.";
    }
  }

  function onAddSubmit(e) {
    e.preventDefault();
    var label = $("#addLabel").value.trim();
    var emoji = $("#addEmoji").value.trim();
    var type = addType.value;
    var srcVal = addSource.value.trim();
    if (!label || !srcVal) return;

    var item = { id: C.makeId(), type: type, label: label, emoji: emoji };

    if (type === "youtube") {
      var parsed = C.parseYouTube(srcVal);
      if (!parsed) {
        addNote.textContent = "Hmm — that doesn't look like a YouTube link or ID. Try again.";
        return;
      }
      item.kind = parsed.kind;
      item.source = parsed.source;
    } else if (type === "link") {
      if (!/^https?:\/\//i.test(srcVal)) srcVal = "https://" + srcVal;
      item.source = srcVal;
    } else {
      item.source = srcVal; // local path
    }

    state.items.push(item);
    C.save(state);
    renderCgList();
    e.target.reset();
    updateAddHints();
    addNote.textContent = "Added “" + label + "” ✓";
  }

  /* ---- change PIN ---- */
  function onPinSubmit(e) {
    e.preventDefault();
    var v = $("#newPin").value.trim();
    if (!/^\d{4}$/.test(v)) {
      $("#newPin").focus();
      return;
    }
    state.pin = v;
    C.save(state);
    var saved = $("#pinSaved");
    saved.hidden = false;
    setTimeout(function () { saved.hidden = true; }, 1800);
    e.target.reset();
  }

  function onReset() {
    state = C.reset();
    renderCgList();
  }

  /* ================= wiring ================= */
  function wire() {
    $("#caregiverBtn").addEventListener("click", openCaregiver);
    $("#cgCloseBtn").addEventListener("click", closeCaregiver);
    $("#backBtn").addEventListener("click", closePlayer);
    $("#endBackBtn").addEventListener("click", closePlayer);

    $("#pinDots").parentNode.querySelectorAll(".pin-key").forEach(function (btn) {
      btn.addEventListener("click", function () { handlePinKey(btn.dataset.key); });
    });

    addType.addEventListener("change", updateAddHints);
    $("#addForm").addEventListener("submit", onAddSubmit);
    $("#pinForm").addEventListener("submit", onPinSubmit);
    $("#resetBtn").addEventListener("click", onReset);

    // keep the device from sleeping into another app via stray gestures:
    document.addEventListener("gesturestart", function (e) { e.preventDefault(); });
    document.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    updateAddHints();
    renderGrid();
  }

  /* ---- service worker (offline app shell) ---- */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }

  wire();
})();

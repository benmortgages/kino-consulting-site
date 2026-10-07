/* ==========================================================================
   Kino Consulting — scroll-driven construction sequence (home page hero)
   1080p stills from the Higgsfield time-lapse, drawn to a canvas so scrubbing
   stays smooth on every browser (including iOS Safari). Neighbouring frames are
   cross-faded, so motion stays fluid between stills and while frames stream in.
   ========================================================================== */
(function () {
  "use strict";

  var section = document.querySelector("[data-build]");
  if (!section) return;

  var canvas = section.querySelector("canvas");
  var ctx = canvas.getContext("2d", { alpha: false });
  var stages = Array.prototype.slice.call(section.querySelectorAll(".build__stage"));
  var railItems = Array.prototype.slice.call(section.querySelectorAll(".rail li"));
  var railFill = section.querySelector(".rail__fill");

  var N = parseInt(section.getAttribute("data-frames"), 10) || 1;
  // Upright phones get the square crop; landscape phones, tablets and desktops get 1920x1080.
  var PHONE_MQ = window.matchMedia("(orientation: portrait) and (max-width: 760px)");
  // Matches the CSS "stacked" hero (upright phones and portrait tablets): image on top, copy below.
  var STACKED_MQ = window.matchMedia("(orientation: portrait) and (max-width: 1100px)");
  var REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  // On data-saver or slow connections load every other still; the cross-fade covers the gaps.
  var LITE = !!(conn && (conn.saveData || /(^|-)(2g|3g)$/.test(conn.effectiveType || "")));

  // Scroll budget: hold the empty lot briefly at the start and the finished building at the end.
  var HOLD_START = 0.05;
  var HOLD_END = 0.08;
  var STAGE_POS = [0, 0.25, 0.5, 0.75, 1]; // keyframes: lot, foundation, steel, envelope, finished

  var set = null;        // "d" (1920x1080) or "m" (1080x1080 phone crop)
  var COARSE_STEP = 8;   // stills loaded up front; the rest wait for the first scroll
  var fineUnlocked = false, pumpQueue = null;
  var frames = [];
  var ready = new Uint8Array(N);
  var readyCount = 0, wanted = N;
  var target = 0, current = 0;
  var lastDrawn = -1, needsResize = true, ticking = false;
  var focusY = 0.55;

  function pad(n) { return (n < 10 ? "00" : n < 100 ? "0" : "") + n; }
  function srcFor(i) { return section.getAttribute("data-path-" + set) + "f" + pad(i + 1) + ".webp"; }

  // Coarse-to-fine order: the whole build is scrubbable early, then fills in.
  function loadOrder() {
    var seen = new Uint8Array(N), out = [];
    function add(i) { if (i >= 0 && i < N && !seen[i]) { seen[i] = 1; out.push(i); } }
    add(0); add(N - 1);
    var finest = LITE ? 2 : 1;
    for (var step = 16; step >= finest; step = step / 2) {
      for (var i = 0; i < N; i += step) add(i);
    }
    return out;
  }
  function isCoarse(i) { return i === N - 1 || i % COARSE_STEP === 0;
  }

  function loadSet(which) {
    set = which;
    frames = new Array(N);
    ready = new Uint8Array(N);
    readyCount = 0;
    lastDrawn = -1;
    section.classList.remove("is-loaded");
    var queue = loadOrder();
    wanted = queue.length;
    var active = 0, MAX = which === "m" ? 4 : 6, token = which;

    function next() {
      if (set !== token) return;
      while (active < MAX && queue.length) {
        // Visitors who never scroll only download the coarse set (about 1 in 8 stills).
        if (!fineUnlocked && !isCoarse(queue[0])) return;
        (function (i) {
          var img = new Image();
          img.decoding = "async";
          active++;
          var done = function (ok) {
            active--;
            if (set !== token) return;
            if (ok) {
              ready[i] = 1;
              readyCount++;
              if (i === 0) section.classList.add("is-ready");
              if (readyCount === wanted) section.classList.add("is-loaded");
              lastDrawn = -1;
              requestTick();
            }
            next();
          };
          img.onload = function () {
            if (img.decode) img.decode().then(function () { done(true); }, function () { done(true); });
            else done(true);
          };
          img.onerror = function () { done(false); };
          img.src = srcFor(i);
          frames[i] = img;
        })(queue.shift());
      }
    }
    pumpQueue = next;
    next();
  }

  function unlockFine() {
    if (fineUnlocked) return;
    fineUnlocked = true;
    if (pumpQueue) pumpQueue();
  }

  function readyAtOrBelow(i) { for (var k = i; k >= 0; k--) if (ready[k]) return k; return -1; }
  function readyAtOrAbove(i) { for (var k = i; k < N; k++) if (ready[k]) return k; return -1; }

  function resize() {
    // Phones get a full-density canvas so the 1080px stills stay sharp on 3x screens.
    var cap = PHONE_MQ.matches ? 3 : 2;
    var dpr = Math.min(window.devicePixelRatio || 1, cap);
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    needsResize = false;
    lastDrawn = -1;
  }

  function paint(img, alpha) {
    var cw = canvas.width, ch = canvas.height;
    var iw = img.naturalWidth, ih = img.naturalHeight;
    var scale = Math.max(cw / iw, ch / ih);
    var dw = iw * scale, dh = ih * scale;
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, (cw - dw) / 2, (ch - dh) * focusY, dw, dh);
  }

  function draw(pos) {
    var lo = readyAtOrBelow(Math.floor(pos));
    var hi = readyAtOrAbove(Math.ceil(pos));
    if (lo < 0 && hi < 0) return;
    if (lo < 0) lo = hi;
    if (hi < 0) hi = lo;
    paint(frames[lo], 1);
    if (hi !== lo && !REDUCED) {
      var t = (pos - lo) / (hi - lo);
      if (t > 0.01) paint(frames[hi], t);
    }
    ctx.globalAlpha = 1;
  }

  function progress() {
    var rect = section.getBoundingClientRect();
    var total = rect.height - window.innerHeight;
    if (total <= 0) return 0;
    var p = -rect.top / total;
    return p < 0 ? 0 : p > 1 ? 1 : p;
  }

  function updateUI(q, p) {
    var active = -1;
    if (q < 0.085) active = 0;
    else if (q > 0.9) active = 4;
    else {
      for (var s = 1; s < 4; s++) if (Math.abs(q - STAGE_POS[s]) < 0.095) active = s;
    }
    for (var j = 0; j < stages.length; j++) {
      var on = j === active;
      if (stages[j].classList.contains("is-active") !== on) stages[j].classList.toggle("is-active", on);
    }
    if (railFill) railFill.style.transform = "scaleX(" + q.toFixed(4) + ")";
    for (var r = 0; r < railItems.length; r++) {
      railItems[r].classList.toggle("is-reached", q >= STAGE_POS[r] - 0.02);
    }
    section.classList.toggle("is-scrolled", p > 0.01);
  }

  function frame() {
    ticking = false;
    if (needsResize) resize();
    var p = progress();
    var q = (p - HOLD_START) / (1 - HOLD_START - HOLD_END);
    q = q < 0 ? 0 : q > 1 ? 1 : q;
    target = q * (N - 1);

    if (REDUCED) current = target;
    else {
      current += (target - current) * 0.2;
      if (Math.abs(target - current) < 0.005) current = target;
    }
    var key = Math.round(current * 100);
    if (key !== lastDrawn) { draw(current); lastDrawn = key; }
    updateUI(q, p);
    if (current !== target) requestTick();
  }

  function requestTick() {
    if (!ticking) { ticking = true; window.requestAnimationFrame(frame); }
  }

  function chooseSet() {
    var want = PHONE_MQ.matches ? "m" : "d";
    focusY = STACKED_MQ.matches ? 0.5 : 0.55;
    if (want !== set) loadSet(want);
  }

  function onMediaChange() { chooseSet(); needsResize = true; requestTick(); }
  function listen(mq) {
    if (mq.addEventListener) mq.addEventListener("change", onMediaChange);
    else if (mq.addListener) mq.addListener(onMediaChange); // Safari < 14
  }

  function start() {
    chooseSet();
    listen(PHONE_MQ);
    listen(STACKED_MQ);
    requestTick();
  }

  // Let the page's own content (fonts, poster, CSS) finish first, then stream stills.
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });

  window.addEventListener("scroll", function () { unlockFine(); requestTick(); }, { passive: true });
  ["keydown", "touchstart", "wheel"].forEach(function (ev) {
    window.addEventListener(ev, unlockFine, { passive: true, once: true });
  });
  window.addEventListener("resize", function () { needsResize = true; requestTick(); });
  if (window.ResizeObserver) {
    new ResizeObserver(function () { needsResize = true; requestTick(); }).observe(canvas);
  }
})();

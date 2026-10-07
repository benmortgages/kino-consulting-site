/* Kino Consulting — shared behavior: header state, phone call bar, mobile nav, footer year. */
(function () {
  "use strict";

  var header = document.querySelector(".site-header");
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("site-nav");
  var body = document.body;

  // Header turns solid once the page scrolls (home starts transparent over the build).
  var build = document.querySelector("[data-build]");
  var callbar = document.querySelector("[data-callbar]");
  function setCallbar(show) {
    if (!callbar) return;
    callbar.classList.toggle("is-hidden", !show);
    // A hidden bar must not be reachable by keyboard or screen reader.
    var inert = callbar.hasAttribute("inert");
    if (show && inert) callbar.removeAttribute("inert");
    else if (!show && !inert) callbar.setAttribute("inert", "");
  }
  function onScroll() {
    if (!header) return;
    // Over the home-page build sequence the header stays transparent so the image reads edge to edge.
    var threshold = build ? build.offsetTop + build.offsetHeight - header.offsetHeight : 24;
    var past = window.scrollY > threshold;
    var solid = past || body.classList.contains("header-solid") || body.classList.contains("nav-open");
    header.classList.toggle("is-solid", solid);
    // The phone call bar waits until the home-page build sequence is done (it has its own buttons).
    setCallbar((!build || past) && !body.classList.contains("nav-open"));
  }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  // Mobile navigation
  // While the full-screen phone menu is open, keep keyboard and screen-reader focus inside it.
  function setBackgroundInert(on) {
    ["main", ".site-footer", ".site-logo", ".header-call"].forEach(function (sel) {
      var el = document.querySelector(sel);
      if (el) { if (on) el.setAttribute("inert", ""); else el.removeAttribute("inert"); }
    });
  }
  function closeNav() {
    body.classList.remove("nav-open");
    setBackgroundInert(false);
    onScroll();
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  }
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = body.classList.toggle("nav-open");
      setBackgroundInert(open);
      onScroll();
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        var first = nav.querySelector("a");
        if (first) first.focus({ preventScroll: true });
      }
    });
    nav.addEventListener("click", function (e) {
      if (e.target.closest("a")) closeNav();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && body.classList.contains("nav-open")) {
        closeNav();
        toggle.focus();
      }
    });
    var desktop = window.matchMedia("(min-width: 901px)");
    var onDesktop = function (mq) { if (mq.matches) closeNav(); };
    if (desktop.addEventListener) desktop.addEventListener("change", onDesktop);
    else if (desktop.addListener) desktop.addListener(onDesktop); // Safari < 14
  }

  // Footer year
  var y = document.querySelectorAll("[data-year]");
  for (var i = 0; i < y.length; i++) y[i].textContent = new Date().getFullYear();
})();

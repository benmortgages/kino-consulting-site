/* Kino Consulting — Google Analytics 4 (only loaded when a Measurement ID is set in build.py).
   Records page views plus the actions that matter: calls, emails, "Start a project" clicks and
   form submissions. It never sends names, emails, phone numbers or message text. */
(function () {
  "use strict";
  var me = document.currentScript;
  var id = me && me.getAttribute("data-ga4");
  if (!id) return;
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag("js", new Date());
  gtag("config", id);

  function where(el) {
    if (el.closest("[data-callbar]")) return "phone_call_bar";
    if (el.closest(".site-header")) return "header";
    if (el.closest(".site-footer")) return "footer";
    var section = el.closest("section");
    return (section && (section.id || section.getAttribute("aria-labelledby") || section.getAttribute("aria-label"))) || "page";
  }

  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    var href = a.getAttribute("href");
    if (href.indexOf("tel:") === 0) gtag("event", "phone_call_click", { link_location: where(a) });
    else if (href.indexOf("mailto:") === 0) gtag("event", "email_click", { link_location: where(a) });
    else if (/(^|\/)contact\.html$/.test(href)) gtag("event", "start_project_click", { link_location: where(a) });
  });

  document.addEventListener("kino:lead", function (e) {
    var d = e.detail || {};
    gtag("event", "generate_lead", {
      form_name: "project-inquiry", service: d.service || "", project_type: d.project_type || "",
      budget: d.budget || "", has_file: d.has_file ? "yes" : "no"
    });
  });
})();

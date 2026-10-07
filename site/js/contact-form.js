/* Kino Consulting — project inquiry form.
   Sends to Netlify Forms in the background and shows the thank-you message in place.
   Without JavaScript the form still posts normally and lands on thank-you.html. */
(function () {
  "use strict";
  var form = document.querySelector("form[data-ajax]");
  if (!form) return;
  var success = document.getElementById("form-success");
  var errorBox = form.querySelector(".form__error");
  var button = form.querySelector('button[type="submit"]');
  var label = button ? button.textContent : "";
  var fileInput = form.querySelector('input[type="file"]');
  var OK_TYPES = /\.(pdf|jpe?g|png|heic|heif)$/i;

  // Netlify accepts one file per field and about 8 MB per submission, so check before sending.
  function checkFile() {
    if (!fileInput) return;
    var file = fileInput.files && fileInput.files[0];
    var maxMb = parseFloat(fileInput.getAttribute("data-max-mb")) || 7;
    var msg = "";
    if (file && !OK_TYPES.test(file.name)) msg = "Please choose a PDF, JPG, PNG or HEIC file.";
    else if (file && file.size > maxMb * 1024 * 1024) msg = "That file is over " + maxMb + " MB. Choose a smaller file, or email it to us instead.";
    fileInput.setCustomValidity(msg);
  }
  if (fileInput) fileInput.addEventListener("change", function () { checkFile(); fileInput.reportValidity(); });

  function chosen(name) {
    var el = form.querySelector('[name="' + name + '"]:checked') || form.querySelector('select[name="' + name + '"]');
    return el ? el.value : "";
  }

  function showSuccess(hasFile) {
    var nameField = form.querySelector('[name="name"]');
    var first = nameField && nameField.value.trim().split(/\s+/)[0];
    var who = success.querySelector("[data-first-name]");
    if (who) who.textContent = first ? ", " + first : "";
    form.hidden = true;
    success.hidden = false;
    var heading = success.querySelector("h2");
    if (heading) heading.focus();
    var calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    success.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "center" });
    // For analytics.js (if enabled): no names, emails or messages, only the choices made.
    document.dispatchEvent(new CustomEvent("kino:lead", { detail: {
      service: chosen("service"), project_type: chosen("project_type"), budget: chosen("budget"), has_file: hasFile
    } }));
  }

  form.addEventListener("submit", function (e) {
    checkFile();
    if (!form.checkValidity()) return; // let the browser show what's missing
    e.preventDefault();
    if (errorBox) errorBox.hidden = true;
    button.disabled = true;
    button.textContent = "Sending…";

    var data = new FormData(form);
    var hasFile = !!(fileInput && fileInput.files && fileInput.files.length);
    if (form.hasAttribute("data-preview")) { showSuccess(hasFile); return; }

    var request = { method: "POST" };
    if (hasFile) {
      request.body = data; // multipart: the browser sets the Content-Type and boundary itself
    } else {
      if (fileInput) data.delete(fileInput.name);
      request.headers = { "Content-Type": "application/x-www-form-urlencoded" };
      request.body = new URLSearchParams(data).toString();
    }
    // Give up after a while on a stalled connection instead of spinning forever. Uploads get longer.
    var timeoutMs = parseInt(form.getAttribute("data-timeout"), 10) || (hasFile ? 45000 : 20000);
    var controller = window.AbortController ? new AbortController() : null;
    if (controller) request.signal = controller.signal;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, timeoutMs);
    fetch("/", request)
      .then(function (res) {
        clearTimeout(timer);
        if (!res.ok) throw new Error("Status " + res.status);
        showSuccess(hasFile);
      })
      .catch(function () {
        clearTimeout(timer);
        button.disabled = false;
        button.textContent = label;
        if (errorBox) { errorBox.hidden = false; errorBox.focus(); }
      });
  });
})();

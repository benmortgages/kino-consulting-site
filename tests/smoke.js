// Production smoke tests for the Kino Consulting site.
// Runs against tests/server.js (site/ + the real netlify.toml headers) in Chromium.
// Usage: node tests/smoke.js        Exit code 1 if any check fails.
const { chromium } = require("playwright");
const { start } = require("./server");

const BASE = "http://localhost:8790";
const PAGES = ["index.html", "services.html", "how-we-work.html", "about.html", "contact.html", "thank-you.html", "404.html"];
const NOINDEX = ["thank-you.html", "404.html"];
const VIEWPORTS = [[320, 640], [375, 667], [390, 844], [430, 932], [768, 1024], [1024, 768], [1024, 1366], [1440, 900], [1920, 1080], [2560, 1440], [667, 375], [844, 390]];

let failures = 0;
function check(ok, name, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? "  -> " + detail : ""}`);
  if (!ok) failures++;
}

async function newPage(browser, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 600, hasTouch: w < 1100 });
  const page = await ctx.newPage();
  page.problems = [];
  page.on("console", (m) => { if (m.type() === "error") page.problems.push(m.text()); });
  page.on("pageerror", (e) => page.problems.push(String(e)));
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective + " " + e.blockedURI));
  });
  return page;
}

(async () => {
  const server = await start(8790);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

  // 1. Every page: loads, no JS errors, no CSP violations, sane SEO + a11y basics
  const titles = new Set(), descriptions = new Set();
  const page = await newPage(browser, 1440, 900);
  const localUrls = new Set(), hashLinks = new Set();
  for (const name of PAGES) {
    page.problems = [];
    const res = await page.goto(`${BASE}/${name}`, { waitUntil: "networkidle" });
    const info = await page.evaluate(() => ({
      csp: window.__csp,
      h1: document.querySelectorAll("h1").length,
      imgsNoAlt: [...document.images].filter((i) => !i.hasAttribute("alt")).map((i) => i.src),
      title: document.title,
      desc: (document.querySelector('meta[name="description"]') || {}).content || "",
      canonical: !!document.querySelector('link[rel="canonical"]'),
      robots: (document.querySelector('meta[name="robots"]') || {}).content || "",
      lang: document.documentElement.lang,
      skip: !!document.querySelector('a.skip-link[href="#main"]') && !!document.getElementById("main"),
      unlabeled: [...document.querySelectorAll("input:not([type=hidden]), select, textarea")]
        .filter((el) => !el.closest(".hp-field") && !(el.labels && el.labels.length) && !el.getAttribute("aria-label")).map((el) => el.name),
      urls: [...document.querySelectorAll("[href], [src], [srcset]")].flatMap((el) => {
        const out = [];
        ["href", "src"].forEach((a) => el.getAttribute(a) && out.push(el.getAttribute(a)));
        if (el.getAttribute("srcset")) el.getAttribute("srcset").split(",").forEach((s) => out.push(s.trim().split(/\s+/)[0]));
        return out;
      }),
    }));
    check(res.status() === (name === "404.html" ? 200 : 200), `${name}: loads`, res.status());
    check(page.problems.length === 0, `${name}: no console/JS errors`, page.problems.join(" | "));
    check(info.csp.length === 0, `${name}: no CSP violations`, info.csp.join(" | "));
    check(info.h1 === 1, `${name}: exactly one <h1>`, info.h1);
    check(info.imgsNoAlt.length === 0, `${name}: every <img> has alt`, info.imgsNoAlt.join(", "));
    check(info.lang === "en" && info.skip, `${name}: lang + skip link`);
    check(info.unlabeled.length === 0, `${name}: every form field has a label`, info.unlabeled.join(", "));
    check(info.title && !titles.has(info.title), `${name}: unique <title>`, info.title);
    check(info.desc.length > 50 && !descriptions.has(info.desc), `${name}: unique meta description`);
    titles.add(info.title); descriptions.add(info.desc);
    if (NOINDEX.includes(name)) check(/noindex/.test(info.robots) && !info.canonical, `${name}: noindex, no canonical`);
    else check(!info.robots && info.canonical, `${name}: indexable with canonical`);
    for (const u of info.urls) {
      if (/^(https?:|mailto:|tel:)/.test(u)) continue;
      if (u.startsWith("#")) { if (u.length > 1) hashLinks.add(`${name}${u}`); continue; }
      const abs = new URL(u, `${BASE}/${name}`);
      localUrls.add(abs.pathname);
      if (abs.hash) hashLinks.add(abs.pathname.replace(/^\//, "") + abs.hash);
    }
  }

  // 2. Links and assets all resolve
  const broken = [];
  for (const p of localUrls) {
    const r = await page.request.get(BASE + p);
    if (r.status() !== 200) broken.push(`${p} (${r.status()})`);
  }
  check(broken.length === 0, `internal links/assets resolve (${localUrls.size} checked)`, broken.join(", "));
  const missingAnchors = [];
  for (const h of hashLinks) {
    const [file, id] = h.split("#");
    await page.goto(`${BASE}/${file || "index.html"}`);
    if (!(await page.$(`[id="${id}"]`))) missingAnchors.push(h);
  }
  check(missingAnchors.length === 0, `in-page anchors exist (${hashLinks.size} checked)`, missingAnchors.join(", "));

  // 3. Real 404 behaviour and security headers
  const r404 = await page.request.get(`${BASE}/no-such-page`);
  check(r404.status() === 404 && (await r404.text()).includes("isn't on the plans"), "unknown URL returns custom 404");
  const hdr = (await page.request.get(`${BASE}/`)).headers();
  check(/default-src 'self'/.test(hdr["content-security-policy"] || ""), "CSP header present");
  check(!!hdr["strict-transport-security"] && hdr["x-content-type-options"] === "nosniff", "HSTS + nosniff headers present");

  // 4. No horizontal scrolling at any viewport
  for (const [w, h] of VIEWPORTS) {
    const p = await newPage(browser, w, h);
    const bad = [];
    for (const name of PAGES) {
      await p.goto(`${BASE}/${name}`, { waitUntil: "domcontentloaded" });
      const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (o > 0) bad.push(`${name}+${o}px`);
    }
    check(bad.length === 0, `no horizontal scroll at ${w}x${h}`, bad.join(", "));
    await p.context().close();
  }

  // 5. Hero sequence: loads lightly, then plays through every stage
  for (const [w, h, set] of [[1440, 900, "d"], [390, 844, "m"], [768, 1024, "d"], [667, 375, "d"]]) {
    const p = await newPage(browser, w, h);
    const frames = new Set();
    p.on("request", (rq) => { const m = rq.url().match(/frames\/v2\/([dm])\/(f\d+)/); if (m) frames.add(m[1] + m[2]); });
    await p.goto(`${BASE}/index.html`, { waitUntil: "load" });
    await p.waitForTimeout(1500);
    const before = frames.size;
    const rightSet = [...frames].every((f) => f.startsWith(set));
    check(before > 0 && before <= 15 && rightSet, `hero ${w}x${h}: only coarse "${set}" stills before scrolling`, `${before} requested`);
    const stageAt = async (f) => {
      await p.evaluate((f) => { const s = document.querySelector("[data-build]"); window.scrollTo(0, s.offsetTop + (s.offsetHeight - innerHeight) * f); }, f);
      await p.waitForTimeout(900);
      return p.evaluate(() => { const a = document.querySelector(".build__stage.is-active"); return a ? a.textContent.trim().slice(0, 30) : ""; });
    };
    const s0 = await stageAt(0.01), s2 = await stageAt(0.5), s4 = await stageAt(0.99);
    check(/YOUR VISION|Your vision/i.test(s0) && /Bring the right/.test(s2) && /Finish strong/.test(s4), `hero ${w}x${h}: stages advance with scroll`, [s0, s2, s4].join(" / "));
    await p.waitForTimeout(1500);
    check(frames.size > before, `hero ${w}x${h}: remaining stills stream after scrolling`, `${frames.size}`);
    const ready = await p.evaluate(() => document.querySelector("[data-build]").classList.contains("is-ready"));
    check(ready && p.problems.length === 0, `hero ${w}x${h}: canvas drawing, no errors`, p.problems.join(" | "));
    await p.context().close();
  }

  // 5b. Hero copy never runs into the progress line (real phone viewports, browser bars showing)
  for (const [w, h] of [[320, 568], [360, 640], [375, 548], [390, 664], [412, 780], [414, 715], [430, 739], [768, 1024]]) {
    const p = await newPage(browser, w, h);
    await p.goto(`${BASE}/index.html`, { waitUntil: "load" });
    const gaps = [];
    for (const f of [0.01, 0.27, 0.5, 0.75, 0.99]) {
      await p.evaluate((f) => { const s = document.querySelector("[data-build]"); window.scrollTo(0, s.offsetTop + (s.offsetHeight - innerHeight) * f); }, f);
      await p.waitForTimeout(700);
      gaps.push(await p.evaluate(() => {
        const st = document.querySelector(".build__stage.is-active");
        if (!st) return 999;
        const kids = [...st.children].filter((k) => getComputedStyle(k).display !== "none");
        const bottom = Math.max(...kids.map((k) => k.getBoundingClientRect().bottom));
        const tick = Math.min(...[...document.querySelectorAll(".rail li")].map((li) => li.getBoundingClientRect().top - 24));
        return Math.round(tick - bottom);
      }));
    }
    check(Math.min(...gaps) >= 8, `hero ${w}x${h}: copy and buttons clear the progress line`, `gaps ${gaps.join(", ")}px`);
    await p.context().close();
  }

  // 6. Phone menu: keyboard + focus handling
  {
    const p = await newPage(browser, 390, 844);
    await p.goto(`${BASE}/about.html`);
    await p.keyboard.press("Tab");
    check(await p.evaluate(() => document.activeElement.classList.contains("skip-link")), "first Tab lands on skip link");
    await p.click(".nav-toggle");
    const open = await p.evaluate(() => ({
      expanded: document.querySelector(".nav-toggle").getAttribute("aria-expanded"),
      inert: document.querySelector("main").hasAttribute("inert"),
      focusInNav: !!document.activeElement.closest("#site-nav"),
    }));
    check(open.expanded === "true" && open.inert && open.focusInNav, "menu opens, focus moves in, page behind is inert", JSON.stringify(open));
    await p.keyboard.press("Escape");
    const closed = await p.evaluate(() => ({
      expanded: document.querySelector(".nav-toggle").getAttribute("aria-expanded"),
      inert: document.querySelector("main").hasAttribute("inert"),
      focus: document.activeElement.classList.contains("nav-toggle"),
    }));
    check(closed.expanded === "false" && !closed.inert && closed.focus, "Escape closes menu and returns focus", JSON.stringify(closed));
    await p.context().close();
  }

  // 6b. Phone call bar: shows on phones, waits for the home build sequence, never covers the footer
  {
    const p = await newPage(browser, 390, 844);
    const bar = () => p.evaluate(() => {
      const b = document.querySelector("[data-callbar]");
      const r = b.getBoundingClientRect();
      return { shown: !b.classList.contains("is-hidden") && getComputedStyle(b).visibility === "visible", inert: b.hasAttribute("inert"), bottom: Math.round(r.bottom), h: Math.round(r.height), vh: innerHeight };
    });
    await p.goto(`${BASE}/about.html`, { waitUntil: "load" }); await p.waitForTimeout(400);
    const about = await bar();
    check(about.shown && !about.inert && about.bottom === about.vh && about.h >= 60, "call bar: visible at the bottom on phone pages", JSON.stringify(about));
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(400);
    const clear = await p.evaluate(() => {
      const last = [...document.querySelectorAll(".site-footer__bottom span")].pop().getBoundingClientRect().bottom;
      return Math.round(document.querySelector("[data-callbar]").getBoundingClientRect().top - last);
    });
    check(clear >= 0, "call bar: never covers the end of the footer", `${clear}px`);
    await p.click(".nav-toggle"); await p.waitForTimeout(400);
    const menu = await bar();
    check(!menu.shown && menu.inert, "call bar: hidden while the phone menu is open", JSON.stringify(menu));
    await p.keyboard.press("Escape"); await p.waitForTimeout(400);
    check((await bar()).shown, "call bar: returns when the menu closes");
    await p.goto(`${BASE}/index.html`, { waitUntil: "load" }); await p.waitForTimeout(400);
    const hero = await bar();
    await p.evaluate(() => { const s = document.querySelector("[data-build]"); window.scrollTo(0, s.offsetTop + s.offsetHeight + 200); }); await p.waitForTimeout(500);
    const after = await bar();
    check(!hero.shown && hero.inert && after.shown && !after.inert, "call bar: hidden during the home build sequence, shown after it", JSON.stringify({ hero, after }));
    await p.goto(`${BASE}/contact.html`, { waitUntil: "load" }); await p.waitForTimeout(300);
    const startShown = await p.evaluate(() => getComputedStyle(document.querySelector(".callbar__start")).display !== "none");
    check(!startShown, "call bar: contact page shows Call only");
    await p.context().close();
    const d = await newPage(browser, 1440, 900);
    await d.goto(`${BASE}/about.html`);
    check(await d.evaluate(() => getComputedStyle(document.querySelector("[data-callbar]")).display === "none"), "call bar: not shown on desktop");
    await d.context().close();
  }

  // 7. Contact form
  {
    const p = await newPage(browser, 1440, 900);
    const setMode = (m) => p.request.get(`${BASE}/__mode?form=${m}`);
    const posts = async () => (await p.request.get(`${BASE}/__posts`)).json();
    const fresh = async () => { await p.goto(`${BASE}/contact.html`, { waitUntil: "networkidle" }); };
    const fillValid = async () => {
      await p.fill("#f-name", 'Maria <script>alert(1)</script> & "Q"');
      await p.fill("#f-email", "maria@example.com");
      await p.fill("#f-message", "Tenant buildout for a cafe. Budget about $250k & we open in spring.");
    };

    await setMode("ok"); await fresh();
    await p.click('button[type="submit"]'); await p.waitForTimeout(300);
    check((await posts()).length === 0, "form: blank submit is blocked (required fields)");

    await fillValid(); await p.fill("#f-email", "not-an-email");
    await p.click('button[type="submit"]'); await p.waitForTimeout(300);
    check((await posts()).length === 0, "form: invalid email is blocked");

    await p.fill("#f-email", "maria@example.com"); await p.fill("#f-phone", "call me maybe");
    await p.click('button[type="submit"]'); await p.waitForTimeout(300);
    check((await posts()).length === 0, "form: invalid phone is blocked");
    await p.fill("#f-phone", "(630) 555-0123");

    await p.fill("#f-message", "x".repeat(6000));
    check((await p.inputValue("#f-message")).length === 5000, "form: message capped at 5,000 characters");
    await p.fill("#f-message", "Tenant buildout for a cafe.");

    await p.dblclick('button[type="submit"]'); await p.waitForTimeout(800);
    const okPosts = await posts();
    const success = await p.evaluate(() => ({
      visible: !document.getElementById("form-success").hidden,
      formHidden: document.querySelector("form[data-ajax]").hidden,
      heading: document.querySelector("#form-success h2").textContent,
      injected: document.querySelectorAll("#form-success script").length,
      focus: document.activeElement === document.querySelector("#form-success h2"),
    }));
    check(okPosts.length === 1, "form: double-click sends exactly one submission", `${okPosts.length} sent`);
    check(/form-name=project-inquiry/.test(okPosts[0] || "") && /email=maria%40example.com/.test(okPosts[0] || ""), "form: payload has form-name and fields for Netlify");
    check(success.visible && success.formHidden && /^Thank you, Maria/.test(success.heading) && success.focus, "form: thank-you message shown and focused", JSON.stringify(success));
    check(success.injected === 0, "form: name with <script> is shown as text, not run");

    // Project type, budget and an attached plan travel with the submission
    await setMode("ok"); await fresh(); await fillValid();
    await p.selectOption("#f-type", "Tenant buildout");
    await p.selectOption("#f-budget", "$150k to $500k");
    await p.setInputFiles("#f-plans", { name: "big-plan.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(7.5 * 1024 * 1024, 1) });
    await p.click('button[type="submit"]'); await p.waitForTimeout(400);
    const bigMsg = await p.evaluate(() => document.querySelector("#f-plans").validationMessage);
    check((await posts()).length === 0 && /over 7 MB/.test(bigMsg), "form: a file over 7 MB is stopped with a clear message", bigMsg);
    await p.setInputFiles("#f-plans", { name: "notes.exe", mimeType: "application/octet-stream", buffer: Buffer.from("x") });
    await p.click('button[type="submit"]'); await p.waitForTimeout(300);
    check((await posts()).length === 0, "form: a file that isn't PDF/JPG/PNG/HEIC is stopped");
    await p.setInputFiles("#f-plans", { name: "floor-plan.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test plan") });
    await p.click('button[type="submit"]'); await p.waitForTimeout(800);
    const up = (await posts())[0] || "";
    check(/name="form-name"\r\n\r\nproject-inquiry/.test(up) && /filename="floor-plan.pdf"/.test(up) && /%PDF-1.4 test plan/.test(up),
      "form: an attached plan is sent to Netlify as a file upload", up.slice(0, 120));
    check(/name="project_type"\r\n\r\nTenant buildout/.test(up) && /name="budget"\r\n\r\n\$150k to \$500k/.test(up), "form: project type and budget are included");
    check(await p.evaluate(() => !document.getElementById("form-success").hidden), "form: thank-you shown after an upload");

    await setMode("fail"); await fresh(); await fillValid();
    await p.click('button[type="submit"]'); await p.waitForTimeout(800);
    const failed = await p.evaluate(() => ({
      error: !document.querySelector(".form__error").hidden,
      enabled: !document.querySelector('button[type="submit"]').disabled,
      kept: document.querySelector("#f-email").value,
    }));
    check(failed.error && failed.enabled && failed.kept === "maria@example.com", "form: server error shows message, keeps input, allows retry", JSON.stringify(failed));

    await setMode("hang"); await fresh(); await fillValid();
    await p.evaluate(() => document.querySelector("form[data-ajax]").setAttribute("data-timeout", "1500"));
    await p.click('button[type="submit"]');
    const sending = await p.textContent('button[type="submit"]');
    await p.waitForTimeout(2300);
    const timedOut = await p.evaluate(() => !document.querySelector(".form__error").hidden);
    check(/Sending/.test(sending) && timedOut, "form: shows loading state, then times out with a message");

    const markup = await p.evaluate(() => { const f = document.querySelector("form[data-ajax]"); return f.method + " " + f.getAttribute("action") + " " + f.hasAttribute("data-netlify") + " " + f.getAttribute("netlify-honeypot"); });
    check(markup === "post thank-you.html true bot-field", "form: works without JavaScript (POST to thank-you.html, Netlify + honeypot)", markup);
    check(await p.evaluate(() => document.querySelector("form[data-ajax]").enctype === "multipart/form-data"), "form: uploads also work without JavaScript (multipart)");
    await setMode("ok");
    await p.context().close();
  }

  await browser.close();
  server.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

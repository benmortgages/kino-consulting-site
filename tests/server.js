// Local stand-in for Netlify: serves ./site with the headers from site/netlify.toml,
// returns 404.html for missing paths, and fakes the Netlify Forms endpoint (POST /).
// The form endpoint's behaviour is switchable for tests: GET /__mode?form=ok|fail|hang
const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = process.env.KINO_ROOT ? path.resolve(process.env.KINO_ROOT) : path.join(__dirname, "..", "site");
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".xml": "application/xml", ".txt": "text/plain",
  ".webmanifest": "application/manifest+json", ".toml": "text/plain",
};

function parseNetlifyHeaders() {
  const rules = [];
  let cur = null;
  for (const line of fs.readFileSync(path.join(ROOT, "netlify.toml"), "utf8").split("\n")) {
    const f = line.match(/^\s*for\s*=\s*"([^"]+)"/);
    if (f) { cur = { pattern: f[1], values: {} }; rules.push(cur); continue; }
    const kv = line.match(/^\s*([A-Za-z-]+)\s*=\s*"(.*)"\s*$/);
    if (kv && cur && kv[1] !== "publish") cur.values[kv[1]] = kv[2];
  }
  return rules;
}
const RULES = parseNetlifyHeaders();
function headersFor(urlPath) {
  const out = {};
  for (const r of RULES) {
    const prefix = r.pattern.replace(/\*$/, "");
    if (urlPath.startsWith(prefix)) Object.assign(out, r.values);
  }
  return out;
}

const state = { mode: "ok", posts: [] };

function start(port = 8790) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/__mode") {
      state.mode = url.searchParams.get("form") || "ok";
      state.posts = [];
      res.end("ok");
      return;
    }
    if (url.pathname === "/__posts") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(state.posts));
      return;
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        state.posts.push(body);
        if (state.mode === "hang") return; // never answer
        res.statusCode = state.mode === "fail" ? 500 : 200;
        res.end(state.mode === "fail" ? "error" : "ok");
      });
      return;
    }
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith("/")) p += "index.html";
    let file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) { res.statusCode = 400; res.end(); return; }
    let status = 200;
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (fs.existsSync(file + ".html")) file += ".html"; // Netlify-style clean URLs
      else { file = path.join(ROOT, "404.html"); status = 404; }
    }
    const h = headersFor(url.pathname);
    for (const k of Object.keys(h)) res.setHeader(k, h[k]);
    res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
    res.statusCode = status;
    // Netlify compresses text assets; do the same so performance numbers are realistic.
    const ext = path.extname(file);
    if ([".html", ".css", ".js", ".xml", ".txt", ".webmanifest"].includes(ext) && /gzip/.test(req.headers["accept-encoding"] || "")) {
      res.setHeader("Content-Encoding", "gzip");
      fs.createReadStream(file).pipe(zlib.createGzip()).pipe(res);
    } else {
      fs.createReadStream(file).pipe(res);
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

module.exports = { start, state };
if (require.main === module) start().then(() => console.log("http://localhost:8790"));

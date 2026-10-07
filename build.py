#!/usr/bin/env python3
"""Assemble the Kino Consulting static site from templates/ into site/.

Edit CONFIG below (phone, email, service area, domain), then run:
    python3 build.py
"""
import base64, datetime, hashlib, json, os, re, pathlib

ROOT = pathlib.Path(__file__).parent
TPL = ROOT / "templates"
OUT = ROOT / "site"

CONFIG = {
    # ---- REPLACE THESE WITH KINO'S REAL DETAILS ----
    "phone": "(331) 241-8800",
    "email": "info@kinoconsult.com",
    "service_area": "Chicagoland",
    "site_url": "https://kinoconsult.com",   # no trailing slash
    "service_area_confirmed": False,         # set True once the service area is confirmed
    "ga4_id": "G-KQWPGESSNP",                # Google Analytics 4 Measurement ID, e.g. "G-ABC123XYZ". Empty = no tracking.
}

PAGES = ["index.html", "services.html", "how-we-work.html", "about.html", "contact.html", "thank-you.html", "404.html"]
SITEMAP = ["/", "/services.html", "/how-we-work.html", "/about.html", "/contact.html"]


def parse(path):
    raw = path.read_text()
    meta, body = {}, raw
    if raw.startswith("---"):
        _, fm, body = raw.split("---", 2)
        for line in fm.strip().splitlines():
            k, _, v = line.partition(":")
            meta[k.strip()] = v.strip()
    return meta, body.strip("\n")


def esc(text):
    """Escape text going into HTML text or attribute values."""
    return text.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;")


def jsonld(cfg):
    data = {
        "@context": "https://schema.org",
        "@type": "GeneralContractor",
        "name": "Kino Consulting, Inc.",
        "slogan": "Your Vision. Built Right.",
        "description": "Construction consulting, construction management, general contracting, and design-build services led by a husband-and-wife team.",
        "founder": [
            {"@type": "Person", "name": "Andrea Aranki", "jobTitle": "President and CEO"},
            {"@type": "Person", "name": "Jake Aranki", "jobTitle": "Executive Vice President"},
        ],
        "knowsAbout": ["Construction consulting", "Construction management", "General contracting", "Design-build",
                       "Commercial tenant buildouts", "Renovations", "Facility improvements"],
    }
    if cfg["site_url"]:
        data["url"] = cfg["site_url"] + "/"
        data["logo"] = cfg["site_url"] + "/img/kino-logo-dark.png"
        data["image"] = cfg["site_url"] + "/img/og-image.jpg"
    data["telephone"] = "+1-" + "-".join(re.findall(r"\d+", cfg["phone"]))
    data["email"] = cfg["email"]
    if cfg["service_area_confirmed"]:
        data["areaServed"] = cfg["service_area"]
    return json.dumps(data, separators=(",", ":"))


def build():
    layout = (TPL / "_layout.html").read_text()
    cta = (TPL / "_cta.html").read_text()
    cfg = dict(CONFIG)
    cfg["phone_tel"] = "+1" + re.sub(r"\D", "", cfg["phone"])[-10:]
    cfg["ga4_id"] = os.environ.get("KINO_GA4", cfg["ga4_id"])  # lets tests build a tracked copy

    inline_scripts = set()
    for name in PAGES:
        meta, body = parse(TPL / name)
        html = layout
        if not cfg["site_url"]:
            # No domain yet: drop absolute-URL tags rather than ship broken ones.
            html = re.sub(r'\n<link rel="canonical"[^\n]*', "", html)
            html = re.sub(r'\n<meta property="og:url"[^\n]*', "", html)
            html = html.replace('content="{{site_url}}/img/og-image.jpg"', 'content="img/og-image.jpg"')
        if meta.get("robots"):
            html = html.replace('<meta name="theme-color"', f'<meta name="robots" content="{meta["robots"]}">\n<meta name="theme-color"')
            if "noindex" in meta["robots"]:
                # A noindex page shouldn't advertise itself as the canonical URL.
                html = re.sub(r'\n<link rel="canonical"[^\n]*', "", html)
                html = re.sub(r'\n<meta property="og:url"[^\n]*', "", html)
        nav = meta.get("nav", "")
        repl = {
            "content": body.replace("{{cta}}", cta),
            "title": esc(meta.get("title", "Kino Consulting, Inc.")),
            "og_title": esc(meta.get("og_title", meta.get("title", ""))),
            "description": esc(meta.get("description", "")),
            "canonical": meta.get("canonical", "/"),
            "body_class": meta.get("body_class", ""),
            "scripts": meta.get("scripts", ""),
            "head_extra": meta.get("head_extra", ""),
            "jsonld": jsonld(cfg),
            "nav_services": ' aria-current="page"' if nav == "services" else "",
            "nav_process": ' aria-current="page"' if nav == "process" else "",
            "analytics": analytics_tags(cfg),
            "nav_about": ' aria-current="page"' if nav == "about" else "",
            "nav_contact": ' aria-current="page"' if nav == "contact" else "",
        }
        # two passes so tokens inside the page body/CTA get filled too
        for _ in range(2):
            for k, v in {**repl, **{k: str(v) for k, v in cfg.items()}}.items():
                html = html.replace("{{" + k + "}}", v)
        html = re.sub(r"\n{3,}", "\n\n", html)
        if name == "404.html":
            # 404 can be served from any depth, so make local paths root-absolute.
            html = re.sub(r'(href|src)="(?!https?:|mailto:|tel:|#|/)(\./)?', r'\1="/', html)
            html = re.sub(r'srcset="([^"]*)"', lambda m: 'srcset="' + re.sub(r'(^|,\s*)(?!https?:|/)', r'\1/', m.group(1)) + '"', html)
        left = re.findall(r"\{\{\w+\}\}", html)
        assert not left, f"{name}: unfilled tokens {left}"
        (OUT / name).write_text(html)
        inline_scripts.update(re.findall(r"<script>(.*?)</script>", html, flags=re.S))
        print("built", name)

    write_netlify_toml(inline_scripts, bool(cfg["ga4_id"]))

    if cfg["site_url"]:
        today = datetime.date.today().isoformat()
        urls = "".join(f"  <url><loc>{cfg['site_url']}{u}</loc><lastmod>{today}</lastmod></url>\n" for u in SITEMAP)
        (OUT / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + "</urlset>\n")
        (OUT / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {cfg['site_url']}/sitemap.xml\n")
        print("built sitemap.xml, robots.txt")


def analytics_tags(cfg):
    """Google Analytics 4, loaded only when a Measurement ID is set in CONFIG."""
    gid = cfg.get("ga4_id", "").strip()
    if not gid:
        return ""
    assert re.fullmatch(r"G-[A-Z0-9]{4,20}", gid), f"ga4_id looks wrong: {gid!r}"
    return (f'<script async src="https://www.googletagmanager.com/gtag/js?id={gid}"></script>\n'
            f'<script src="js/analytics.js" defer data-ga4="{gid}"></script>')


def write_netlify_toml(inline_scripts, ga4=False):
    """Security + caching headers. The CSP allows only this site's own files, plus the
    tiny inline <script> in the page head, pinned by its SHA-256 hash."""
    hashes = " ".join(
        "'sha256-" + base64.b64encode(hashlib.sha256(js.encode()).digest()).decode() + "'"
        for js in sorted(inline_scripts))
    # Google Analytics needs its own script, beacon and pixel hosts; only allowed when GA4 is on.
    ga_script = " https://*.googletagmanager.com" if ga4 else ""
    ga_img = " https://*.google-analytics.com https://*.googletagmanager.com" if ga4 else ""
    ga_connect = " https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com" if ga4 else ""
    csp = ("default-src 'self'; "
           f"script-src 'self' {hashes}{ga_script}; "
           f"style-src 'self'; img-src 'self' data:{ga_img}; font-src 'self'; connect-src 'self'{ga_connect}; "
           "manifest-src 'self'; form-action 'self'; frame-ancestors 'self'; base-uri 'self'; "
           "object-src 'none'; upgrade-insecure-requests")
    toml = f"""# Netlify configuration for the Kino Consulting site (static, no build step).
# Generated by build.py -- edit there, not here.
[build]
  publish = "."

[[headers]]
  for = "/*"
  [headers.values]
    Content-Security-Policy = "{csp}"
    Strict-Transport-Security = "max-age=31536000"
    X-Content-Type-Options = "nosniff"
    X-Frame-Options = "SAMEORIGIN"
    Referrer-Policy = "strict-origin-when-cross-origin"
    Permissions-Policy = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"

# Frames live in a versioned folder (frames/v2/...), so they can be cached forever.
# If the footage changes, render into frames/v3/ and update index.html.
[[headers]]
  for = "/frames/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"
[[headers]]
  for = "/fonts/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

# Images keep their file names when replaced, so cache them for a day only.
[[headers]]
  for = "/img/*"
  [headers.values]
    Cache-Control = "public, max-age=86400"
[[headers]]
  for = "/css/*"
  [headers.values]
    Cache-Control = "public, max-age=3600, must-revalidate"
[[headers]]
  for = "/js/*"
  [headers.values]
    Cache-Control = "public, max-age=3600, must-revalidate"
"""
    (OUT / "netlify.toml").write_text(toml)
    print("built netlify.toml (CSP hashes:", hashes + ")")


if __name__ == "__main__":
    build()

# Kino Consulting website

Static site for Kino Consulting, Inc., hosted on Netlify. No server code, database, logins or payments.

## Layout
- `site/` is the deploy folder. Zip its contents (`index.html` at the top of the zip) or drag the folder onto Netlify.
- `templates/` holds the page HTML. `build.py` turns the templates into `site/*.html` and generates:
  - `site/netlify.toml` (security headers, including a CSP that pins the inline head script by hash)
  - `site/sitemap.xml`
  - `site/robots.txt`
- `site/css`, `site/js`, `site/img`, `site/fonts` and `site/frames` are edited in place. They aren't templated.
- `tests/` holds a local Netlify stand-in (`server.js`) and the smoke tests (`smoke.js`).

## Making changes
1. Edit `templates/*.html`, or the CSS/JS in `site/`.
2. Run `npm run check`, which does build → HTML validation → ESLint → 138 browser smoke tests. It must pass before deploying.
3. Deploy `site/`.

Don't edit `site/*.html` or `site/netlify.toml` by hand. `build.py` overwrites them.

Contact details (phone, email, domain, service area) and the Google Analytics 4 Measurement ID (`ga4_id`) live in `CONFIG` at the top of `build.py`. With `ga4_id` empty, no tracking code is added; once it's set, the build adds Google's tag, records calls, emails, "Start a project" clicks and form submissions (never names, emails or messages), and opens the Content Security Policy only for Google's analytics hosts.

## Hero footage
- 97 stills per set:
  - `site/frames/v2/d` is 1920x1080, for desktops, tablets and landscape phones.
  - `site/frames/v2/m` is a 1080x1080 crop, for upright phones.
- Frames are cached for a year. If the footage changes, render into `frames/v3/` and update the paths in `templates/index.html`. Don't overwrite `v2`, or returning visitors will keep seeing the old stills.
- Visitors who don't scroll only download every 8th still. The rest stream in on the first scroll.

## Pages
- `how-we-work.html`: the five phases (Vision, Plan, Coordinate, Build, Deliver) and which phases each service covers.
- The contact form takes project type, budget range and one optional upload (PDF/JPG/PNG/HEIC, up to 7 MB; Netlify caps a submission at 8 MB). With a file attached it posts as multipart; without one it stays URL-encoded.
- Phones get a fixed Call / Start a project bar. It waits until the home-page build sequence is finished and hides while the menu is open.

## Netlify setup (one time)
- Forms → Enable form detection, then deploy.
- Forms → Submission notifications → Add notification → Email notification. Form: `project-inquiry`. Email: info@kinoconsult.com.
- Domain management: add kinoconsult.com and www.kinoconsult.com, and pick one as primary. Netlify then redirects the other and issues the HTTPS certificate.

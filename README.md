# myceevee

A tiny self-hosted microsite for your CV. It keeps two versions, a **one-page** CV and a **full** CV, both written
in the [JSON Resume](https://jsonresume.org/schema) format and read from a GitHub gist. You decide, per CV:

- **Public:** always available at `/cv/one-page` or `/cv/full`.
- **Private:** hidden (404), but you can mint a **short link** (`/s/<token>`) with a lifetime. After it expires, or
  once you revoke it, visitors see a friendly landing page (HTTP 410) instead. Hand these to recruiters.

Every CV page has a **Download PDF** button, so whoever you send a link to can keep a copy ([details](#pdf-download)).

**Requirements:** `make` and Docker, nothing else. Node and npm never run on your machine: every `make` target that needs
them runs inside a `node:24` container (the same as CI) as your user, with `node_modules` kept in the project folder.

## Quick start

```bash
make setup    # installs dependencies (in Docker), creates .env with a random ADMIN_TOKEN and SESSION_SECRET
# edit .env: set GIST_ID (see step 1)
make dev      # http://localhost:4321, admin at http://localhost:4321/admin (sign in with ADMIN_TOKEN from .env)
```

`make help` lists everything:

| Command | Does |
|---|---|
| `make dev` | dev server with live reload, in Docker (`PORT=4400 make dev` for another port) |
| `make start` | build, then run the production server in Docker |
| `make lint` / `make test` / `make check` | ESLint / unit tests / type-check |
| `make lock` | regenerate `package-lock.json` with the same npm as CI |
| `make npm ARGS="install -D some-package"` | run any npm command in Docker, e.g. to add a dependency |
| `make docker-build TAG=1.0.0` | build a tagged Docker image, `myceevee:1.0.0` (`IMAGE=name` to change the name). `TAG` is required |
| `make docker-up` / `docker-down` / `docker-logs` | run with Docker Compose (state kept in `./data`; it builds its own image, separate from the tagged one) |
| `make clear-cache` | refetch the gist now: clears the running server's gist and photo caches (`PORT=...` or `URL=...` if not on 4321) |
| `make env` | create `.env` from `.env.example` if missing, with fresh secrets |
| `make clean` | remove build output (keeps `node_modules`, `.npm-cache`, `.env` and `./data`) |

## 1. Make the gist

Create a gist with up to two files:

| File | Contents |
|---|---|
| `resume.json` | the full CV, a [JSON Resume](https://jsonresume.org/schema) document (required) |
| `resume.onepage.json` | a hand-made one-page CV, same schema (optional, see below) |

For the one-page CV you have two options: keep a `resume.onepage.json` (shown exactly as written), or leave it out
and set `ONEPAGE_SECTIONS` so it is built from `resume.json` ([Choosing sections](#choosing-sections)). With neither,
the one-page CV is unavailable and `/admin` says why.

Schema problems show up as warnings in `/admin` and don't stop a CV from rendering.

**A secret gist is not private.** GitHub's "secret" gists are unlisted: anyone who has the id or URL can read them, and
myceevee reads yours anonymously. That is fine, since myceevee decides who sees what, but treat the id as semi-secret.
`GITHUB_TOKEN` doesn't change this; it only raises GitHub's API rate limit.

## 2. Configure

`make setup` already copied `.env.example` to `.env` (or do `cp .env.example .env` yourself). At minimum set:

- `GIST_ID`: the id of your gist, the long hash at the end of its address (`https://gist.github.com/you/<id>`).
  Pasting the whole URL works too. A username or profile page won't do, since it doesn't name one gist.
- `ADMIN_TOKEN` and `SESSION_SECRET`: generate with `openssl rand -hex 16` and `openssl rand -base64 32`.
- `PUBLIC_BASE_URL`: the public origin, e.g. `https://cv.example.com`. Short links you copy from `/admin` are built from it.

Restart after editing `.env`; it is only read at startup.

### Settings reference

| Setting | Default | Meaning |
|---|---|---|
| `GIST_ID` | required | gist id or URL |
| `GIST_FILE_FULL` | `resume.json` | gist file for the full CV |
| `GIST_FILE_ONEPAGE` | `resume.onepage.json` | gist file for a hand-made one-page CV |
| `ONEPAGE_SECTIONS` | unset | build the one-page CV from `resume.json` (see below). Unset and no one-page file = no one-page CV |
| `FULL_SECTIONS` | unset (everything) | trim the full CV the same way |
| `ADMIN_TOKEN` | required | admin login, 12+ characters |
| `SESSION_SECRET` | required | signs the session cookie, 32+ characters |
| `PUBLIC_BASE_URL` | `http://localhost:4321` | public origin; `https://` also marks the session cookie `Secure` |
| `HOME_REDIRECT_URL` | unset | where `/` sends visitors while nothing is public (http/https only) |
| `GIST_CACHE_TTL` | `1h` | how long the gist is cached |
| `AVATAR_CACHE_TTL` | `1d` | how long the Gravatar photo is cached |
| `DATABASE_PATH` | `./data/myceevee.db` (`/data/...` in Docker) | SQLite file holding visibility and short links |
| `TRUST_PROXY` | unset | set to `1` behind your own reverse proxy so client addresses come from `X-Forwarded-For` |
| `HOST`, `PORT` | `0.0.0.0` (all interfaces), `4321` (`8080` in the Docker image) | where the production server listens; set `HOST=127.0.0.1` to keep it reachable only from this machine |
| `HOST_PORT` | `4321` | Docker only: the port published on the host |
| `CONTAINER_USER` | `1000:1000` | Docker Compose only: the `uid:gid` the container runs as; `./data` must be writable by it (use your own, e.g. `1001:1001`) |
| `GITHUB_TOKEN` | unset | optional, raises GitHub's API rate limit |
| `GITHUB_API_URL`, `GRAVATAR_BASE_URL` | GitHub / Gravatar | overrides, mainly for tests or GitHub Enterprise |

Durations (`*_TTL`) take values like `90s`, `30m`, `6h`, `2d` (1 second to 30 days; a bare number means seconds). An
invalid value logs a warning and falls back to the default.

### Choosing sections

Each CV shows the sections listed in its setting, **in that order**. There is no built-in list: a one-page CV is
only derived from `resume.json` when you set `ONEPAGE_SECTIONS` yourself. `.env.example` ships a starting point:

```bash
ONEPAGE_SECTIONS=summary, work:3:summary, projects:2:summary, education, skills, languages
FULL_SECTIONS=      # unset = everything in resume.json
```

Options go after a section's name, separated by colons, in any order:

| Option | Effect |
|---|---|
| `work:3` | only the 3 most recent entries |
| `work:summary` | each entry shows its summary text only, without bullet highlights (works for `work`, `volunteer`, `projects`) |
| `work:3:summary` | both |

"Most recent" goes by end date: an entry with no end date counts as ongoing, undated entries rank last, and the entries
you keep stay in your file's order. An entry with no `summary` (or `description`) shows just its title and dates in
summary mode. To make a long one-page CV fit, lower the limits and/or add `:summary`.

Section names: `summary`, `work` (alias `experience`), `projects`, `education`, `skills`, `volunteer`, `certificates`,
`awards`, `publications`, `languages`, `interests`, `references`. Mistakes (unknown names or options) appear as
warnings in `/admin` and the rest of the list still applies. `ONEPAGE_SECTIONS` is ignored when the gist has a
`resume.onepage.json`; `FULL_SECTIONS` always applies to `resume.json`. `/admin` shows which source a CV is using.

## 3. Run

```bash
make docker-up      # Docker: state persists in ./data; set HOST_PORT in .env to change the host port
# or build and run it straight from the source tree
make start          # builds, then runs the production server in a Node container with .env loaded
```

Both need only Docker. If you ever run Node yourself, note that `npm start` and `npm run dev` do **not** read `.env`
(the `make` targets load it for you); use `node --env-file=.env dist/server/entry.mjs`.

For production put it behind HTTPS (Caddy, nginx, Traefik) and set `PUBLIC_BASE_URL` to the `https://` origin. If the
proxy sets `X-Forwarded-For`, set `TRUST_PROXY=1`; otherwise leave it unset.

### Prebuilt image

Every push to `main` and every `v*` tag publishes an image to GitHub's container registry (see
[Continuous integration](#continuous-integration)), so you can skip building it yourself:

```bash
docker run -d -p 8080:8080 --env-file .env -e DATABASE_PATH=/data/myceevee.db -v "$PWD/data:/data" \
  ghcr.io/<owner>/<repo>:latest
```

Use a version tag (`:1.2.3`) instead of `:latest` to pin a release. The `-e DATABASE_PATH` is needed because `.env`
points it at a path that only makes sense outside the container. New packages on ghcr.io start out private: if you want
others to pull the image without logging in, set the package to public once under the package's settings on GitHub.

The image listens on port 8080 (override with `-e PORT=...`) and runs as the non-root `node` user (UID 1000). To run it
as another user, add `--user <uid>:<gid>`; `/data` in the image is writable by any UID, but a bind-mounted host
directory must be writable by that user.

## Using the admin page

Open `/admin` and sign in with `ADMIN_TOKEN`.

- **Visibility:** a toggle per CV makes it public or private. Warnings, errors and "built from resume.json" notes
  appear under each CV.
- **New short link:** pick the CV, a lifetime (1, 3, 7 or 30 days, or custom hours) and an optional label. The link is
  shown **once**, because only a hash of it is stored. Copy it with the copy icon; the X to close the box unlocks once
  you have copied it. Active links are listed with their expiry and can be revoked.
- **Refresh from gist:** drops the gist and photo caches so edits show up immediately.

## Homepage and expired links

- **Something is public:** `/` shows a landing page with your name, photo and a button per public CV.
- **Nothing is public:** `/` redirects (302) to `HOME_REDIRECT_URL` if you set it, otherwise it shows the landing page
  with "To open my CV use the link that was shared with you. I will be happy to provide you access. Use the links
  below to find me."
- **Expired, revoked or unknown short link:** the landing page (HTTP 410) with a short "link has expired" note. It
  never redirects, and unknown links look the same as expired ones, so nothing reveals whether a link ever existed.
- The landing page's **Reach me at** row shows only your website (`basics.url`) and your GitHub and LinkedIn profiles.
  Email, phone and address are never shown there.

## Security

- **Admin login:**
  - `ADMIN_TOKEN` must be 12+ characters and `SESSION_SECRET` 32+, and neither may be a `change-me` placeholder.
    Otherwise the admin area stays locked and the login page tells you what to fix.
  - 5 wrong tokens from one address lock sign-in for that address for 15 minutes (correct logins don't count). Each
    failure adds a short delay and is logged, never with the token itself.
  - **Sign out ends all sessions** on every browser, so a copied cookie stops working. Sessions otherwise last 12 hours.
  - Admin pages send `X-Frame-Options: DENY` and `frame-ancestors 'none'`.
  - The session cookie is `HttpOnly`, `SameSite=Strict`, and `Secure` when `PUBLIC_BASE_URL` is `https://`.
- **Short links:** 10 random characters, stored only as a SHA-256 hash, and rate limited per address. Short-link and
  admin responses send `noindex`, `no-store` and `no-referrer`.
- **Gist content is untrusted:** only http(s) links are ever rendered, and everything is escaped. The server only makes
  requests to an address named in the gist, with one narrow exception: a `basics.image` on Gravatar, which it downloads
  for the PDF photo.
- `make clear-cache` logs in with your `ADMIN_TOKEN`, so only point it at your own server.

## Photo, caching and printing

- **Photo:** the header and landing page show a round photo. It uses `basics.image` if the gist sets it, otherwise the
  Gravatar for `basics.email`. Gravatar is fetched server-side and inlined into the page, so visitors never contact
  Gravatar and your email hash isn't exposed. No photo is shown if neither exists.
- **Caching:** the gist and photo are cached in memory (`GIST_CACHE_TTL`, `AVATAR_CACHE_TTL`), so a restart also clears
  them. If GitHub or Gravatar is down when a cache expires, the last good copy keeps being served. CVs themselves
  are rebuilt from the cached gist on every request.
- **Printing (A4):** the one-page CV is styled to fit one sheet and prints without the browser's own header and
  footer (date, URL, page number): it uses a zero page margin and pads its own content, which is the only way a web
  page can hide them. The full CV keeps a normal page margin so no page runs to the paper edge, which means browsers
  *may* print their header and footer on it; untick "Headers and footers" in the print dialog for a clean copy.
  Headings stay with their content and bullets aren't split across pages. The [PDF](#pdf-download) doesn't depend on
  print-dialog settings at all.

## PDF download

Each CV page shows a **Download PDF** button above the CV. The PDF is also a plain link you can share:

| Address | Available |
|---|---|
| `/cv/full.pdf`, `/cv/one-page.pdf` | while that CV is public (otherwise 404, like its page) |
| `/s/<token>.pdf` | while the short link is live; expired, revoked and unknown links all get the same 410 |

Access works exactly like the pages: the same visibility toggle, the same short-link lifetime and revocation, and the same
rate limit (60 requests a minute per address, shared with the page). Short-link PDFs are sent with `noindex`, `no-store`
and `no-referrer`. The file is named after you (`Your-Name-CV.pdf`, `Your-Name-CV-one-page.pdf`) and its links (email,
website, profiles, linked employers) are clickable.

- **Same content, own layout.** The PDF shows the same sections in the same order, honouring `ONEPAGE_SECTIONS`,
  `FULL_SECTIONS` and a hand-made `resume.onepage.json`. It is drawn by [pdfkit](https://pdfkit.org) (pure JavaScript: no
  browser and no system packages, so the image stays small and runs as a non-root user), not printed from the web page, so
  it resembles the web CV rather than copying it pixel for pixel. A change to the layout in `Resume.astro` needs the
  matching change in `src/lib/pdf.ts`.
- **One page means one page.** The one-page PDF shrinks its text step by step (down to about 8 pt) until it fits on one A4
  sheet. If it still doesn't fit, it runs onto a second page instead of getting smaller. Lower the limits in
  `ONEPAGE_SECTIONS` to shorten it. The full CV breaks onto more pages without splitting an entry.
- **Header on later pages.** Page 1 has the same header as the web CV (photo, name, and icons with handles). Pages 2 and
  later start with a slim header instead: your name, then your email, website and profile addresses written out as text
  (`linkedin.com/in/your-handle`, without `https://` or `www.`). A link can't be clicked on paper, so the address itself
  has to be readable; on screen each one is still a link. Location and phone aren't repeated. A CV with no name and no
  addresses has no such header.
- **Page numbers.** A PDF with more than one page shows "Page x of y" centred in the bottom margin. A single page has no
  counter, so a CV that fits on one sheet stays clean (and a one-page CV that had to spill onto a second sheet gets one).
- **Fonts.** PDFs use the built-in Helvetica, which covers Western European languages (accents, `ç`, `ñ`, `€`, curly
  quotes, dashes). Characters outside that set, such as Greek, Cyrillic, CJK or emoji, print as `?`.
- **Photo.** The same choice as the web CV: `basics.image` if set, otherwise the Gravatar for `basics.email`. Because the
  *server* has to download it for the PDF, an explicit `basics.image` is only used when it is a Gravatar address (https,
  `gravatar.com` or a subdomain, or the origin in `GRAVATAR_BASE_URL`). The server never fetches any other host named in the
  gist, so with a different host the web CV shows the photo but the PDF has none. Only PNG and JPEG can be embedded.
- **Caching.** Finished PDFs are kept in memory (the last 8, keyed by their content), so repeat downloads are instant and a
  changed gist is picked up straight away.

## Continuous integration

`.github/workflows/ci.yml` runs on pushes to `main`, on `v*` tags and on pull requests:

1. **Lint** (ESLint, plus `astro check` for types) and **Test** (the unit tests) run in parallel.
2. **Build container image** runs only if both pass:
   - **Pull requests** only build the image, which proves the Dockerfile works. Nothing is published.
   - **Pushes to `main`** publish `ghcr.io/<owner>/<repo>` tagged `latest` and `sha-<commit>`.
   - **Tags like `v1.2.3`** publish `1.2.3`, `1.2` and `sha-<commit>`. Cut a release with
     `git tag v1.2.3 && git push origin v1.2.3`.

Publishing uses the built-in `GITHUB_TOKEN`, so there are no secrets to configure. The workflow never contains
credentials, and the image name is derived from the repository at run time.

**Changing dependencies:** use `make npm ARGS="install -D some-package"` (and `make lock` to just refresh the
lockfile), never npm on your own machine. Every job installs with `npm ci`, and an older npm can write a lockfile that
the newer npm in CI rejects ("Missing: @emnapi/core ... from lock file"). The container uses the same npm as CI, so
the lockfile it writes always works there.

## Development

```
src/lib/         gist client, schema validation, sections, links/TTL, auth, rate limiting, avatar, landing profile,
                 pdf.ts (the PDF layout) and pdfResponse.ts (headers, caching)
src/components/  Resume.astro (the CV render), CvView, Landing, Logo, Icon, Unavailable
src/pages/       /, /cv/[key], /cv/[key].pdf, /s/[token], /s/[token].pdf, /admin/*
src/scripts/     client-side copy-to-clipboard helper
scripts/         refresh-server-cache.sh (used by `make clear-cache`)
public/          favicons
tests/           unit tests (`make test`)
```

Templates are the next step: `Resume.astro` takes a `variant` and an `order` prop, which are the seams for them.

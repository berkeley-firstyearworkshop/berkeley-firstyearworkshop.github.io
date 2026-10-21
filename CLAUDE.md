# First-Year Workshop site

The website for the Berkeley first-year PhD presentation series (Econ, ARE, and Haas): a schedule people sign up to present on, a mailing list, and a blog. Static pages on GitHub Pages, backed by a Google Apps Script web app and a Google Sheet.

**This repo is public.** Everything committed is readable by anyone, including this file. See Privacy below before committing anything.

## Files

| Path | What it is |
|---|---|
| `index.html` | Home: next session, mailing-list strip, schedule (first 3 weeks + "Show N more"), sign-up dialog with abstract, and latest posts |
| `about.html` | How it works + FAQ |
| `talk.html` | "Your talk": the personal-link page where a presenter adds or edits their abstract, moves to another week (the preferred option), or cancels |
| `blog/index.html` | Blog index: a front page for the latest 10 posts (lead, two with pictures, a list of four, a row of three), then square tiles |
| `blog/submit.html` | Guidelines + submission form with live word counter and in-browser image resizing |
| `blog/_template.html` | Post template (not published: Jekyll skips `_` files) |
| `blog/posts/*.html`, `blog/images/` | Generated posts and their images; `default-banner.svg` is the banner for a post without an image (the workshop's own, or one published with `--no-image`); `default-banner.png` is its copy for email |
| `blog/posts.json` | Every post's public fields. Source for the index, home page, and the Sunday email |
| `blog/blog.py` | `check`, `new`, `build`, `privacy`: see below |
| `site.css`, `blog/blog.css`, `site.js` | Shared styles (tokens incl. dark mode, masthead, footer, buttons, forms, post cards); blog styles; shared JS (`API_URL`, `?demo` mode, `countWords`, `wordCounter`, `api`, `fmtDeadline`) |
| `_partials/header.html`, `_partials/footer.html` | The shared masthead and footer |
| `apps-script/*.gs` | Copies of the Apps Script code (see Apps Script) |
| `.claude/skills/blog-post/` | The `/blog-post` skill: submission email → published post |
| `submissions/` | Local only, gitignored: raw submissions waiting to be processed |

## How pages are built

- Plain HTML, no build step on GitHub. `python3 blog/blog.py build` regenerates three things in place, between HTML comment markers:
  - `<!-- site-header -->` / `<!-- site-footer -->` on every page, from `_partials/` (with relative paths and the current-page underline filled in)
  - `<!-- posts -->` in `blog/index.html`
  - `<!-- latest-posts -->` in `index.html`
  It also rewrites `sitemap.xml` (every public page and post, for Google; `robots.txt` points to it). Edit the partial or `posts.json`, then run build. Never hand-edit inside the markers.
- The word-count rule (math and links excluded; pandoc's rule for `$…$`) exists three times: `countWords` in `site.js`, `countWords_` in `Code.gs`, `count_words` in `blog/blog.py`. Change all three together.
- Preview locally: `python3 -m http.server 8000` from the repo root, then open `http://localhost:8000/?demo`. `?demo` uses sample data and never touches the live backend.
- Python scripts must run on Python 3.8 (the system Anaconda) with Pillow.

## Design

Navy `#003262` and gold `#fdb515`, Source Serif 4 for headings (and post bodies), Public Sans for everything else. Every page shares the navy masthead (Schedule, Blog, About, gold "Sign up to present"; the current page underlined in gold; links drop to a second row below 820px) and the footer. Only the home page has the big navy hero; other pages open with a white title block over a navy rule. All colors are tokens in `site.css` with a dark-mode block. **No UC Berkeley, Haas, or Cal logos or seals, and no organizer names, anywhere.**

## Copy

American spelling (math, program, organizer, color), the Oxford comma ("Econ, ARE, and Haas"), and "write a blog post" rather than "write for the blog". Applies to pages, emails, and docs alike. Never apply it to an author's post text.

Page titles (what Google shows) are "<page> | UC Berkeley Economics First-Year Workshop"; the home page is just "UC Berkeley Economics First-Year Workshop". ARE and Haas stay in page text and descriptions.

## Privacy: the repo is public

Only what is published on the website may be committed.
- **Program on blog posts** (Econ/ARE/Haas/Other) is collected for the organizers but never published: not in posts, `posts.json`, file names, or commit messages. (The seminar schedule is different: it shows each presenter's department, as it always has.)
- **Email** appears on a post unless the author checked "Hide my email". A hidden email must not appear anywhere in the repo, including HTML comments.
- **Raw submissions** (the email, its text, the original image) stay in `submissions/` (gitignored) or outside the repo. Never `git add -A` or `git add .`; stage specific paths.
- **Images**: metadata (EXIF, GPS) is stripped by the browser on upload and again by `blog.py`.
- **Commit messages** for posts are `Add post: <title>`.
- **Pushing:** never push without the user's OK, with one exception. `/blog-post` may commit and push on its own only when the change is exactly one new post (`python3 blog/blog.py scope <slug>` passes), the user has approved any typo fixes or flags, and a separate agent following the `blog-push-check` skill has approved. Anything else: stop and ask.
- `python3 blog/blog.py privacy <submission>` checks the hidden email, `submissions/` and `posts.json` fields. Run it before every post commit.

## Blog content rules

- **Posts go up as written.** The prior is that there are no typos. Fix only very obvious misspellings (e.g. "ecnomics" → "economics"), list each one (original → fix) for the user to approve, and never change wording, grammar, style, punctuation, math, names, technical terms, or anything that could be deliberate.
- **Over 1,000 words** (math and links not counted): flag it and stop. Never trim.
- **One image per post, required** (the form won't submit without one): at the top, also used as its thumbnail and in the Sunday email. It can be decorative, as long as it relates to the topic. It must be the author's own photo or research figure, or licensed for reuse (Unsplash, Pexels, CC0/public domain, CC BY with credit). Not allowed: Google Images, news sites, figures from published journal articles, logos. If the source looks doubtful, flag it; publish with the default banner (`--no-image`) only if the user agrees.
- **Caption** is "Image: <credit>". For the author's own work, write "the author's own photo" or "the author's own figure".
- **Alt text**: look at the image and write one sentence saying what it shows.
- **Summary line** on the index is the post's first sentence without math, verbatim.
- Every post ends with the author's email (unless hidden), a "Write a blog post" box, and the disclaimer; all come from the template.

## Formatting (done by `blog.py new`)

- HTML-escape `& < >` everywhere, math included. A blank line starts a new paragraph (a submission with no blank lines gets one paragraph per line); single line breaks become `<br>`.
- `$$…$$` → `\[…\]` (its own block if it's alone in a paragraph), `$…$` → `\(…\)` by pandoc's rule, `\$` → a plain `$`. Other dollar signs stay as text, so "$500" is safe. MathJax 3.2.2 reads only `\( \)` and `\[ \]`.
- Links: authors write `As Acemoglu (2025) [link: www.xyz.com] shows`. A citation right before the tag ("Author (Year)", "Author and Author (Year)", "Author et al. (Year)", or "(Author, Year)") becomes the link; after anything else the tag becomes a small "[link]". Addresses without `https://` get it added; anything that isn't a web address (e.g. `javascript:`) stays as text. Bare `http(s)://` and `www.` addresses become links as they are.
- Images: resized to 1600px wide. Figures (few colors, or `--kind figure`) are padded to 16:9 on white so the site's 16:9 crop never cuts axis labels, saved as PNG (JPEG q88 if over 500 KB). Photos are center-cropped to 16:9 (the same crop the site shows, and the Sunday email needs it because email can't crop) and saved as JPEG q80. `default-banner.png` is a copy of the SVG banner for email, which can't show SVG.

## Processing a submission

Use the `/blog-post` skill. In short: `blog.py check` → review (word count, image, math and dollar signs, links, obvious typos, alt text) → `blog.py new` → screenshots → `blog.py privacy` → `blog.py scope` → a separate agent runs the `blog-push-check` skill → push only on its `APPROVE` (and only if nothing needed the user's decision); otherwise ask.

## Apps Script

The files in `apps-script/` are copies. What runs is the Apps Script project bound to the bookings Google Sheet. After editing a copy, paste it into that project and save. Changes to `Code.gs` or `Blog.gs` also need **Deploy > Manage deployments > Edit > New version**. Rerun `setupTriggers` after changing any trigger setting.

- `Code.gs`: bookings; the abstract field and its deadline; the talk page's endpoints (look up, save abstract, move, cancel), each checked against a signed link built from the booking's `booking_id` (never the email), so links survive a move; request routing. Config: term dates, `ABSTRACT_WORDS`, `ABSTRACTS_FROM` (abstracts are optional for sessions before this date: no deadline, no reminder).
- `Mailing.gs`: every email and trigger. Config: `REMINDER`, `ANNOUNCE`, `ABSTRACT_REMINDER` (derived from `ANNOUNCE`), `BLOG_DIGEST`, `ADMIN_EMAIL`. Run `remindNextSessionAbstracts` by hand to chase the next session's missing abstracts when the automatic reminder has already passed (after the deadline, it asks for them before the announcement instead).
- `Blog.gs`: blog submissions (an image is required). Each one emails the organizers the submission and the author a thank-you with a copy of what they sent (`sendBlogThanks_` in `Mailing.gs`). `BLOG_SHEET_ID` is set in the live project only; keep it `''` in the repo copy.

Abstract timing for a Wednesday 3pm talk:

| When | Days before | What |
|---|---|---|
| Monday 9am | 9 | Reminder to presenters without an abstract, cc `ADMIN_EMAIL` |
| Wednesday 10am | 7 | Abstract deadline (24h before the announcement); "Skip for now" disappears after this |
| Thursday 10am | 6 | Weekly announcement to the mailing list, abstracts included |
| Sunday 7pm | weekly | "New on the blog" email, skipped when there are no new posts. Every post gets the same-size card, in a random order for each subscriber, so none is featured |

Apps Script can't run locally. The `.gs` files are plain JavaScript, so their syntax and pure helpers (`countWords_`, `newPosts_`, date math with a stubbed `Utilities`) can be checked by loading them in headless Chrome. `testEmails` (run in the Apps Script editor) sends one of every email to the account running it.

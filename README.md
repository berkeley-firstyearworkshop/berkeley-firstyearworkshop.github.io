# First-Year Workshop site

```
index.html              home: next session, mailing list, schedule, sign-ups, and latest blog posts
about.html              how it works + FAQ
talk.html               personal-link page: add an abstract, move to another week, or cancel
blog/                   blog index, submit form, posts, images, posts.json, blog.py
site.css, site.js       shared styles and scripts (API_URL lives in site.js)
_partials/              shared header and footer, stamped into every page by blog.py build
apps-script/Code.gs     bookings, abstracts, and request routing (Google Apps Script)
apps-script/Mailing.gs  mailing list and every email
apps-script/Blog.gs     blog submissions
CLAUDE.md               how the site works and the rules for blog posts
```

The files in `apps-script/` are a copy for reference. What actually runs is the code in the Sheet's Apps Script project, so after editing them here, paste the changes into Apps Script and save. Changes to `Code.gs` or `Blog.gs` also need **Deploy > Manage deployments > Edit > New version**.

A static site (GitHub Pages) that reads and writes presentation slots in a Google Sheet via Apps Script.

## 1. Backend (Google Sheet + Apps Script)

1. Create a new Google Sheet (or use the existing one; the script adds its own `Bookings` tab).
2. **Extensions > Apps Script**. Replace the default code with `apps-script/Code.gs`.
3. Edit the config block at the top: `START_DATE`, `END_DATE`, `SKIP_DATES`, `ABSTRACTS_FROM` (the first session that needs an abstract), and optionally `ALLOWED_EMAIL_DOMAIN = 'berkeley.edu'`.
4. **Deploy > New deployment > Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Authorize when prompted and copy the web app URL (ends in `/exec`).

After editing the script later: **Deploy > Manage deployments > Edit > Version: New version**. The URL stays the same.

## 2. Emails (mailing list, reminders, weekly announcement, blog email)

1. In Apps Script, click **+ > Script**, name it `Mailing`, and paste in `apps-script/Mailing.gs`.
2. Edit its config: `SITE_URL`, `ROOM`, `WEB_APP_URL` (your `/exec` URL), and `REMINDER` / `ANNOUNCE` / `BLOG_DIGEST` (days before the session and hour).
3. Save, pick `setupTriggers` in the function dropdown and click **Run**. Accept the new permissions (sending email, and reading the site's `blog/posts.json` for the Sunday blog email).
4. Pick `testEmails` and click **Run**. It sends you a sample of every email for the next session: booking confirmations (with and without an abstract), mailing-list welcome, presenter reminder, abstract reminder, announcement, and blog email.
5. **Deploy > Manage deployments > Edit > Version: New version**.

Run `setupTriggers` again whenever you change `REMINDER`, `ANNOUNCE`, or `BLOG_DIGEST`. Emails come from whichever account ran `setupTriggers`. A personal Gmail can send to about 100 recipients a day, which is plenty for one announcement and one blog email a week.

Subscribers are in the `Subscribers` tab. To remove someone, set their status to `unsubscribed`.

To chase missing abstracts by hand (for example when the automatic Monday reminder has already passed), pick `remindNextSessionAbstracts` and click **Run**. It emails each presenter at the next session that needs abstracts, and who hasn't added one, their personal link, copied to `ADMIN_EMAIL`.

## 3. Blog submissions

1. Create a new, blank Google Sheet called "Blog_Submissions". Copy its ID: the long string in its URL between `/d/` and `/edit`.
2. In Apps Script, click **+ > Script**, name it `Blog`, paste in `apps-script/Blog.gs`, and set `BLOG_SHEET_ID` to that ID. (Keep it `''` in the copy in this repo.)
3. Save and deploy a new version. The script adds a `Submissions` tab with headers on the first submission.

Each submission is checked, recorded in that Sheet (details only, not the text or image) and emailed to `ADMIN_EMAIL` with the image attached. To publish one, save the email as a `.eml` file (Gmail: ⋮ > Download message) in `submissions/` and run `/blog-post submissions/<file>.eml` in Claude Code. See CLAUDE.md for the rules.

## 4. Front end (GitHub Pages)

1. `site.js` holds `const API_URL = '...'`, the Apps Script web app URL.
2. **Settings > Pages > Deploy from a branch > main / (root)**.
3. The site is at `https://berkeley-firstyearworkshop.github.io/`.

Add `?demo` to any page's address (or leave `API_URL` empty) to preview it with sample data without touching the live backend. To preview locally, run `python3 -m http.server 8000` in this folder and open `http://localhost:8000/?demo`.

After changing `_partials/` or `blog/posts.json`, run `python3 blog/blog.py build`. It also rewrites `sitemap.xml`.

**Google:** in Search Console, open **Sitemaps** and submit `sitemap.xml` once. Google rereads it on its own, so new posts get found without resubmitting.

## Managing bookings

- **Presenters can add their title or abstract, move, or cancel themselves** from the link in their confirmation and reminder emails ("Your talk" page). You get an email each time.
- **Cancel by hand:** delete the row in the `Bookings` tab. Before the line-up email, the talks after it move up when that email goes out; after it, the slot stays open and the next sign-up takes it.
- **Move someone by hand:** change their `slot_id` (format `YYYY-MM-DD_HHMM`, e.g. `2026-10-14_1530`). Only `slot_id` is used for matching; the date and time columns are just for reading. Leave `booking_id` alone: their personal link depends on it.
- **Abstracts** are in the `abstract` column. You can edit them there; editing the Sheet clears the cached schedule, so the site shows the change straight away.
- **Emails** stay in the sheet and are never sent to the page.
- People sign up for a week, not a time. Talks run in booking order, and until the Thursday line-up email a cancel or move on the talk page moves the later talks up. The line-up email fixes the times; emails before it give only the date.
- **Changing the slot times:** edit `SLOT_TIMES` in `Code.gs`, then run `fitBookingsToSlots` once. It moves every week's bookings onto the new times, keeping their order, and logs any week with more talks than slots.
- Each person can hold one upcoming slot at a time (`MAX_UPCOMING_PER_EMAIL`).

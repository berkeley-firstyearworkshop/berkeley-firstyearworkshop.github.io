---
name: blog-post
description: Turn a First-Year Workshop blog submission (the "BLOG SUBMISSION v1" email, saved as .eml or .txt in submissions/, or pasted into the chat) into a published post on this site. Use when the user runs /blog-post or asks to process, add, or publish a blog submission.
---

# Publish a blog submission

Follow the rules in CLAUDE.md (Privacy, Blog content rules, Formatting). The repo is public: nothing from the submission except what appears on the published post may be committed.

## 1. Get the submission

- The argument is a path, usually `submissions/<something>.eml` (Gmail: ⋮ > Download message) or a `.txt` holding the email body with the image saved beside it.
- If the user pasted the email instead, save it to `submissions/<YYYY-MM-DD>-<short-title>.txt` (gitignored). If the email names an attached image, ask the user to save it in `submissions/` under that filename.
- Never copy anything from `submissions/` into the site by hand.

## 2. Check it

Run `python3 blog/blog.py check <file>` and read the whole output. Then look at:

- **Word count.** Over 1,000 (math excluded): stop. Tell the user the count and that the author needs to shorten it. Never trim.
- **Image.** Every submission should have one (the form requires it); if there's none, flag it. Open the copy `check` saved and look at it. Compare it with its credit and the image rules in CLAUDE.md. Flag anything doubtful (looks like a journal figure, stock photo with no license, a logo, a news photo); don't decide for the user. Decide `--kind`: `figure` for charts and diagrams (padded, never cropped), `photo` for photos. Write one sentence of alt text describing what the image shows, and the caption credit (use "the author's own photo/figure" for the author's own work).
- **Math and dollar signs.** Check every math span is really math and every "kept as text" dollar sign is really money. If one is wrong, the fix is to put `\$` before a dollar sign that should be literal.
- **Links.** Check each link in the `check` output: the right words are linked (a citation like "Acemoglu (2025)", otherwise a small "[link]") and the address looks like what the text refers to. A tag that isn't a web address stays as text; flag it.
- **Typos.** Assume there are none. Only very obvious misspellings qualify (e.g. "ecnomics"), in the text or the title. Never change wording, grammar, style, punctuation, math, names, or technical terms.
- **Hide email** and **program**: note them; neither the program nor a hidden email may appear in the post.

## 3. Build it

- If there are typo fixes or `\$` escapes, copy the post text (between `=== POST TEXT ===` and `=== END ===`) to `submissions/<name>.edited.txt`, make only those changes, and show them with `diff`.
- Run, adding only the options needed:
  ```
  python3 blog/blog.py new <file> --alt "<alt text>" --kind figure|photo \
      [--credit "<caption credit>"] [--text submissions/<name>.edited.txt] [--title "<fixed title>"] [--no-image]
  ```
  This writes the post, its image, and the `posts.json` entry, then rebuilds the blog index, the home page's latest posts, and the shared header/footer.

## 4. Look at it

- Serve the site: `python3 -m http.server 8000` from the repo root (in the background), then take headless Chrome screenshots of the new post at 1280 and 390 wide, and of the blog index. Save them outside the repo (the session scratchpad, or `/tmp`):
  ```
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
    --virtual-time-budget=10000 --window-size=1280,2600 --screenshot=<out>.png http://localhost:8000/blog/posts/<slug>.html
  ```
- Check: math rendered (no raw `\(`), the image crop keeps what matters (if a photo's crop cuts the subject, rebuild with `--kind figure`), the caption and contact line are right, nothing overflows on the phone width.
- Stop the server when done.

## 5. Privacy check

Run `python3 blog/blog.py privacy <file>`. If it fails, fix the cause before anything else.

## 6. Push on your own, or ask

You may commit and push **without asking only if all of these hold**:
- the user has approved every change to the author's text or title (typo fixes, `\$` escapes); if there were any, ask first;
- nothing was flagged: no doubtful image source, no ambiguous dollar sign or link, nothing you were unsure about;
- `python3 blog/blog.py scope <slug>` passes (the uncommitted changes are exactly this one post);
- a **separate agent** approves. Launch one with the Agent tool (general-purpose), giving it the slug, the submission path, and the approved changes (or "none"), and telling it to follow `.claude/skills/blog-push-check/SKILL.md` and end with `APPROVE` or `BLOCK: …`. Don't pass it your own conclusions; it checks from scratch.

If the reviewer says `APPROVE`: stage exactly the files `scope` listed (never `git add -A` or `git add .`), commit, and push:
```
git add <each file scope listed>
git commit -m "Add post: <title>"
git push
```
Check `git status` shows nothing from `submissions/` was staged.

If anything fails or the reviewer says `BLOCK`, don't commit: tell the user what failed and ask.

## 7. Report

Tell the user, briefly:
- the title, author, word count, and live address (`https://berkeley-firstyearworkshop.github.io/blog/posts/<slug>.html`)
- every change made to the author's text or title (original → fix), or "none"
- the caption, alt text, and image handling, and anything flagged about the image
- the privacy and scope results, the reviewer's verdict, and whether you pushed
- for the Blog_Submissions Sheet: set this row's status to `published` and paste the live address into `post_url`

New posts go out in the Sunday 7pm email automatically once pushed.

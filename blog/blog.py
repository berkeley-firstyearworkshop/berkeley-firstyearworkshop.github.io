#!/usr/bin/env python3
"""Blog posts and the generated parts of the site.

    python3 blog/blog.py check   submissions/x.eml      parse a submission and report; changes nothing in the site
    python3 blog/blog.py new     submissions/x.eml ...  make the post, add it to posts.json, then build
    python3 blog/blog.py build                          blog index, home "From the blog", shared header/footer
    python3 blog/blog.py privacy submissions/x.eml      check nothing private is about to be committed
    python3 blog/blog.py scope   <slug>                 check the uncommitted changes are exactly one new post

The rules these follow are in CLAUDE.md. Needs Python 3.8+ and Pillow.
"""
import argparse
import datetime as dt
import email
import email.policy
import html
import io
import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BLOG = ROOT / 'blog'
IMAGES = BLOG / 'images'
POSTS_DIR = BLOG / 'posts'
POSTS_JSON = BLOG / 'posts.json'
TEMPLATE = BLOG / '_template.html'
PARTIALS = ROOT / '_partials'
DEFAULT_BANNER = 'default-banner.svg'
SITE_URL = 'https://berkeley-firstyearworkshop.github.io/'

WORD_LIMIT = 1000
IMAGE_WIDTH = 1600
FRONT_PAGE = 10  # posts laid out on the index front page; older ones become tiles
# The only fields posts.json may hold: everything in it is public on GitHub.
PUBLIC_FIELDS = {'slug', 'title', 'author', 'date', 'image', 'image_alt', 'credit', 'standfirst', 'email'}

# Math is not counted. Inline $...$ follows pandoc's rule (opening $ before a non-space,
# closing $ after a non-space and not before a digit), so "$5 and $10" stays as words.
# Keep in step with countWords in site.js and countWords_ in apps-script/Code.gs.
DISPLAY = re.compile(r'\$\$[\s\S]*?\$\$')
ESCAPED = re.compile(r'\\\$')
INLINE = re.compile(r'\$(?=[^\s$])(?:\\.|[^$\\])*?[^\s$\\]\$(?!\d)')
TOKEN = re.compile(r'(\$\$[\s\S]*?\$\$)|(\\\$)|(\$(?=[^\s$])(?:\\.|[^$\\])*?[^\s$\\]\$(?!\d))')
# Links: "As Acemoglu (2025) [link: www.xyz.com] shows" links the citation just before the tag;
# a tag after anything else becomes a small "[link]". Bare web addresses are linked as they are.
LINK_TAG = re.compile(r'\[(?i:link):[^\]]*\]')
BARE_URL = re.compile(r'(?:https?://|www\.)\S+', re.I)
CITATION = (r"[A-Z][\w'’-]+(?:(?:,| and| &) [A-Z][\w'’-]+)*(?: et al\.)? \(\d{4}[a-z]?\)"  # Acemoglu (2025)
            r"|\([A-Z][^()\n]*?\d{4}[a-z]?\)")                                             # (Acemoglu, 2025)
LINKS = re.compile(r'(?:(?P<cite>' + CITATION + r')[ \t]*)?\[(?i:link):\s*(?P<url>[^\]\s]+)\s*\]'
                   r'|(?P<bare>(?:https?://|www\.)[^\s<>"\]]+)')


def count_words(text):
    """Math and links are not counted. Keep in step with countWords in site.js and countWords_ in apps-script/Code.gs."""
    text = BARE_URL.sub(' ', LINK_TAG.sub(' ', text))
    return len(INLINE.sub(' ', ESCAPED.sub('', DISPLAY.sub(' ', text))).split())


def esc(s):
    return html.escape(str(s), quote=True)


# ---------- Reading a submission ----------

FIELDS = {
    'Submitted': 'submitted', 'Name': 'name', 'Email': 'email', 'Hide email': 'hide_email',
    'Program': 'program', 'Title': 'title', 'Image': 'image', 'Image credit': 'credit', 'Word count': 'word_count',
}
BLOCK = re.compile(r'=== BLOG SUBMISSION v1 ===\n(.*?)\n=== POST TEXT ===\n(.*?)\n=== END ===', re.S)


def read_submission(path):
    """(fields, text, image) from a saved notification email (.eml) or its body saved as .txt.

    image is (bytes, filename) or None. For a .txt, the image is looked for next to it by the
    filename the email names."""
    path = Path(path)
    image = None
    if path.suffix.lower() == '.eml':
        msg = email.message_from_bytes(path.read_bytes(), policy=email.policy.default)
        body = msg.get_body(preferencelist=('plain',))
        content = body.get_content() if body else ''
        for part in msg.iter_attachments():
            if part.get_content_maintype() == 'image':
                image = (part.get_payload(decode=True), part.get_filename() or 'image')
                break
    else:
        content = path.read_text(encoding='utf-8')
    m = BLOCK.search(content.replace('\r\n', '\n'))
    if not m:
        sys.exit(f'{path}: no "=== BLOG SUBMISSION v1 ===" block found.')
    fields = {}
    for line in m.group(1).splitlines():
        key, sep, value = line.partition(':')
        if sep and key.strip() in FIELDS:
            fields[FIELDS[key.strip()]] = value.strip()
    missing = [k for k in ('name', 'email', 'hide_email', 'title') if not fields.get(k)]
    if missing:
        sys.exit(f'{path}: the submission is missing {", ".join(missing)}.')
    if image is None and path.suffix.lower() != '.eml':
        name = re.sub(r'\s*\(attached\)\s*$', '', fields.get('image', ''))
        if name and name.lower() != 'none' and (path.parent / name).exists():
            image = ((path.parent / name).read_bytes(), name)
    return fields, m.group(2).strip('\n'), image


def hides_email(fields):
    return fields.get('hide_email', '').strip().lower().startswith('y')


# ---------- Post text to HTML ----------

def paragraphs(text):
    # Line breaks inside $$...$$ never split a paragraph.
    text = DISPLAY.sub(lambda m: m.group(0).replace('\n', '\x00'), text.replace('\r\n', '\n').strip())
    # Blank lines separate paragraphs. A submission with none uses one paragraph per line.
    blocks = re.split(r'\n[ \t]*\n', text) if re.search(r'\n[ \t]*\n', text) else text.split('\n')
    return [b.strip().replace('\x00', '\n') for b in blocks if b.strip()]


def web_address(url, tagged=False):
    """An http(s) address for an href, or None. www.xyz.com gets https:// in front, and so does any
    host-like address inside a [link: ...] tag (nber.org/papers/w123)."""
    url = url.rstrip('.,;:!?)\'"')
    if url.lower().startswith('www.') or (tagged and re.match(r'[\w-]+(\.[\w-]+)+(/\S*)?$', url)):
        url = 'https://' + url
    return url if re.match(r'https?://[^\s<>"]+$', url, re.I) else None


def prose_html(s):
    def plain(t):
        return html.escape(t, quote=False).replace('\n', '<br>\n')
    out, pos = [], 0
    for m in LINKS.finditer(s):
        if m.group('bare'):
            text = m.group('bare').rstrip('.,;:!?)\'"')
            url, end = web_address(text), m.start() + len(text)
            label = html.escape(text, quote=False)
        else:
            url, end = web_address(m.group('url'), tagged=True), m.end()
            label = html.escape(m.group('cite'), quote=False) if m.group('cite') else '[link]'
        if not url:
            continue
        out.append(plain(s[pos:m.start()]))
        out.append(f'<a href="{esc(url)}">{label}</a>')
        pos = end
    out.append(plain(s[pos:]))
    return ''.join(out)


def inline_html(s):
    """Escapes text and math alike; $$..$$ becomes \\[..\\], $..$ becomes \\(..\\), \\$ a plain dollar sign."""
    out, pos = [], 0
    for m in TOKEN.finditer(s):
        out.append(prose_html(s[pos:m.start()]))
        if m.group(1):
            out.append('\\[' + html.escape(m.group(1)[2:-2].strip(), quote=False) + '\\]')
        elif m.group(2):
            out.append('$')
        else:
            out.append('\\(' + html.escape(m.group(3)[1:-1], quote=False) + '\\)')
        pos = m.end()
    out.append(prose_html(s[pos:]))
    return ''.join(out)


def body_html(text):
    out = []
    for block in paragraphs(text):
        if DISPLAY.fullmatch(block):
            out.append(f'<div class="eq">{inline_html(block)}</div>')
        else:
            out.append(f'<p>{inline_html(block)}</p>')
    return '\n'.join(out)


def first_sentence(text):
    """The first sentence without math, used as the summary line on the index."""
    for block in paragraphs(text):
        if DISPLAY.fullmatch(block):
            continue
        for sentence in re.split(r'(?<=[.!?])\s+(?=[A-Z0-9"\'(])', ' '.join(block.split())):
            if '$' not in sentence:
                return sentence.strip()
    return ''


def math_report(text):
    """Every math span and every dollar sign kept as text, with context, for a human to check."""
    spans, kept = [], []
    pos = 0
    for m in TOKEN.finditer(text):
        dollars = [i for i, c in enumerate(text[pos:m.start()]) if c == '$']
        kept += [pos + i for i in dollars]
        if m.group(1):
            spans.append(('display', m.group(1)))
        elif m.group(3):
            spans.append(('inline', m.group(3)))
        pos = m.end()
    kept += [pos + i for i, c in enumerate(text[pos:]) if c == '$']
    context = [' '.join(text[max(0, i - 30):i + 30].split()) for i in kept]
    return spans, context


# ---------- Images ----------

def save_image(data, slug, kind='auto'):
    """Resize to 1600px wide and strip all metadata. Figures are padded to 16:9 on white so the
    16:9 crop on the site never cuts axis labels; photos are left for that crop."""
    from PIL import Image, ImageOps
    im = Image.open(io.BytesIO(data))
    im = ImageOps.exif_transpose(im)
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA')
        flat = Image.new('RGB', im.size, 'white')
        flat.paste(im, mask=im.split()[-1])
        im = flat
    else:
        im = im.convert('RGB')
    if kind == 'auto':
        small = im.copy()
        small.thumbnail((400, 400))
        kind = 'figure' if small.getcolors(maxcolors=4096) is not None else 'photo'
    if kind == 'figure':
        w, h = im.size
        if abs(w / h - 16 / 9) > 0.01:
            W, H = (w, round(w * 9 / 16)) if w / h > 16 / 9 else (round(h * 16 / 9), h)
            canvas = Image.new('RGB', (W, H), 'white')
            canvas.paste(im, ((W - w) // 2, (H - h) // 2))
            im = canvas
    if im.width > IMAGE_WIDTH:
        im = im.resize((IMAGE_WIDTH, round(im.height * IMAGE_WIDTH / im.width)), Image.LANCZOS)
    im.info = {}
    IMAGES.mkdir(exist_ok=True)
    for old in IMAGES.glob(f'{slug}.*'):
        old.unlink()
    path = IMAGES / f'{slug}.png'
    if kind == 'figure':
        im.save(path, optimize=True)
        if path.stat().st_size <= 500_000:
            return path.name, kind
        path.unlink()
    path = IMAGES / f'{slug}.jpg'
    im.save(path, quality=88 if kind == 'figure' else 80, optimize=True, progressive=True)
    return path.name, kind


# ---------- Posts ----------

def slugify(title, date):
    ascii_title = unicodedata.normalize('NFKD', title).encode('ascii', 'ignore').decode().lower()
    words = re.sub(r'[^a-z0-9\s-]', '', ascii_title).split()
    slug = f'{date}-' + '-'.join(words[:6]).strip('-')
    candidate, n = slug, 2
    while (POSTS_DIR / f'{candidate}.html').exists():
        candidate, n = f'{slug}-{n}', n + 1
    return candidate


def long_date(iso):
    d = dt.date.fromisoformat(iso)
    return f'{d.day} {d:%B} {d.year}'


def short_date(iso):
    d = dt.date.fromisoformat(iso)
    return f'{d.day} {d:%B}'


def load_posts():
    posts = json.loads(POSTS_JSON.read_text(encoding='utf-8')) if POSTS_JSON.exists() else []
    return sorted(posts, key=lambda p: p['date'], reverse=True)


def save_posts(posts):
    for p in posts:
        extra = set(p) - PUBLIC_FIELDS
        if extra:
            sys.exit(f'posts.json would get non-public fields {sorted(extra)}; refusing.')
    POSTS_JSON.write_text(json.dumps(sorted(posts, key=lambda p: p['date'], reverse=True), indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


def obfuscate(address):
    return ''.join(f'&#{ord(c)};' for c in address)


def post_page(meta, body):
    if meta['image']:
        image_src, alt = f'../images/{meta["image"]}', meta['image_alt']
        caption = f'<figcaption>Image: {esc(meta["credit"])}</figcaption>' if meta['credit'] else ''
    else:
        image_src, alt, caption = f'../images/{DEFAULT_BANNER}', '', ''
    contact = ''
    if meta['email']:
        enc = obfuscate(meta['email'])
        contact = f'<p class="contact">Get in touch with the author: <a href="&#109;&#97;&#105;&#108;&#116;&#111;&#58;{enc}">{enc}</a></p>'
    values = {
        'title': esc(meta['title']), 'standfirst': esc(meta['standfirst']), 'author': esc(meta['author']),
        'date': meta['date'], 'date_long': long_date(meta['date']), 'image_src': image_src, 'image_alt': esc(alt),
        'caption': caption, 'body': body, 'contact': contact,
    }
    # One pass, so text inside a value is never treated as another placeholder.
    return re.sub(r'\{\{(\w+)\}\}', lambda m: values[m.group(1)], TEMPLATE.read_text(encoding='utf-8'))


# ---------- Generated parts of pages ----------

def story(p, variant, prefix):
    """One post card. prefix is the path from the page to blog/ ('' on the index, 'blog/' on home)."""
    image = f'{prefix}images/{p["image"] or DEFAULT_BANNER}'
    tag = 'h2' if variant == 'lead' else 'h3'
    standfirst = f'\n<p class="standfirst">{esc(p["standfirst"])}</p>' if variant == 'lead' and p.get('standfirst') else ''
    return (f'<article class="story story-{variant}">\n<a href="{prefix}posts/{p["slug"]}.html">\n'
            f'<img src="{image}" alt="" loading="lazy" width="1600" height="900">\n'
            f'<div>\n<{tag}>{esc(p["title"])}</{tag}>{standfirst}\n'
            f'<p class="meta"><span class="author">{esc(p["author"])}</span> · <time datetime="{p["date"]}">{long_date(p["date"])}</time></p>\n'
            f'</div>\n</a>\n</article>\n')


def tile(p):
    return (f'<li class="tile"><a href="posts/{p["slug"]}.html">\n'
            f'<img src="images/{p["image"] or DEFAULT_BANNER}" alt="" loading="lazy" width="1600" height="900">\n'
            f'<div class="tile-text"><h3>{esc(p["title"])}</h3>'
            f'<p class="meta">{esc(p["author"])} · <time datetime="{p["date"]}">{short_date(p["date"])}</time></p></div>\n'
            f'</a></li>\n')


def index_block(posts):
    """Front page for the latest 10: a lead, two picture stories, a list of four, then a row of three.
    Older posts become square tiles."""
    if not posts:
        return '<p class="empty">No posts yet. <a href="submit.html">Write the first one</a>.</p>\n'
    front, older = posts[:FRONT_PAGE], posts[FRONT_PAGE:]
    lead, pics, texts, row = front[0], front[1:3], front[3:7], front[7:10]
    cols = [f'<div class="col">\n{story(lead, "lead", "")}</div>\n']
    if pics:
        cols.append('<div class="col">\n' + ''.join(story(p, 'pic', '') for p in pics) + '</div>\n')
    if texts:
        cols.append('<div class="col col-list">\n<h2 class="col-label">More recent posts</h2>\n'
                    + ''.join(story(p, 'text', '') for p in texts) + '</div>\n')
    out = f'<section class="front cols-{len(cols)}" aria-label="Latest posts">\n' + ''.join(cols) + '</section>\n'
    if row:
        out += '<section class="front-row" aria-label="More posts">\n' + ''.join(story(p, 'row', '') for p in row) + '</section>\n'
    if older:
        out += ('<section class="earlier" aria-labelledby="earlier-h">\n<h2 id="earlier-h">Earlier posts</h2>\n<ol class="tiles">\n'
                + ''.join(tile(p) for p in older) + '</ol>\n</section>\n')
    return out


def home_block(posts):
    if not posts:
        return '<p class="muted">No posts yet. <a href="blog/submit.html">Write the first one</a>.</p>\n'
    cols = [f'<div class="col">\n{story(posts[0], "lead", "blog/")}</div>\n']
    if posts[1:3]:
        cols.append('<div class="col">\n' + ''.join(story(p, 'pic', 'blog/') for p in posts[1:3]) + '</div>\n')
    return f'<div class="front home-front cols-{len(cols)}">\n' + ''.join(cols) + '</div>\n'


def replace_block(text, name, content, page):
    start, end = f'<!-- {name} -->', f'<!-- /{name} -->'
    i, j = text.find(start), text.find(end)
    if i < 0 or j < i:
        sys.exit(f'{page.relative_to(ROOT)}: missing the {start} ... {end} markers.')
    return text[:i + len(start)] + '\n' + content.rstrip('\n') + '\n' + text[j:]


def site_pages():
    pages = [ROOT / 'index.html', ROOT / 'about.html', ROOT / 'talk.html', BLOG / 'index.html', BLOG / 'submit.html']
    return pages + sorted(POSTS_DIR.glob('*.html'))


def partial(name, page):
    rel = page.relative_to(ROOT)
    root = './' if len(rel.parts) == 1 else '../' * (len(rel.parts) - 1)
    section = 'blog' if rel.parts[0] == 'blog' else 'about' if rel.name == 'about.html' else ''
    exact = rel.as_posix() in ('blog/index.html', 'about.html')
    current = f' aria-current="{"page" if exact else "true"}"'
    text = (PARTIALS / f'{name}.html').read_text(encoding='utf-8')
    return (text.replace('{root}', root)
            .replace('{current_blog}', current if section == 'blog' else '')
            .replace('{current_about}', current if section == 'about' else ''))


def sitemap(posts):
    """For Google: every public page and post. talk.html is left out (personal links only)."""
    urls = [(SITE_URL, ''), (SITE_URL + 'about.html', ''), (SITE_URL + 'blog/', posts[0]['date'] if posts else ''),
            (SITE_URL + 'blog/submit.html', '')]
    urls += [(f'{SITE_URL}blog/posts/{p["slug"]}.html', p['date']) for p in posts]
    rows = [f'  <url><loc>{esc(url)}</loc>' + (f'<lastmod>{lastmod}</lastmod>' if lastmod else '') + '</url>' for url, lastmod in urls]
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            + '\n'.join(rows) + '\n</urlset>\n')


def build():
    posts = load_posts()
    (ROOT / 'sitemap.xml').write_text(sitemap(posts), encoding='utf-8')
    for page, block, content in [(BLOG / 'index.html', 'posts', index_block(posts)),
                                 (ROOT / 'index.html', 'latest-posts', home_block(posts))]:
        page.write_text(replace_block(page.read_text(encoding='utf-8'), block, content, page), encoding='utf-8')
    for page in site_pages():
        text = page.read_text(encoding='utf-8')
        for name in ('header', 'footer'):
            text = replace_block(text, f'site-{name}', partial(name, page), page)
        page.write_text(text, encoding='utf-8')
    print(f'Built: {len(posts)} posts; index, home, sitemap.xml, and {len(site_pages())} page headers/footers updated.')


# ---------- Commands ----------

def cmd_check(a):
    fields, text, image = read_submission(a.submission)
    words = count_words(text)
    print(f'Title:      {fields["title"]}')
    print(f'Author:     {fields["name"]}')
    print(f'Email:      {fields["email"]} ({"HIDDEN on the post" if hides_email(fields) else "shown on the post"})')
    print(f'Program:    {fields.get("program", "")} (never published)')
    print(f'Words:      {words} of {WORD_LIMIT}' + ('  <-- OVER THE LIMIT: flag it, do not trim' if words > WORD_LIMIT else ''))
    if fields.get('word_count') and fields['word_count'] != str(words):
        print(f'            (the form counted {fields["word_count"]})')
    if image:
        from PIL import Image
        im = Image.open(io.BytesIO(image[0]))
        print(f'Image:      {image[1]}, {im.width} x {im.height}, {len(image[0]) // 1024} KB')
        # Saved beside the submission (in the gitignored submissions/ folder) so it can be looked at.
        copy = Path(a.submission).parent / Path(image[1]).name
        if not copy.exists():
            copy.write_bytes(image[0])
        print(f'            saved for viewing as {copy}')
        print(f'Credit:     {fields.get("credit") or "MISSING"}')
    else:
        print('Image:      none (default banner)' + (f' -- the email names "{fields["image"]}" but it was not found' if fields.get('image', 'none').lower() != 'none' else ''))
    print(f'Summary:    {first_sentence(text)}')
    spans, kept = math_report(text)
    print(f'\nMath ({len(spans)}):')
    for i, (kind, s) in enumerate(spans, 1):
        print(f'  {i:2}. {kind:7} {" ".join(s.split())}')
    print(f'\nDollar signs kept as text ({len(kept)}):')
    for c in kept:
        print(f'  ... {c} ...')
    links = [m for m in LINKS.finditer(text)]
    print(f'\nLinks ({len(links)}):')
    for m in links:
        target = m.group('bare') or m.group('url')
        shown = m.group('bare') or m.group('cite') or '[link]'
        print(f'  {shown}  ->  {web_address(target, tagged=not m.group("bare")) or "NOT A WEB ADDRESS: left as text"}')
    print('\nText:\n' + text)


def cmd_new(a):
    fields, text, image = read_submission(a.submission)
    if a.text:
        text = Path(a.text).read_text(encoding='utf-8').strip('\n')
    words = count_words(text)
    if words > WORD_LIMIT:
        sys.exit(f'{words} words: over the {WORD_LIMIT}-word limit. Flag it to the organizers; never trim.')
    date = a.date or dt.date.today().isoformat()
    title = a.title or fields['title']
    slug = slugify(title, date)
    if a.image:
        image = (Path(a.image).read_bytes(), Path(a.image).name)
    image_name, kind = '', ''
    if image and not a.no_image:
        image_name, kind = save_image(image[0], slug, a.kind)
    meta = {
        'slug': slug, 'title': title, 'author': fields['name'], 'date': date,
        'image': image_name, 'image_alt': a.alt or '', 'credit': (a.credit if a.credit is not None else fields.get('credit', '')) if image_name else '',
        'standfirst': a.standfirst or first_sentence(text),
        'email': '' if hides_email(fields) else fields['email'],
    }
    POSTS_DIR.mkdir(exist_ok=True)
    (POSTS_DIR / f'{slug}.html').write_text(post_page(meta, body_html(text)), encoding='utf-8')
    posts = [p for p in load_posts() if p['slug'] != slug]
    save_posts([meta] + posts)
    build()
    print(f'\nNew post: blog/posts/{slug}.html ({words} words' + (f', {kind} image blog/images/{image_name}' if image_name else ', default banner') + ')')
    print(f'Live address once pushed: {SITE_URL}blog/posts/{slug}.html')


def git_files():
    out = subprocess.run(['git', 'ls-files', '--cached', '--others', '--exclude-standard'], cwd=ROOT, capture_output=True, text=True, check=True)
    return [ROOT / f for f in out.stdout.splitlines()]


def cmd_privacy(a):
    fields, _, _ = read_submission(a.submission)
    problems = []
    tracked = subprocess.run(['git', 'ls-files', 'submissions'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    if tracked:
        problems.append(f'files under submissions/ are tracked by git: {tracked}')
    if hides_email(fields):
        address = fields['email'].lower()
        for f in git_files():
            if f.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.pdf'):
                continue
            try:
                body = f.read_text(encoding='utf-8').lower()
            except (UnicodeDecodeError, FileNotFoundError, IsADirectoryError):
                continue
            if address in body or obfuscate(address) in body:
                problems.append(f'{f.relative_to(ROOT)} contains the hidden email address')
    for p in load_posts():
        extra = set(p) - PUBLIC_FIELDS
        if extra:
            problems.append(f'posts.json entry {p["slug"]} has non-public fields {sorted(extra)}')
    if problems:
        print('PRIVACY CHECK FAILED:\n  ' + '\n  '.join(problems))
        sys.exit(1)
    print('Privacy check passed: no hidden email in the repo, submissions/ untracked, posts.json holds public fields only.')


def git(*args):
    return subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout


def head_text(path):
    r = subprocess.run(['git', 'show', f'HEAD:{path}'], cwd=ROOT, capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def outside_block(text, name):
    start, end = f'<!-- {name} -->', f'<!-- /{name} -->'
    i, j = text.find(start), text.find(end)
    return text if i < 0 or j < i else text[:i] + text[j:]


def cmd_scope(a):
    """Passes only if the working tree differs from the last commit by exactly one new post.
    This is the precondition for /blog-post pushing without asking."""
    slug, problems = a.slug, []
    post, images = f'blog/posts/{slug}.html', {f'blog/images/{slug}.png', f'blog/images/{slug}.jpg'}
    generated = {'blog/posts.json', 'blog/index.html', 'index.html', 'sitemap.xml'}
    changed = []
    for line in git('status', '--porcelain', '--untracked-files=all').splitlines():
        status, path = line[:2].strip(), line[3:]
        if path.endswith('.DS_Store'):
            continue  # macOS folder metadata: never staged
        changed.append(path)
        if path == post or path in images:
            if status not in ('??', 'A'):
                problems.append(f'{path} should be a new file (git status {status})')
        elif path in generated:
            if status not in ('M', 'MM'):
                problems.append(f'{path} should only be modified (git status {status})')
        else:
            problems.append(f'unexpected change: {status} {path}')
    if post not in changed:
        problems.append(f'{post} is not a new file')

    key = lambda p: json.dumps(p, sort_keys=True)
    old, new = json.loads(head_text('blog/posts.json') or '[]'), load_posts()
    added = [p for p in new if key(p) not in {key(q) for q in old}]
    removed = [p for p in old if key(p) not in {key(q) for q in new}]
    if removed or len(added) != 1 or added[0]['slug'] != slug:
        problems.append(f'posts.json should gain exactly the entry for {slug} (added {[p["slug"] for p in added]}, '
                        f'changed or removed {[p["slug"] for p in removed]})')
    for path, block in [('blog/index.html', 'posts'), ('index.html', 'latest-posts')]:
        before = head_text(path)
        if before is not None and outside_block(before, block) != outside_block((ROOT / path).read_text(encoding='utf-8'), block):
            problems.append(f'{path} changed outside its generated <!-- {block} --> block')
    locs = lambda t: set(re.findall(r'<loc>([^<]+)</loc>', t or ''))
    before, after = locs(head_text('sitemap.xml')), locs((ROOT / 'sitemap.xml').read_text(encoding='utf-8'))
    if before - after or after - before != {f'{SITE_URL}{post}'}:
        problems.append(f'sitemap.xml should only gain {SITE_URL}{post}')

    if problems:
        print('SCOPE CHECK FAILED (do not push without asking):\n  ' + '\n  '.join(problems))
        sys.exit(1)
    print(f'Scope check passed: exactly one new post ({slug}). Files to stage:\n  ' + '\n  '.join(sorted(changed)))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    c = sub.add_parser('check', help='parse a submission and report; changes nothing in the site')
    c.add_argument('submission')
    n = sub.add_parser('new', help='make the post, add it to posts.json, then build')
    n.add_argument('submission')
    n.add_argument('--text', help='file with the post text after approved fixes (obvious typos, \\$ for literal dollar signs)')
    n.add_argument('--title', help='title after an approved typo fix')
    n.add_argument('--image', help='image file, if not attached to the .eml or next to the .txt')
    n.add_argument('--no-image', action='store_true', help='use the default banner (for example, an image that breaks the rules)')
    n.add_argument('--kind', choices=['auto', 'photo', 'figure'], default='auto', help='figures are padded to 16:9, photos are not')
    n.add_argument('--alt', help='alt text describing the image')
    n.add_argument('--credit', help='caption credit, if the submitted wording needs tidying (e.g. "the author\'s own figure")')
    n.add_argument('--standfirst', help='summary line for the index (default: the first sentence without math)')
    n.add_argument('--date', help='publication date, YYYY-MM-DD (default: today)')
    sub.add_parser('build', help='blog index, home "From the blog", shared header/footer')
    p = sub.add_parser('privacy', help='check nothing private is about to be committed')
    p.add_argument('submission')
    sc = sub.add_parser('scope', help='check the uncommitted changes are exactly one new post')
    sc.add_argument('slug')
    a = ap.parse_args()
    {'check': cmd_check, 'new': cmd_new, 'build': lambda _: build(), 'privacy': cmd_privacy, 'scope': cmd_scope}[a.cmd](a)


if __name__ == '__main__':
    main()

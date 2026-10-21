// Blog submissions from blog/submit.html. Each one is checked, recorded (without its text or image)
// in the "Blog_Submissions" Sheet, and emailed to the organizers with the image attached.
// The email body is a fixed block that blog/blog.py and the /blog-post skill read, so keep its format.

// ===== Blog config: edit these =====
const BLOG_SHEET_ID = '';                   // ID of the "Blog_Submissions" Google Sheet: the long string in its URL
const BLOG_WORDS = 1000;                    // post limit; math isn't counted
const BLOG_MAX_IMAGE_CHARS = 12000000;      // base64 size cap, about 9 MB; the page resizes images well below this
// ===================================

const BLOG_HEADERS = ['submitted_at', 'name', 'email', 'hide_email', 'program', 'title', 'word_count', 'image_file', 'image_credit', 'status', 'post_url'];
const BLOG_IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function submitPost_(d) {
  const c = {
    name: str_(d.name, 100),
    email: str_(d.email, 120).toLowerCase(),
    hideEmail: d.hideEmail === true,
    program: str_(d.program, 60),
    title: str_(d.title, 200),
    text: String(d.text == null ? '' : d.text).replace(/\r\n?/g, '\n').trim().slice(0, 40000),
    credit: str_(d.credit, 300),
  };
  const img = d.image && d.image.data ? { name: str_(d.image.name, 120), type: str_(d.image.type, 40), data: String(d.image.data) } : null;
  const words = countWords_(c.text); // Code.gs

  if (!c.name) return { ok: false, error: 'Add your name.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) return { ok: false, error: 'Enter a valid email address.' };
  if (!c.program) return { ok: false, error: 'Choose your program.' };
  if (!c.title) return { ok: false, error: 'Add a title.' };
  if (!c.text) return { ok: false, error: 'Add the text of your post.' };
  if (words > BLOG_WORDS) return { ok: false, error: 'Your post is ' + words + ' words. Shorten it to ' + BLOG_WORDS + ' or fewer.' };
  if (!img) return { ok: false, error: 'Add an image for the top of your post.' };
  if (!BLOG_IMAGE_TYPES[img.type]) return { ok: false, error: 'Use a JPG, PNG, or WebP image.' };
  if (img.data.length > BLOG_MAX_IMAGE_CHARS) return { ok: false, error: 'That image is too large. Choose a smaller one.' };
  if (!c.credit) return { ok: false, error: 'Add where the image comes from.' };
  if (d.agree !== true) return { ok: false, error: "Check the box to confirm you've read the guidelines and rules." };

  let blob;
  const base = img.name.replace(/\.[^.]*$/, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'image';
  try {
    blob = Utilities.newBlob(Utilities.base64Decode(img.data), img.type, base + '.' + BLOG_IMAGE_TYPES[img.type]);
  } catch (err) {
    return { ok: false, error: "The image couldn't be read. Try a JPG or PNG." };
  }

  let sheetUrl = '';
  if (BLOG_SHEET_ID) {
    const sheet = getBlogSheet_();
    sheet.appendRow([new Date(), safe_(c.name), c.email, c.hideEmail ? 'yes' : 'no', safe_(c.program), safe_(c.title), words,
      blob.getName(), safe_(c.credit), 'received', '']);
    sheetUrl = sheet.getParent().getUrl();
  } else {
    console.warn('BLOG_SHEET_ID is empty: this submission was emailed but not recorded in a Sheet.');
  }

  const block = [
    '=== BLOG SUBMISSION v1 ===',
    'Submitted: ' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm') + ' PT',
    'Name: ' + c.name,
    'Email: ' + c.email,
    'Hide email: ' + (c.hideEmail ? 'yes' : 'no'),
    'Program: ' + c.program,
    'Title: ' + c.title,
    'Image: ' + blob.getName() + ' (attached)',
    'Image credit: ' + c.credit,
    'Word count: ' + words,
    '=== POST TEXT ===',
    c.text,
    '=== END ===',
  ].join('\n');
  const body = block + '\n\n' +
    'To publish: save this email as a .eml file (or the text above as a .txt with the image beside it) in submissions/, then run /blog-post on it.\n' +
    (sheetUrl ? 'Blog_Submissions sheet: ' + sheetUrl + '\n' : '');
  const msg = {
    to: ADMIN_EMAIL || Session.getEffectiveUser().getEmail(),
    replyTo: c.email,
    subject: 'Blog submission: ' + c.title + ' (' + c.name + ')',
    body: body,
    attachments: [blob],
  };
  send_(msg); // Mailing.gs
  trySend_(() => sendBlogThanks_(c, words, blob.getName())); // Mailing.gs
  return { ok: true };
}

function getBlogSheet_() {
  const ss = SpreadsheetApp.openById(BLOG_SHEET_ID);
  let sheet = ss.getSheetByName('Submissions');
  if (!sheet) {
    sheet = ss.getSheets()[0];
    if (sheet.getLastRow() > 0) sheet = ss.insertSheet('Submissions');
    else sheet.setName('Submissions');
    sheet.appendRow(BLOG_HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

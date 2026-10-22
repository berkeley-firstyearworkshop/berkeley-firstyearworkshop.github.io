// ===== Config: edit these =====
const START_DATE = '2026-10-21';            // first Wednesday (YYYY-MM-DD)
const END_DATE   = '2026-12-02';            // last Wednesday
const SKIP_DATES = ['2026-11-11', '2026-11-25']; // weeks with no session (Veterans Day, Thanksgiving)
const SLOT_TIMES = ['15:10', '15:25', '15:40'];   // Berkeley time; after changing these, run fitBookingsToSlots
const SESSION = { start: '15:00', end: '16:00' };  // calendar invites and emails; the spare time is for changeovers
const ALLOWED_EMAIL_DOMAIN = '';            // e.g. 'berkeley.edu' to restrict sign-ups; '' allows any
const MAX_UPCOMING_PER_EMAIL = 1;           // max future slots one person can hold; 0 = no limit
const ABSTRACT_WORDS = 100;                 // abstract limit; math isn't counted
const ABSTRACTS_FROM = '2026-10-28';        // abstracts are required from this session on; optional before it
const TZ = 'America/Los_Angeles';
const SHEET_NAME = 'Bookings';
// ==============================

const HEADERS = ['slot_id', 'date', 'time', 'name', 'email', 'department', 'title', 'type', 'booked_at', 'link', 'link_type', 'abstract', 'abstract_at', 'booking_id'];

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'unsubscribe') return unsubscribePage_(p);
  if (p.action === 'talk') return json_(talkInfo_(p));
  return json_({ ok: true, now: Date.now(), sessions: cachedSessions_() });
}

// The schedule is cached for up to 10 minutes so most visits skip reading the Sheet.
// It is cleared whenever someone books or the Sheet is edited by hand.
const CACHE_KEY = 'sessions';
function cachedSessions_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(CACHE_KEY);
  if (hit) return JSON.parse(hit);
  const sessions = buildSessions_();
  cache.put(CACHE_KEY, JSON.stringify(sessions), 600);
  return sessions;
}
function clearCache_() { CacheService.getScriptCache().remove(CACHE_KEY); }
function onEdit() { clearCache_(); }

// People sign up for a session, not a time. Each new talk takes the earliest free slot, and until the line-up
// email fixes the times, later talks move up when one is canceled or moved (see closeUp_).
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (err) {
    return json_({ ok: false, error: 'The sign-up sheet is busy. Try again in a few seconds.' });
  }
  try {
    let d;
    try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Invalid request.' }); }
    if (d.action === 'subscribe') return json_(subscribe_(d)); // mailing list, see Mailing.gs
    if (d.action === 'post') return json_(submitPost_(d));     // blog submissions, see Blog.gs
    if (d.action === 'abstract') return json_(saveAbstract_(d)); // the talk page, see below
    if (d.action === 'title') return json_(saveTitle_(d));
    if (d.action === 'move') return json_(moveTalk_(d));
    if (d.action === 'cancel') return json_(cancelTalk_(d));

    const clean = {
      date: str_(d.date, 10),
      name: str_(d.name, 100),
      email: str_(d.email, 120).toLowerCase(),
      department: str_(d.department, 60),
      title: str_(d.title, 200),
      type: str_(d.type, 10),
      link: str_(d.link, 500),
      linkType: str_(d.linkType, 40),
      abstract: str_(d.abstract, 2000),
      skipAbstract: d.skipAbstract === true,
    };
    if (!clean.link) clean.linkType = '';
    clean.id = newBookingId_();

    const error = validate_(clean);
    if (error) return json_({ ok: false, error: error });

    const sheet = getSheet_();
    const rows = readBookings_(sheet);

    if (MAX_UPCOMING_PER_EMAIL > 0) {
      const today = today_();
      const held = rows.filter(r => r.email === clean.email && r.slot_id.slice(0, 10) >= today).length;
      if (held >= MAX_UPCOMING_PER_EMAIL) {
        return json_({ ok: false, error: 'You already have an upcoming slot. Email the organizers to swap.' });
      }
    }

    const taken = new Set(rows.map(r => r.slot_id));
    const time = SLOT_TIMES.find(t => !taken.has(slotId_(clean.date, t)));
    if (!time) {
      return json_({ ok: false, error: 'This session just filled up. Pick another week.', sessions: buildSessions_() });
    }

    const id = slotId_(clean.date, time);
    sheet.appendRow([
      id, clean.date, time,
      safe_(clean.name), clean.email, safe_(clean.department), safe_(clean.title), clean.type, new Date(), clean.link, safe_(clean.linkType),
      safe_(clean.abstract), clean.abstract ? new Date() : '', clean.id,
    ]);
    clearCache_();
    let joinedList = false;
    trySend_(() => { joinedList = addPresenterToList_(clean.email, clean.name); }); // see Mailing.gs
    trySend_(() => sendBookingConfirmation_(clean, time, joinedList));
    trySend_(() => sendAdminNotice_(clean, time));
    return json_({ ok: true, slot: { id: id, time: time }, timesFixed: timesFixed_(clean.date), sessions: buildSessions_() });
  } finally {
    lock.releaseLock();
  }
}

function validate_(c) {
  if (sessionDates_().indexOf(c.date) === -1) return 'That session does not exist.';
  if (c.date < today_()) return 'That session has already happened.';
  if (!c.name) return 'Add your name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) return 'Enter a valid email address.';
  if (ALLOWED_EMAIL_DOMAIN && !c.email.endsWith('@' + ALLOWED_EMAIL_DOMAIN)) {
    return 'Use your @' + ALLOWED_EMAIL_DOMAIN + ' email address.';
  }
  if (!c.department) return 'Choose your department.';
  if (!c.title) return 'Add a working title.';
  if (c.type !== 'paper' && c.type !== 'idea') return 'Choose paper or early-stage idea.';
  if (c.link && !isLink_(c.link)) return 'Enter a full link, starting with https://';
  if (c.link && !c.linkType) return 'Say what the link is.';
  const words = countWords_(c.abstract);
  if (words > ABSTRACT_WORDS) return 'Keep the abstract to ' + ABSTRACT_WORDS + ' words (it has ' + words + ').';
  if (!c.abstract && abstractRequired_(c.date)) {
    if (!c.skipAbstract) return 'Add an abstract, or choose to add it later.';
    if (Date.now() >= abstractDeadline_(c.date)) return 'The abstract deadline for this session has passed, so add your abstract now.';
  }
  return null;
}

function buildSessions_() {
  const booked = {};
  readBookings_(getSheet_()).forEach(r => {
    booked[r.slot_id] = { name: r.name, department: r.department, title: r.title, type: r.type, link: r.link, linkType: r.linkType, abstract: r.abstract };
  });
  // Emails stay in the sheet and are never returned to the page.
  return sessionDates_().map(date => ({
    date: date,
    abstractRequired: abstractRequired_(date),
    abstractDeadline: abstractDeadline_(date),
    timesFixed: timesFixed_(date),
    lineupAt: lineupAt_(date),
    slots: SLOT_TIMES.map(t => {
      const id = slotId_(date, t);
      return { id: id, time: t, booking: booked[id] || null };
    }),
  }));
}

function sessionDates_() {
  const skip = new Set(SKIP_DATES);
  const out = [];
  const d = new Date(START_DATE + 'T12:00:00Z');
  const end = new Date(END_DATE + 'T12:00:00Z');
  while (d <= end) {
    const iso = d.toISOString().slice(0, 10);
    if (!skip.has(iso)) out.push(iso);
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

// Only slot_id is used to match bookings, so the readable date/time columns can be edited freely.
function readBookings_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, HEADERS.length).getValues()
    .map((r, i) => ({
      row: i + 2,
      slot_id: String(r[0]).trim(),
      name: String(r[3]),
      email: String(r[4]).trim().toLowerCase(),
      department: String(r[5]),
      title: String(r[6]),
      type: String(r[7]),
      link: isLink_(String(r[9]).trim()) ? String(r[9]).trim() : '',
      linkType: String(r[10]),
      abstract: String(r[11]).trim(),
      id: String(r[13]).trim(),
    }))
    .filter(r => r.slot_id);
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastColumn() < HEADERS.length) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]); // adds new columns to an older sheet
  }
  return sheet;
}

// Moves the week's talks up into any gap, keeping their order. Returns how many didn't fit.
function closeUp_(date) {
  const sheet = getSheet_();
  const talks = readBookings_(sheet).filter(r => r.slot_id.slice(0, 10) === date).sort((a, b) => (a.slot_id < b.slot_id ? -1 : 1));
  talks.forEach((r, i) => {
    const t = SLOT_TIMES[i];
    if (t && slotId_(date, t) !== r.slot_id) sheet.getRange(r.row, 1, 1, 3).setValues([[slotId_(date, t), date, t]]);
  });
  return Math.max(0, talks.length - SLOT_TIMES.length);
}

// Run by hand after changing SLOT_TIMES: puts each week's bookings on the new times, in the same order.
// Weeks already on the new times are left alone, so running it again changes nothing.
function fitBookingsToSlots() {
  const times = new Set(SLOT_TIMES);
  const rows = readBookings_(getSheet_());
  sessionDates_().forEach(date => {
    if (rows.every(r => r.slot_id.slice(0, 10) !== date || times.has(timeOf_(r.slot_id)))) return;
    const extra = closeUp_(date);
    Logger.log(extra ? `${date}: ${extra} more talk(s) than slots, left on their old times. Move them by hand.` : `${date}: moved to the new times.`);
  });
  clearCache_();
}

// ----- Your talk: the personal page (talk.html) where presenters add a title or abstract, move, or cancel -----

const abstractRequired_ = date => date >= ABSTRACTS_FROM;
const atHour_ = (day, hour) => Utilities.parseDate(day + ' ' + String(hour).padStart(2, '0') + ':00', TZ, 'yyyy-MM-dd HH:mm').getTime();

// Abstracts, and titles still TBD, are due 24 hours before the weekly announcement (ANNOUNCE in Mailing.gs), in ms.
const abstractDeadline_ = date => atHour_(shiftDate_(date, -(ANNOUNCE.daysBefore + 1)), ANNOUNCE.hour);
const lineupAt_ = date => atHour_(shiftDate_(date, -ANNOUNCE.daysBefore), ANNOUNCE.hour);
// Times are fixed once the line-up has gone to the mailing list. The trigger runs within the hour after
// ANNOUNCE.hour, and a week nobody booked sends nothing, so after that hour the clock decides.
const timesFixed_ = date => !!PropertiesService.getScriptProperties().getProperty('announce_' + date) || Date.now() >= lineupAt_(date) + 36e5;

const LINK_ERROR = 'This link is not valid. Use the link in your confirmation email, or email the organizers.';
const newBookingId_ = () => Utilities.getUuid().replace(/-/g, '').slice(0, 12);
// The link carries the booking's ID and a signature, never the presenter's email, so it can't be used for
// anyone else's talk. The ID stays with the booking when it moves, so earlier links keep working.
const talkToken_ = id => token_('talk|' + id); // token_ is in Mailing.gs
const talkLink_ = id => SITE_URL + 'talk.html?b=' + id + '&t=' + talkToken_(id);
const timeOf_ = slotId => slotId.slice(11, 13) + ':' + slotId.slice(13, 15);

// Bookings made before IDs existed get one the first time a link to them is needed.
function bookingId_(b) {
  if (!b.id) {
    b.id = newBookingId_();
    getSheet_().getRange(b.row, HEADERS.indexOf('booking_id') + 1).setValue(b.id);
  }
  return b.id;
}

function bookingForLink_(p) {
  const id = str_(p.b, 20);
  if (!id || String(p.t || '') !== talkToken_(id)) return null;
  return readBookings_(getSheet_()).find(r => r.id === id) || null;
}

function talkInfo_(p) {
  const b = bookingForLink_(p);
  if (!b) return { ok: false, error: LINK_ERROR };
  const date = b.slot_id.slice(0, 10);
  const today = today_();
  // Every other upcoming week with an open slot, and the slot a move there would get.
  const moves = date < today ? [] : buildSessions_()
    .filter(s => s.date >= today && s.date !== date)
    .map(s => ({ date: s.date, slot: s.slots.find(x => !x.booking), timesFixed: s.timesFixed }))
    .filter(s => s.slot)
    .map(s => ({ date: s.date, time: s.slot.time, timesFixed: s.timesFixed }));
  return {
    ok: true, date: date, time: timeOf_(b.slot_id), title: titleText_(b.title), tbd: isTbd_(b.title), name: b.name,
    abstract: b.abstract, abstractRequired: abstractRequired_(date), deadline: abstractDeadline_(date),
    timesFixed: timesFixed_(date), lineupAt: lineupAt_(date), past: date < today, moves: moves,
  };
}

function saveAbstract_(d) {
  const b = bookingForLink_(d);
  if (!b) return { ok: false, error: LINK_ERROR };
  if (b.slot_id.slice(0, 10) < today_()) return { ok: false, error: 'This talk has already happened.' };
  const abstract = str_(d.abstract, 2000);
  if (!abstract) return { ok: false, error: 'Add your abstract.' };
  const words = countWords_(abstract);
  if (words > ABSTRACT_WORDS) return { ok: false, error: 'Keep the abstract to ' + ABSTRACT_WORDS + ' words (it has ' + words + ').' };
  getSheet_().getRange(b.row, HEADERS.indexOf('abstract') + 1, 1, 2).setValues([[safe_(abstract), new Date()]]);
  clearCache_();
  trySend_(() => sendAbstractNotice_(b, abstract)); // see Mailing.gs
  return { ok: true };
}

function saveTitle_(d) {
  const b = bookingForLink_(d);
  if (!b) return { ok: false, error: LINK_ERROR };
  if (b.slot_id.slice(0, 10) < today_()) return { ok: false, error: 'This talk has already happened.' };
  const title = str_(d.title, 200);
  if (!title || isTbd_(title)) return { ok: false, error: 'Add your title.' };
  getSheet_().getRange(b.row, HEADERS.indexOf('title') + 1).setValue(safe_(title));
  clearCache_();
  trySend_(() => sendTitleNotice_(b, title)); // see Mailing.gs
  return { ok: true };
}

// Moves the booking (same row, same ID) to the first open slot of another week.
function moveTalk_(d) {
  const b = bookingForLink_(d);
  if (!b) return { ok: false, error: LINK_ERROR };
  const from = b.slot_id.slice(0, 10);
  const to = str_(d.date, 10);
  const today = today_();
  if (from < today) return { ok: false, error: 'This talk has already happened.' };
  if (sessionDates_().indexOf(to) === -1 || to < today || to === from) return { ok: false, error: 'Choose another upcoming week.' };
  if (!b.abstract && abstractRequired_(to) && Date.now() >= abstractDeadline_(to)) {
    return { ok: false, error: "That week's abstract deadline has passed, so add your abstract before moving." };
  }
  const sheet = getSheet_();
  const taken = new Set(readBookings_(sheet).map(r => r.slot_id));
  const time = SLOT_TIMES.find(t => !taken.has(slotId_(to, t)));
  if (!time) return { ok: false, error: 'That week just filled up. Choose another.' };
  sheet.getRange(b.row, 1, 1, 3).setValues([[slotId_(to, time), to, time]]);
  if (!timesFixed_(from)) closeUp_(from);
  clearCache_();
  trySend_(() => sendMoveNotice_(Object.assign({}, b, { slot_id: slotId_(to, time) }), b.slot_id)); // see Mailing.gs
  return { ok: true, date: to, time: time, timesFixed: timesFixed_(to) };
}

// Deletes the booking's row, as canceling by hand does; the emails keep the details.
function cancelTalk_(d) {
  const b = bookingForLink_(d);
  if (!b) return { ok: false, error: LINK_ERROR };
  const date = b.slot_id.slice(0, 10);
  if (date < today_()) return { ok: false, error: 'This talk has already happened.' };
  getSheet_().deleteRow(b.row);
  if (!timesFixed_(date)) closeUp_(date);
  clearCache_();
  trySend_(() => sendCancelNotice_(b)); // see Mailing.gs
  return { ok: true };
}

// Math and links are not counted: [link: ...] tags, web addresses, $$...$$, and inline $...$, which
// follows pandoc's rule (opening $ before a non-space, closing $ after a non-space and not before a digit),
// so "$5 and $10" stays as words. Keep in step with countWords in site.js and count_words in blog/blog.py.
function countWords_(text) {
  const prose = String(text || '')
    .replace(/\[link:[^\]]*\]/gi, ' ')
    .replace(/(?:https?:\/\/|www\.)\S+/gi, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\\\$/g, '')
    .replace(/\$(?=[^\s$])(?:\\.|[^$\\])*?[^\s$\\]\$(?!\d)/g, ' ');
  const words = prose.match(/\S+/g);
  return words ? words.length : 0;
}

const slotId_ = (date, t) => date + '_' + t.replace(':', '');
const today_ = () => Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
const shiftDate_ = (iso, days) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
// Only http(s): the link becomes an href on the page and in emails.
const isLink_ = u => /^https?:\/\/\S+$/i.test(u);
const str_ = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
// Stop user input being interpreted as a spreadsheet formula.
const safe_ = v => (/^[=+\-@]/.test(v) ? "'" + v : v);

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

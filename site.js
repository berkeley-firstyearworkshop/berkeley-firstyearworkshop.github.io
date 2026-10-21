// Shared by every page that talks to the Apps Script backend.

// Apps Script web app URL. Leave empty to preview every page with sample data.
const API_URL = 'https://script.google.com/macros/s/AKfycbyKSG1n4KbB1eWgaFmqymYPwRdcB93aVjRPO6l-MA5kJSoXVKEyKrJgSS6Xpp-sKFKEKg/exec';
// Adding ?demo to a page's address previews it with sample data, without touching the live backend.
const DEMO = !API_URL || new URLSearchParams(location.search).has('demo');
const TZ = 'America/Los_Angeles';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Math and links are not counted: [link: ...] tags, web addresses, $$...$$, and inline $...$, which
// follows pandoc's rule (opening $ before a non-space, closing $ after a non-space and not before a digit),
// so "$5 and $10" stays as words. Keep in step with countWords_ in apps-script/Code.gs and count_words in blog/blog.py.
function countWords(text) {
  const prose = String(text)
    .replace(/\[link:[^\]]*\]/gi, ' ')
    .replace(/(?:https?:\/\/|www\.)\S+/gi, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\\\$/g, '')
    .replace(/\$(?=[^\s$])(?:\\.|[^$\\])*?[^\s$\\]\$(?!\d)/g, ' ');
  const words = prose.match(/\S+/g);
  return words ? words.length : 0;
}

// Keeps "N / limit words" under a text box up to date. Returns a function that reports whether the text fits.
function wordCounter(field, counter, limit) {
  const out = counter.querySelector('.count');
  const fmt = n => n.toLocaleString('en-US');
  const update = () => {
    const n = countWords(field.value);
    const over = n > limit;
    out.textContent = `${fmt(n)} / ${fmt(limit)} words` + (over ? ` · ${fmt(n - limit)} over` : '');
    counter.classList.toggle('over', over);
    return !over;
  };
  field.addEventListener('input', update);
  update();
  return update;
}

async function api(payload) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids a CORS preflight, which Apps Script can't answer
    body: JSON.stringify(payload),
  });
  return res.json();
}

// Date parts in Berkeley time, built from formatToParts because Safari's default formats differ.
function partsLA(ms, opts) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts }).formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
  return p;
}
// "Wednesday 14 October, 10am"
function fmtDeadline(ms) {
  const p = partsLA(ms, { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' });
  const h = Number(p.hour) % 24;
  return `${p.weekday} ${p.day} ${p.month}, ${h % 12 || 12}${p.minute !== '00' ? ':' + p.minute : ''}${h < 12 ? 'am' : 'pm'}`;
}

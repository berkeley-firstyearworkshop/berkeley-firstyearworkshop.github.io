// Mailing list, confirmations, presenter and abstract reminders, the weekly announcement, and the weekly blog email.
// Emails are sent from the Google account that runs setupTriggers().

// ===== Email config: edit these =====
const SEMINAR_NAME = 'First-Year Workshop';
const FROM_NAME = 'Berkeley Econ First-Year Workshop';   // sender name shown in inboxes
const SITE_URL = 'https://berkeley-firstyearworkshop.github.io/';
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyKSG1n4KbB1eWgaFmqymYPwRdcB93aVjRPO6l-MA5kJSoXVKEyKrJgSS6Xpp-sKFKEKg/exec';  // used for unsubscribe links
const ROOM = 'Room C330, Cheit Hall, Haas';
const REMINDER = { daysBefore: 2, hour: 9 };    // presenters: Monday 9am before a Wednesday session
const ANNOUNCE = { daysBefore: 6, hour: 10 };   // mailing list: Thursday 10am the week before
// Abstracts are due 24 hours before ANNOUNCE (see abstractDeadline_ in Code.gs). Presenters without one
// get a reminder 3 days before ANNOUNCE (Monday 9am for a Wednesday session), copied to ADMIN_EMAIL.
const ABSTRACT_REMINDER = { daysBefore: ANNOUNCE.daysBefore + 3, hour: 9 };
const BLOG_DIGEST = { weekday: 'SUNDAY', hour: 19 };  // new blog posts to the mailing list; skipped when there are none
const SKIP_EMPTY_WEEKS = true;                  // no list email when nobody has signed up
const SUBSCRIBERS_SHEET = 'Subscribers';
const ADMIN_EMAIL = 'berkeleyfirstyearworkshop@gmail.com';                         // gets a note for every sign-up; '' = the account running the script
// ====================================

const TYPE_LABEL = { paper: 'Paper', idea: 'Early idea' };
const FORMAT_NOTE = 'You have 15 minutes and questions are welcome throughout, so leave some room for them.';
const WELCOME_NOTE = 'Everyone is welcome to participate!';
const OPEN_NOTE = "You don't need a finished paper to present: a rough idea, an early result, or a question you're stuck on all make for a good 15 minutes.";

// Run once from the editor (and again after changing REMINDER, ANNOUNCE, or BLOG_DIGEST).
// The daily triggers only send when a session is exactly `daysBefore` days away.
function setupTriggers() {
  const handlers = ['sendPresenterReminders', 'sendWeeklyAnnouncement', 'sendAbstractReminders', 'sendBlogDigest'];
  ScriptApp.getProjectTriggers()
    .filter(t => handlers.indexOf(t.getHandlerFunction()) !== -1)
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sendPresenterReminders').timeBased().everyDays(1).atHour(REMINDER.hour).inTimezone(TZ).create();
  ScriptApp.newTrigger('sendWeeklyAnnouncement').timeBased().everyDays(1).atHour(ANNOUNCE.hour).inTimezone(TZ).create();
  ScriptApp.newTrigger('sendAbstractReminders').timeBased().everyDays(1).atHour(ABSTRACT_REMINDER.hour).inTimezone(TZ).create();
  ScriptApp.newTrigger('sendBlogDigest').timeBased().onWeekDay(ScriptApp.WeekDay[BLOG_DIGEST.weekday]).atHour(BLOG_DIGEST.hour).inTimezone(TZ).create();
}

// Sends every email type for the next session to you only. Safe to run any time.
function testEmails() {
  const me = Session.getEffectiveUser().getEmail();
  const s = nextSession_();
  if (!s) return Logger.log('No upcoming sessions.');
  const booked = s.slots.find(x => x.booking);
  const sample = booked
    ? { date: s.date, name: booked.booking.name, email: me, title: booked.booking.title, abstract: booked.booking.abstract, id: bookingId_(booked.booking) }
    : { date: s.date, name: 'Test Presenter', email: me, title: 'TBD', abstract: '', id: 'test-booking' };
  const time = booked ? booked.time : SLOT_TIMES[0];
  sendBookingConfirmation_(sample, time, true);
  sendBookingConfirmation_(Object.assign({}, sample, { abstract: '' }), time, false);
  sendAdminNotice_(Object.assign({ department: 'Econ', type: 'paper' }, sample), time, me);
  sendWelcome_(me);
  reminders_(me);
  announce_(me);
  sendAbstractReminder_(s.date, { time: time, booking: { name: sample.name, email: me, title: sample.title, id: sample.id } }, me);
  const talk = { id: sample.id, slot_id: slotId_(s.date, time), name: sample.name, email: me, title: sample.title, department: 'Econ', type: 'paper', abstract: '' };
  sendMoveNotice_(talk, slotId_(shiftDate_(s.date, 7), time), me);
  sendCancelNotice_(talk, me);
  trySend_(() => blogDigest_(me));
}

function sendPresenterReminders() { reminders_(null); }
function sendWeeklyAnnouncement() { announce_(null); }
function sendAbstractReminders() { abstractReminders_(); }
function sendBlogDigest() { blogDigest_(null); }

// ----- Booking confirmation (called from Code.gs), with a calendar invite -----
// joinedList: they were just added to the mailing list, so say so and give them a way out.
function sendBookingConfirmation_(c, time, joinedList) {
  const tbd = String(c.title).trim().toUpperCase() === 'TBD';
  const when = `${fmtLong_(c.date)}, ${slotRange_(time)}pm`;
  const invite = ics_({
    uid: `${c.id}-presenter@${host_()}`,
    date: c.date,
    summary: `${SEMINAR_NAME}: presenting at ${fmt12_(time)}pm`,
    description: `Your slot: ${slotRange_(time)}pm\nTitle: ${c.title}\n\n${SITE_URL}`,
  });
  const tbdNote = "When you have a title, reply to this email and we'll update the schedule.";
  const talk = talkLink_(c.id);
  const manageNote = `Can't make it? Move to another week or cancel on your talk's page: ${talk} You can also reply to this email.`;
  const listNote = "We've also added you to the mailing list, which sends the line-up before each session.";
  const unsub = joinedList ? unsubscribeLink_(c.email) : '';
  const absLink = talk + '#abstract';
  const absDue = fmtDeadline_(abstractDeadline_(c.date));
  const absNeeded = abstractRequired_(c.date);
  const absNote = absNeeded
    ? `Your abstract is due by ${absDue}, 24 hours before the line-up goes to the mailing list: up to 100 words on the question, why it matters, and any results so far. Add it here: ${absLink}`
    : `An abstract is optional for this session. If you'd like one in the line-up email, add it here: ${absLink}`;
  const absEdit = `You can change your abstract here: ${absLink}`;
  const text =
`Hi ${firstName_(c.name)},

Thanks for signing up to present at the ${SEMINAR_NAME}.

When: ${when} (the session runs ${sessionRange_()})
Where: ${ROOM}
Title: ${c.title}
${c.link ? `${c.linkType}: ${c.link}\n` : ''}${c.abstract ? `Abstract: ${c.abstract}\n` : ''}
${c.abstract ? absEdit : absNote}

${tbd ? tbdNote + '\n\n' : ''}${FORMAT_NOTE} A calendar invite is attached, and we'll send a reminder nearer the time.

${manageNote}

${joinedList ? `${listNote} Unsubscribe: ${unsub}\n\n` : ''}${SEMINAR_NAME}
${SITE_URL}`;
  const html = shell_("You're booked in", `${when}, ${ROOM}`, `
    ${p_(`Hi ${h_(firstName_(c.name))},`)}
    ${p_(`Thanks for signing up to present at the ${h_(SEMINAR_NAME)}.`)}
    ${details_([['When', `${when} (session runs ${sessionRange_()})`], ['Where', ROOM], ['Title', c.title]].concat(c.link ? [[c.linkType, linkHtml_(c), true]] : []))}
    ${c.abstract
      ? abstractHtml_(c.abstract) + p_(`<a href="${h_(absLink)}" style="color:#003262">Change your abstract</a>`)
      : absNeeded
        ? p_(`<strong>Your abstract is due by ${h_(absDue)}</strong>, 24 hours before the line-up goes to the mailing list. Up to 100 words on the question, why it matters, and any results so far.`) + button_(absLink, 'Add your abstract')
        : p_(`An abstract is optional for this session. If you'd like one in the line-up email, <a href="${h_(absLink)}" style="color:#003262">add it here</a>.`)}
    ${tbd ? p_(tbdNote) : ''}
    ${p_(`${FORMAT_NOTE} A calendar invite is attached, and we'll send a reminder nearer the time.`)}
    ${p_(`Can't make it? <a href="${h_(talk)}" style="color:#003262">Move to another week or cancel</a> on your talk's page, or reply to this email.`)}
    ${joinedList ? p_(`${listNote} <a href="${unsub}" style="color:#003262">Unsubscribe</a> if you'd rather not get it.`) : ''}`);
  send_({ to: c.email, subject: `You're presenting on ${fmtLong_(c.date)} at ${fmt12_(time)}pm`, body: text, htmlBody: html, attachments: [invite] });
}

// ----- Sign-up notice to the organizers (called from Code.gs). Replying goes to the presenter. -----
function sendAdminNotice_(c, time, to) {
  const text =
`${c.name} signed up to present.

When: ${fmtLong_(c.date)}, ${slotRange_(time)}pm
Name: ${c.name}
Email: ${c.email}
Department: ${c.department}
Title: ${c.title}
Type: ${TYPE_LABEL[c.type] || c.type}
${c.link ? `Link: ${c.linkType}, ${c.link}\n` : ''}Abstract: ${c.abstract || (abstractRequired_(c.date) ? `not yet (due ${fmtDeadline_(abstractDeadline_(c.date))})` : 'none (optional for this session)')}

Bookings sheet: ${SpreadsheetApp.getActiveSpreadsheet().getUrl()}`;
  send_({
    to: to || ADMIN_EMAIL || Session.getEffectiveUser().getEmail(),
    replyTo: c.email,
    subject: `New sign-up: ${c.name}, ${fmtLong_(c.date)} at ${fmt12_(time)}pm`,
    body: text,
  });
}

// ----- Abstract added later through the personal link (called from Code.gs) -----
function sendAbstractNotice_(b, abstract) {
  const date = b.slot_id.slice(0, 10);
  send_({
    to: ADMIN_EMAIL || Session.getEffectiveUser().getEmail(),
    replyTo: b.email,
    subject: `Abstract added: ${b.name}, ${fmtLong_(date)}`,
    body: `${b.name} added an abstract for "${titleText_(b.title)}" (${fmtLong_(date)}).\n\n${abstract}\n\nBookings sheet: ${SpreadsheetApp.getActiveSpreadsheet().getUrl()}`,
  });
}

// ----- Moved or canceled through the talk page (called from Code.gs). testTo: send both emails there instead. -----
function sendMoveNotice_(b, fromSlot, testTo) {
  const date = b.slot_id.slice(0, 10), time = timeOf_(b.slot_id), fromDate = fromSlot.slice(0, 10);
  const when = `${fmtLong_(date)}, ${slotRange_(time)}pm`;
  const was = `${fmtLong_(fromDate)}, ${slotRange_(timeOf_(fromSlot))}pm`;
  const talk = talkLink_(b.id);
  const invite = ics_({
    uid: `${b.id}-presenter@${host_()}`,
    date: date,
    summary: `${SEMINAR_NAME}: presenting at ${fmt12_(time)}pm`,
    description: `Your slot: ${slotRange_(time)}pm\nTitle: ${titleText_(b.title)}\n\n${SITE_URL}`,
  });
  const calNote = `The attached calendar invite is for the new time. If your calendar still shows ${fmtLong_(fromDate)}, delete that event.`;
  const absNote = !b.abstract && abstractRequired_(date) ? `Your abstract is due by ${fmtDeadline_(abstractDeadline_(date))}.` : '';
  const text =
`Hi ${firstName_(b.name)},

Your talk has moved to ${when}, ${ROOM}. It was ${was}.

${calNote}
${absNote ? '\n' + absNote + '\n' : ''}
Your talk's page: ${talk}

${SEMINAR_NAME}
${SITE_URL}`;
  const html = shell_('Your talk has moved', `${when}, ${ROOM}`, `
    ${p_(`Hi ${h_(firstName_(b.name))},`)}
    ${p_(`Your talk has moved to <strong>${h_(when)}</strong>, ${h_(ROOM)}. It was ${h_(was)}.`)}
    ${p_(h_(calNote))}
    ${absNote ? p_(h_(absNote)) : ''}
    ${button_(talk, "Your talk's page")}`);
  send_({ to: testTo || b.email, subject: `Your talk has moved to ${fmtLong_(date)} at ${fmt12_(time)}pm`, body: text, htmlBody: html, attachments: [invite] });
  send_({
    to: testTo || ADMIN_EMAIL || Session.getEffectiveUser().getEmail(),
    replyTo: b.email,
    subject: `Moved: ${b.name}, ${fmtLong_(fromDate)} to ${fmtLong_(date)}`,
    body: `${b.name} moved "${titleText_(b.title)}" from ${was} to ${when} on their talk page.\n\nBookings sheet: ${SpreadsheetApp.getActiveSpreadsheet().getUrl()}`,
  });
}

function sendCancelNotice_(b, testTo) {
  const date = b.slot_id.slice(0, 10), time = timeOf_(b.slot_id);
  const when = `${fmtLong_(date)}, ${slotRange_(time)}pm`;
  const invite = ics_({
    uid: `${b.id}-presenter@${host_()}`,
    date: date,
    summary: `${SEMINAR_NAME}: presenting at ${fmt12_(time)}pm (canceled)`,
    description: `Canceled.\n\n${SITE_URL}`,
    cancel: true,
  });
  const again = 'If you would like to present another week, sign up again on the schedule';
  const text =
`Hi ${firstName_(b.name)},

Your talk on ${when} is canceled, and the slot is open for someone else.

${again}: ${SITE_URL}#schedule

${SEMINAR_NAME}
${SITE_URL}`;
  const html = shell_('Your talk is canceled', when, `
    ${p_(`Hi ${h_(firstName_(b.name))},`)}
    ${p_(`Your talk on ${h_(when)} is canceled, and the slot is open for someone else.`)}
    ${p_(`${again}: <a href="${SITE_URL}#schedule" style="color:#003262">see the schedule</a>.`)}`);
  send_({ to: testTo || b.email, subject: `Your talk on ${fmtLong_(date)} is canceled`, body: text, htmlBody: html, attachments: [invite] });
  send_({
    to: testTo || ADMIN_EMAIL || Session.getEffectiveUser().getEmail(),
    replyTo: b.email,
    subject: `Canceled: ${b.name}, ${fmtLong_(date)} at ${fmt12_(time)}pm`,
    body: `${b.name} canceled "${titleText_(b.title)}" (${when}) on their talk page. The slot is open again.\n\n` +
      `Email: ${b.email}\nDepartment: ${b.department}\nType: ${TYPE_LABEL[b.type] || b.type}${b.abstract ? `\nAbstract: ${b.abstract}` : ''}\n\n` +
      `Bookings sheet: ${SpreadsheetApp.getActiveSpreadsheet().getUrl()}`,
  });
}

// ----- Abstract reminders: presenters still without one, copied to the organizers -----
function abstractReminders_() {
  const s = sessionInDays_(ABSTRACT_REMINDER.daysBefore);
  if (!s || !abstractRequired_(s.date)) return;
  const missing = s.slots.filter(x => x.booking && !x.booking.abstract);
  if (!missing.length) return;
  if (!claimSend_('abstract_' + s.date)) return;
  missing.forEach(x => sendAbstractReminder_(s.date, x, null));
}

// Run by hand from the editor: asks presenters at the next session that needs abstracts, and who
// haven't added one, for it now. For when the automatic Monday reminder has already passed.
function remindNextSessionAbstracts() {
  const today = today_();
  const date = sessionDates_().find(d => d >= today && abstractRequired_(d));
  if (!date) return Logger.log('No upcoming session needs abstracts.');
  const missing = sessionData_(date).slots.filter(x => x.booking && !x.booking.abstract);
  missing.forEach(x => sendAbstractReminder_(date, x, null));
  Logger.log(`Asked ${missing.length} presenter(s) on ${date} for their abstract.`);
}

function sendAbstractReminder_(date, x, testTo) {
  const b = x.booking;
  const link = talkLink_(bookingId_(b)) + '#abstract';
  const deadline = abstractDeadline_(date);
  const due = fmtDeadline_(deadline);
  // Past the deadline (a late manual reminder), ask for it before the line-up email goes out instead.
  const late = Date.now() >= deadline;
  const ask = late
    ? `Please add it as soon as you can, before the line-up goes to the mailing list on ${fmtDeadline_(deadline + 864e5)}`
    : `Please add it by ${due}, 24 hours before the line-up goes to the mailing list`;
  const when = `${fmtLong_(date)}, ${slotRange_(x.time)}pm`;
  const text =
`Hi ${firstName_(b.name)},

You're presenting at the ${SEMINAR_NAME} on ${when}, and we don't have your abstract yet.

${ask}:
${link}

Up to 100 words on the question, why it matters, and any results so far.

If you can no longer make your slot, reply to this email.

${SEMINAR_NAME}
${SITE_URL}`;
  const html = shell_('Your abstract is due soon', when, `
    ${p_(`Hi ${h_(firstName_(b.name))},`)}
    ${p_(`You're presenting at the ${h_(SEMINAR_NAME)} on ${h_(when)}, and we don't have your abstract yet.`)}
    ${p_(`${h_(ask)}. Up to 100 words on the question, why it matters, and any results so far.`)}
    ${button_(link, 'Add your abstract')}
    ${p_('If you can no longer make your slot, reply to this email.')}`);
  const subject = late ? 'Your abstract is needed as soon as possible' : `Your abstract is due ${due}`;
  const msg = { to: testTo || b.email, replyTo: ADMIN_EMAIL || undefined, subject: subject, body: text, htmlBody: html };
  if (!testTo && ADMIN_EMAIL) msg.cc = ADMIN_EMAIL;
  send_(msg);
}

// ----- Presenter reminders -----
function reminders_(testTo) {
  const s = testTo ? nextSession_() : sessionInDays_(REMINDER.daysBefore);
  if (!s) return;
  const talks = s.slots.filter(x => x.booking);
  if (!talks.length) return Logger.log('No presenters booked for ' + s.date + '.');
  if (!testTo && !claimSend_('remind_' + s.date)) return;

  talks.forEach(x => {
    const b = x.booking;
    const when = `${fmtLong_(s.date)}, ${slotRange_(x.time)}pm`;
    const talk = talkLink_(bookingId_(b));
    const text =
`Hi ${firstName_(b.name)},

A reminder that you're presenting at the ${SEMINAR_NAME} on ${fmtLong_(s.date)}.

Your slot: ${slotRange_(x.time)}pm, ${ROOM}
Your title: ${titleText_(b.title)}

Full line-up

${lineupText_(talks)}

${FORMAT_NOTE} If you can no longer make it, move to another week or cancel on your talk's page: ${talk}

${SEMINAR_NAME}
${SITE_URL}`;
    const html = shell_("Reminder: you're presenting soon", `${when}, ${ROOM}`, `
      ${p_(`Hi ${h_(firstName_(b.name))},`)}
      ${p_(`A reminder that you're presenting at the ${h_(SEMINAR_NAME)} on ${h_(fmtLong_(s.date))}.`)}
      ${details_([['Your slot', `${slotRange_(x.time)}pm`], ['Where', ROOM], ['Your title', titleText_(b.title)]])}
      <h3 style="font-family:Georgia,serif;color:#003262;font-size:17px;margin:24px 0 4px">Full line-up</h3>
      ${lineupHtml_(talks, x.time)}
      ${p_(`${FORMAT_NOTE} If you can no longer make it, <a href="${h_(talk)}" style="color:#003262">move to another week or cancel</a> on your talk's page.`)}`);
    send_({ to: testTo || b.email, subject: `Reminder: you're presenting on ${fmtLong_(s.date)} at ${fmt12_(x.time)}pm`, body: text, htmlBody: html });
  });
}

// ----- Announcement to the list, with a calendar invite -----
function announce_(testTo) {
  const s = testTo ? nextSession_() : sessionInDays_(ANNOUNCE.daysBefore);
  if (!s) return;
  const talks = s.slots.filter(x => x.booking);
  if (!testTo && !talks.length && SKIP_EMPTY_WEEKS) return;

  const recipients = testTo ? [testTo] : activeSubscribers_();
  if (!recipients.length) return;
  const quota = MailApp.getRemainingDailyQuota();
  if (quota < recipients.length) {
    throw new Error(`Only ${quota} emails left in today's quota for ${recipients.length} subscribers.`);
  }
  if (!testTo && !claimSend_('announce_' + s.date)) return;

  const heading = `${ANNOUNCE.daysBefore >= 5 ? 'Next week' : 'This week'} at the ${SEMINAR_NAME}`;
  const open = s.slots.length - talks.length;
  const when = `${fmtLong_(s.date)}, ${sessionRange_()}, ${ROOM}`;
  const openWords = `${open} ${open === 1 ? 'slot is' : 'slots are'} still open.`;
  const laterSpace = !open && buildSessions_().some(x => x.date > s.date && x.slots.some(y => !y.booking));
  const signup = open ? openWords : laterSpace ? 'This week is fully booked.' : '';
  const signupLink = open ? 'Sign up on the website' : 'Sign up for a future week';

  const invite = ics_({
    uid: `${s.date}-session@${host_()}`,
    date: s.date,
    summary: SEMINAR_NAME,
    description: (talks.length
      ? talks.map(x => `${fmt12_(x.time)} ${x.booking.name}: ${titleText_(x.booking.title)}`).join('\n')
      : 'Line-up to be confirmed.') + `\n\n${SITE_URL}`,
  });

  recipients.forEach(email => {
    const unsub = unsubscribeLink_(email);
    const text =
`${heading}
${when}

${talks.length ? lineupText_(talks) : 'No talks booked yet.'}

${signup ? `${signup} ${signupLink}: ${SITE_URL}\n\n${OPEN_NOTE}\n\n` : ''}${WELCOME_NOTE} A calendar invite is attached.

Unsubscribe: ${unsub}`;
    const html = shell_(heading, when, `
      ${talks.length ? lineupHtml_(talks) : p_('No talks booked yet.')}
      ${signup ? p_(`${signup} <a href="${SITE_URL}" style="color:#003262">${signupLink}</a>.`) + p_(`<em>${h_(OPEN_NOTE)}</em>`) : ''}
      ${p_(`${WELCOME_NOTE} A calendar invite is attached.`)}`, unsub);
    send_({ to: email, subject: `${SEMINAR_NAME}: ${fmtLong_(s.date)}`, body: text, htmlBody: html, attachments: [invite] });
  });
}

// ----- Weekly blog email: new posts since the last one -----
// Reads the live site's blog/posts.json and remembers which posts it has sent, so a post published
// just after a send goes out the following week.
function blogDigest_(testTo) {
  const res = UrlFetchApp.fetch(SITE_URL + 'blog/posts.json', { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Could not read blog/posts.json: HTTP ' + res.getResponseCode());
  const posts = JSON.parse(res.getContentText());
  const props = PropertiesService.getScriptProperties();
  const announced = JSON.parse(props.getProperty('blog_announced') || '[]');
  const fresh = testTo ? posts.slice(0, 3) : newPosts_(posts, announced, today_());
  if (!fresh.length) return Logger.log('No new blog posts this week.');

  const recipients = testTo ? [testTo] : activeSubscribers_();
  if (!recipients.length) return;
  const quota = MailApp.getRemainingDailyQuota();
  if (quota < recipients.length) {
    throw new Error(`Only ${quota} emails left in today's quota for ${recipients.length} subscribers.`);
  }
  // Recorded before sending, so a second run of the trigger can't send the same posts again.
  if (!testTo) props.setProperty('blog_announced', JSON.stringify(announced.concat(fresh.map(p => p.slug)).slice(-500)));

  const subject = fresh.length === 1 ? `New on the ${SEMINAR_NAME} blog: ${fresh[0].title}` : `This week on the ${SEMINAR_NAME} blog`;
  const postUrl = p => `${SITE_URL}blog/posts/${p.slug}.html`;
  const writeUrl = `${SITE_URL}blog/submit.html`;
  recipients.forEach(email => {
    const unsub = unsubscribeLink_(email);
    const text = `New on the blog\n\n` + fresh.map(p =>
      `${p.title}\n${p.author}, ${fmtLong_(p.date)}\n${p.standfirst ? p.standfirst + '\n' : ''}${postUrl(p)}`).join('\n\n') +
      `\n\nWrite a blog post: ${writeUrl}\n\nUnsubscribe: ${unsub}`;
    const html = shell_('New on the blog', 'Short posts by first-year PhD students in Econ, ARE, and Haas.', fresh.map(p => `
      <div style="margin:20px 0;padding-top:16px;border-top:1px solid #e3e8ee">
        ${p.image ? `<a href="${postUrl(p)}"><img src="${SITE_URL}blog/images/${encodeURIComponent(p.image)}" alt="" width="520" style="display:block;width:100%;max-width:520px;height:auto;border-radius:4px;margin:0 0 12px"></a>` : ''}
        <a href="${postUrl(p)}" style="font-family:Georgia,serif;font-size:20px;font-weight:600;color:#003262;text-decoration:none">${h_(p.title)}</a>
        <div style="color:#5a6773;margin:4px 0 6px">${h_(p.author)}, ${h_(fmtLong_(p.date))}</div>
        ${p.standfirst ? `<div>${h_(p.standfirst)}</div>` : ''}
      </div>`).join('') + p_(`<a href="${writeUrl}" style="color:#003262">Write a blog post</a>: up to 1,000 words on an idea, a paper you liked, or something you've learned.`), unsub);
    send_({ to: email, subject: subject, body: text, htmlBody: html });
  });
}

// Posts not sent yet, skipping anything older than two weeks so the first run never sends the whole archive.
function newPosts_(posts, announced, today) {
  const since = shiftDate_(today, -14);
  const seen = new Set(announced);
  return posts.filter(p => !seen.has(p.slug) && p.date >= since && p.date <= today);
}

// ----- Subscribers -----
function subscribe_(d) {
  const email = str_(d.email, 120).toLowerCase();
  const name = str_(d.name, 100);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Enter a valid email address.' };
  const sheet = getSubsSheet_();
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toLowerCase() === email) {
      const wasActive = String(rows[i][3]).trim() === 'subscribed';
      sheet.getRange(i + 1, 4).setValue('subscribed');
      if (!wasActive) trySend_(() => sendWelcome_(email));
      return { ok: true };
    }
  }
  sheet.appendRow([email, safe_(name), new Date(), 'subscribed']);
  trySend_(() => sendWelcome_(email));
  return { ok: true };
}

// Presenters join the list automatically. Returns true if newly added; anyone who unsubscribed stays off.
function addPresenterToList_(email, name) {
  const sheet = getSubsSheet_();
  const known = sheet.getDataRange().getValues().slice(1).some(r => String(r[0]).trim().toLowerCase() === email);
  if (known) return false;
  sheet.appendRow([email, safe_(name), new Date(), 'subscribed']);
  return true;
}

function sendWelcome_(email) {
  const unsub = unsubscribeLink_(email);
  const intro = "Before each session you'll get an email with who's presenting and a calendar invite, and on Sundays any new blog posts.";
  const when = `Sessions are on Wednesdays, ${sessionRange_()}, ${ROOM}.`;
  send_({
    to: email,
    subject: `You're on the ${SEMINAR_NAME} mailing list`,
    body: `Thanks for signing up.\n\n${intro} ${when}\n\nSee the schedule or sign up to present: ${SITE_URL}\n\n${OPEN_NOTE}\n\nUnsubscribe: ${unsub}`,
    htmlBody: shell_("You're on the list", '', `
      ${p_('Thanks for signing up.')}
      ${p_(`${intro} ${h_(when)}`)}
      ${p_(`<a href="${SITE_URL}" style="color:#003262">See the schedule or sign up to present</a>.`)}
      ${p_(`<em>${h_(OPEN_NOTE)}</em>`)}`, unsub),
  });
}

function activeSubscribers_() {
  const rows = getSubsSheet_().getDataRange().getValues().slice(1);
  const out = rows.filter(r => String(r[3]).trim() === 'subscribed').map(r => String(r[0]).trim().toLowerCase());
  return Array.from(new Set(out.filter(Boolean)));
}

function unsubscribePage_(p) {
  const email = String(p.email || '').trim().toLowerCase();
  let msg = 'This unsubscribe link is not valid.';
  if (email && p.token === token_(email)) {
    const sheet = getSubsSheet_();
    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]).trim().toLowerCase() === email) sheet.getRange(i + 1, 4).setValue('unsubscribed');
    }
    msg = `${email} has been unsubscribed from the ${SEMINAR_NAME} emails.`;
  }
  return HtmlService.createHtmlOutput(
    `<p style="font-family:sans-serif;font-size:16px;max-width:480px;margin:15vh auto;padding:0 20px">${h_(msg)}</p>`
  ).setTitle(SEMINAR_NAME);
}

function getSubsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SUBSCRIBERS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(SUBSCRIBERS_SHEET);
    sheet.appendRow(['email', 'name', 'subscribed_at', 'status']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Unsubscribe and abstract links carry a signature so nobody can act for other people.
function token_(email) {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('UNSUB_SECRET');
  if (!secret) { secret = Utilities.getUuid(); props.setProperty('UNSUB_SECRET', secret); }
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(email, secret)).slice(0, 22);
}
const unsubscribeLink_ = email => `${WEB_APP_URL}?action=unsubscribe&email=${encodeURIComponent(email)}&token=${token_(email)}`;

// ----- Calendar invite (.ics) for the whole session -----
function ics_(o) {
  const stamp = d => Utilities.formatDate(d, 'UTC', "yyyyMMdd'T'HHmmss'Z'");
  const at = t => stamp(Utilities.parseDate(`${o.date} ${t}`, TZ, 'yyyy-MM-dd HH:mm'));
  const esc = v => String(v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const fold = line => line.length <= 73 ? line : line.match(/.{1,73}/g).join('\r\n ');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//First-Year Workshop//Sign-ups//EN', 'CALSCALE:GREGORIAN', 'METHOD:' + (o.cancel ? 'CANCEL' : 'PUBLISH'),
    'BEGIN:VEVENT',
    'UID:' + o.uid,
    // Later invites with the same UID (a moved or canceled talk) replace earlier ones in most calendars.
    'SEQUENCE:' + Math.floor(Date.now() / 1000),
    'DTSTAMP:' + stamp(new Date()),
    'DTSTART:' + at(SLOT_TIMES[0]),
    'DTEND:' + at(sessionEnd_()),
    'SUMMARY:' + esc(o.summary),
    'LOCATION:' + esc(ROOM),
    'DESCRIPTION:' + esc(o.description),
    'URL:' + SITE_URL,
    ...(o.cancel ? ['STATUS:CANCELLED'] : []),
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return Utilities.newBlob(lines.map(fold).join('\r\n') + '\r\n', 'text/calendar', 'first-year-workshop.ics');
}

// ----- Email building blocks -----
function send_(o) { MailApp.sendEmail(Object.assign({ name: FROM_NAME }, o)); }

function shell_(heading, sub, inner, unsub) {
  return `
<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#15212c;max-width:560px;line-height:1.5">
  <h2 style="font-family:Georgia,serif;color:#003262;margin:0 0 4px">${h_(heading)}</h2>
  ${sub ? `<p style="margin:0 0 16px;color:#5a6773">${h_(sub)}</p>` : ''}
  ${inner}
  <p style="font-size:12px;color:#8a96a3;margin-top:32px">
    <a href="${SITE_URL}" style="color:#8a96a3">${h_(SITE_URL.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>
    ${unsub ? ` &nbsp;|&nbsp; <a href="${unsub}" style="color:#8a96a3">Unsubscribe</a>` : ''}
  </p>
</div>`;
}
const p_ = html => `<p style="margin:16px 0">${html}</p>`;
const button_ = (href, label) => `<p style="margin:20px 0"><a href="${h_(href)}" style="display:inline-block;background:#003262;color:#ffffff;font-weight:600;text-decoration:none;padding:12px 18px;border-radius:4px">${h_(label)}</a></p>`;
const abstractHtml_ = abstract => `<div style="margin:16px 0;padding:12px 16px;background:#f1f4f7;border-radius:4px"><div style="color:#5a6773;font-size:13px;margin-bottom:4px">Abstract</div>${h_(abstract)}</div>`;

function details_(rows) {
  return `<table style="border-collapse:collapse;margin:16px 0">${rows.map(([k, v, html]) => `
    <tr><td style="padding:4px 16px 4px 0;color:#5a6773;vertical-align:top;white-space:nowrap">${h_(k)}</td>
    <td style="padding:4px 0;font-weight:600">${html ? v : h_(v)}</td></tr>`).join('')}</table>`;
}

// mine: highlight that slot's row (used in presenter reminders)
function lineupHtml_(talks, mine) {
  return `<table style="border-collapse:collapse;width:100%">${talks.map(x => {
    const b = x.booking;
    const you = x.time === mine;
    return `
    <tr${you ? ' style="background:#fff7df"' : ''}>
      <td style="width:1%;padding:10px 16px 10px 8px;vertical-align:top;color:#003262;font-weight:600;white-space:nowrap;border-top:1px solid #e3e8ee">${fmt12_(x.time)}</td>
      <td style="padding:10px 8px 10px 0;border-top:1px solid #e3e8ee">
        <div style="font-weight:600">${h_(titleText_(b.title))}</div>
        <div style="color:#5a6773">${h_(b.name)}, ${h_(b.department)} (${TYPE_LABEL[b.type] || ''})${you ? ' &nbsp;<strong style="color:#003262">You</strong>' : ''}</div>
        ${b.abstract ? `<div style="margin-top:6px">${h_(b.abstract)}</div>` : ''}
        ${b.link ? `<div>${linkHtml_(b)}</div>` : ''}
      </td>
    </tr>`;
  }).join('')}</table>`;
}

function lineupText_(talks) {
  return talks.map(x => {
    const b = x.booking;
    return `${fmt12_(x.time)}  ${titleText_(b.title)}\n       ${b.name}, ${b.department} (${TYPE_LABEL[b.type] || ''})` +
      (b.abstract ? `\n       ${b.abstract}` : '') +
      (b.link ? `\n       ${b.linkType}: ${b.link}` : '');
  }).join('\n\n');
}

// ----- Helpers -----
const host_ = () => SITE_URL.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
function sessionData_(date) {
  const rows = readBookings_(getSheet_());
  return {
    date: date,
    slots: SLOT_TIMES.map(t => ({ time: t, booking: rows.find(r => r.slot_id === slotId_(date, t)) || null })),
  };
}
function sessionInDays_(n) {
  const target = Utilities.formatDate(new Date(Date.now() + n * 864e5), TZ, 'yyyy-MM-dd');
  return sessionDates_().indexOf(target) !== -1 ? sessionData_(target) : null;
}
function nextSession_() {
  const today = today_();
  const date = sessionDates_().find(d => d >= today);
  return date ? sessionData_(date) : null;
}

// Stops a trigger that fires twice from sending the same email twice.
function claimSend_(key) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(key)) return false;
  props.setProperty(key, new Date().toISOString());
  return true;
}
function trySend_(fn) { try { fn(); } catch (err) { console.error(err); } }

const addMin_ = (t, n) => { let [h, m] = t.split(':').map(Number); m += n; h += Math.floor(m / 60); m %= 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };
const sessionEnd_ = () => addMin_(SLOT_TIMES[SLOT_TIMES.length - 1], 15);
const fmt12_ = t => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')}`; };
const slotRange_ = t => `${fmt12_(t)}-${fmt12_(addMin_(t, 15))}`;
const sessionRange_ = () => `${fmt12_(SLOT_TIMES[0])}-${fmt12_(sessionEnd_())}pm`;
const fmtLong_ = iso => Utilities.formatDate(new Date(iso + 'T12:00:00Z'), 'UTC', 'EEEE d MMMM');
// "Wednesday 14 October, 10am"
const fmtDeadline_ = ms => Utilities.formatDate(new Date(ms), TZ, 'EEEE d MMMM, h:mma').replace(':00', '').replace('AM', 'am').replace('PM', 'pm');
const titleText_ = t => (String(t).trim().toUpperCase() === 'TBD' ? 'Title TBD' : t);
const linkHtml_ = b => `<a href="${h_(b.link)}" style="color:#003262">${h_(b.linkType)}</a>`;
const firstName_ = n => String(n).trim().split(/\s+/)[0];
const hash_ = s => Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s)).slice(0, 10);
const h_ = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Dates and free times, in Tunisia time (UTC+1 all year, no summer time).
const OFFSET_MS = 3_600_000;
const DAY_MS = 86_400_000;

const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const DAYS_SHORT = ['Dim.', 'Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const pad = (n) => String(n).padStart(2, '0');

// A date as it reads on a clock in Tunisia (use the getUTC* methods on the result).
const wallClock = (date) => new Date(date.getTime() + OFFSET_MS);

const ymdOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function instant(ymd, time) {
  const [y, m, d] = ymd.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - OFFSET_MS);
}

const parseYmd = (ymd) => new Date(`${ymd}T00:00:00Z`);

// "Sam. 19 sept."
function shortDay(ymd) {
  const d = parseYmd(ymd);
  return `${DAYS_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}

// "Samedi 19 septembre à 10:00"
function longSlot(ymd, time) {
  const d = parseYmd(ymd);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} à ${time}`;
}

// "Mercredi 16 septembre 2026, 20:45"
function nowLabel(now = new Date()) {
  const d = wallClock(now);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

// Every bookable time in the coming days, minus the ones already taken.
function freeSlots(booking, taken = [], now = new Date()) {
  const busy = new Set(taken.map((t) => Date.parse(t)));
  const today = Date.UTC(wallClock(now).getUTCFullYear(), wallClock(now).getUTCMonth(), wallClock(now).getUTCDate());
  const slots = [];
  for (let i = 0; i < booking.daysAhead; i++) {
    const day = new Date(today + i * DAY_MS);
    const ymd = ymdOf(day);
    for (const time of booking.hours[day.getUTCDay()] || []) {
      const at = instant(ymd, time);
      if (at.getTime() - now.getTime() < booking.noticeHours * 3_600_000) continue;
      if (busy.has(at.getTime())) continue;
      slots.push({ date: ymd, time, day: shortDay(ymd), text: longSlot(ymd, time), at: at.toISOString() });
    }
  }
  return slots;
}

// Today's date in Tunisia, YYYY-MM-DD.
const todayYmd = (now = new Date()) => ymdOf(wallClock(now));

module.exports = { freeSlots, nowLabel, shortDay, longSlot, todayYmd, instant };

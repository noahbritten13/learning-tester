// Small helpers shared across the app. No dependencies.

export function uid(prefix) {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const s = Array.from(bytes, b => (b % 36).toString(36)).join('');
  return `${prefix}_${s}${Date.now().toString(36).slice(-3)}`;
}

export const nowISO = () => new Date().toISOString();

// A "learning day" starts at 4am local time, like Anki, so a late-night
// session still counts towards the day you started it.
export const DAY_ROLLOVER_HOUR = 4;

export function dayStart(date = new Date()) {
  const d = new Date(date);
  if (d.getHours() < DAY_ROLLOVER_HOUR) d.setDate(d.getDate() - 1);
  d.setHours(DAY_ROLLOVER_HOUR, 0, 0, 0);
  return d;
}

export function nextDayStart(date = new Date()) {
  const d = dayStart(date);
  d.setDate(d.getDate() + 1);
  return d;
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const stripAccentsLower = s => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function slugify(s) {
  const slug = String(s ?? '')
    .normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'untitled';
}

// "3m", "2h", "5d", "3mo", "1.2y"
export function formatInterval(ms) {
  const min = ms / 60000;
  if (min < 1) return '<1m';
  if (min < 60) return `${Math.round(min)}m`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)}d`;
  const mo = d / 30.44;
  if (mo < 12) return `${Math.round(mo)}mo`;
  const y = d / 365.25;
  return `${y < 10 ? y.toFixed(1).replace(/\.0$/, '') : Math.round(y)}y`;
}

export function formatDuration(ms) {
  const min = Math.round(ms / 60000);
  if (min < 1) return ms > 0 ? '<1 min' : '0 min';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

export function formatRelative(date, now = new Date()) {
  const diff = new Date(date) - now;
  if (Math.abs(diff) < 60000) return diff > 0 ? 'in under a minute' : 'just now';
  return diff > 0 ? `in ${formatInterval(diff)}` : `${formatInterval(-diff)} ago`;
}

export function formatDate(date) {
  return new Date(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Spread `inserts` evenly through `base`, keeping both orders.
export function interleave(base, inserts) {
  if (!inserts.length) return base.slice();
  if (!base.length) return inserts.slice();
  const out = [];
  const step = (base.length + inserts.length) / inserts.length;
  let next = step / 2, bi = 0, ii = 0;
  for (let pos = 0; pos < base.length + inserts.length; pos++) {
    if (ii < inserts.length && (pos >= next || bi >= base.length)) {
      out.push(inserts[ii++]);
      next += step;
    } else {
      out.push(base[bi++]);
    }
  }
  return out;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function utf8ToBase64(s) {
  const bytes = textEncoder.encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function base64ToUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return textDecoder.decode(bytes);
}

// The SHA git itself would give this text as a file ("blob"). Lets sync
// tell whether a file on GitHub matches what we already have.
export async function gitBlobSha(text) {
  const body = textEncoder.encode(text);
  const header = textEncoder.encode(`blob ${body.length}\0`);
  const all = new Uint8Array(header.length + body.length);
  all.set(header);
  all.set(body, header.length);
  const hash = await crypto.subtle.digest('SHA-1', all);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

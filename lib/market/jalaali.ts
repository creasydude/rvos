// Minimal Jalali (Persian) calendar math for Codal's Persian-date API params
// and for normalizing period_end dates in filing titles. Port of jalaali-js.

function div(a: number, b: number): number {
  return ~~(a / b);
}
function mod(a: number, b: number): number {
  return a - ~~(a / b) * b;
}

function g2d(gy: number, gm: number, gd: number): number {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) +
    gd -
    34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function jalCal(jy: number): { leap: number; gy: number; march: number } {
  const breaks = [
    -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178,
  ];
  const bl = breaks.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = breaks[0];
  let jump = 0;
  let n = 0;
  let i: number;
  for (i = 1; i < bl; i += 1) {
    const jm = breaks[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function j2d(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function d2j(jdn: number): { jy: number; jm: number; jd: number } {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(r.gy, 3, r.march);
  let k = jdn - jdn1f;
  let jm: number;
  let jd: number;
  if (k >= 0) {
    if (k <= 185) {
      jm = 1 + div(k, 31);
      jd = mod(k, 31) + 1;
      return { jy, jm, jd };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  jm = 7 + div(k, 30);
  jd = mod(k, 30) + 1;
  return { jy, jm, jd };
}

export type JDate = { jy: number; jm: number; jd: number };

export function g2j(date: Date): JDate {
  return d2j(g2d(date.getFullYear(), date.getMonth() + 1, date.getDate()));
}

export function j2g(jy: number, jm: number, jd: number): Date {
  const { gy, gm, gd } = d2g(j2d(jy, jm, jd));
  return new Date(gy, gm - 1, gd);
}

export function todayJalali(): JDate {
  return g2j(new Date());
}

export function formatJalali(j: JDate): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${j.jy}/${p(j.jm)}/${p(j.jd)}`;
}

/** Jalali date string `days` days before today (as the API expects: 1405/05/12). */
export function daysAgoJalali(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return formatJalali(g2j(d));
}

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Convert Persian/Arabic digits (and thousands separators) to plain latin. */
export function faDigits(s: string): string {
  let out = s.replace(/[,،]/g, "").replace(/\s+/g, "");
  out = out.replace(/[۰-۹]/g, (c) => String(FA_DIGITS.indexOf(c)));
  out = out.replace(/[٠-٩]/g, (c) => String(AR_DIGITS.indexOf(c)));
  return out;
}

/** Normalize a Persian date like "۱۴۰۴/۱۲/۲۹" or "1404/12/29" to "1404/12/29". */
export function normalizePersianDate(s: string): string {
  const clean = faDigits(s.replace(/\s/g, ""));
  const m = clean.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return clean;
  const p = (n: string) => n.padStart(2, "0");
  return `${m[1]}/${p(m[2])}/${p(m[3])}`;
}

/** Extract a trailing Jalali period-end date from a letter title, if present. */
export function periodEndFromTitle(title: string): string | null {
  const m = title.match(/(?:منتهی به|مربوط به)?\s*(\d{4}[\/٠-٩/۰-۹]{4}[\d\/٠-٩/۰-۹]{0,5})/);
  // Simpler robust pass: find "YYYY/MM/DD" with Persian or latin digits.
  const clean = faDigits(title.replace(/\s/g, ""));
  const dm = clean.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!dm) return null;
  const p = (n: string) => n.padStart(2, "0");
  return `${dm[1]}/${p(dm[2])}/${p(dm[3])}`;
}

/** Jalali year from a normalized Persian date string. */
export function jalaliYear(dateStr: string): number {
  const y = Number(dateStr.split("/")[0]);
  return Number.isFinite(y) ? y : 0;
}

/** Parse a Persian datetime like "۱۴۰۵/۰۴/۲۳ ۱۲:۳۰:۵۶" to epoch ms. */
export function persianDateTimeToEpoch(s: string | undefined | null): number | null {
  if (!s) return null;
  const clean = faDigits(s).trim();
  const m = clean.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec] = m;
  const g = j2g(Number(y), Number(mo), Number(d));
  g.setHours(Number(h ?? 0), Number(mi ?? 0), Number(sec ?? 0), 0);
  return g.getTime();
}
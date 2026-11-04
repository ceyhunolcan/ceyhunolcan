// Builds the profile header, repo headers, social card and README.
// Runs nightly in GitHub Actions. Edit profile.json or README.template.md, not README.md.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import opentype from 'opentype.js';
import { Resvg } from '@resvg/resvg-js';

const require = createRequire(import.meta.url);
const cfg = JSON.parse(fs.readFileSync('profile.json', 'utf8'));
const fontFile = (pkg, f) => require.resolve(`@fontsource/${pkg}/files/${f}`);
const load = (p) => { const b = fs.readFileSync(p); return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };
const FONTS = {
  serif: load(fontFile('newsreader', 'newsreader-latin-400-normal.woff')),
  italic: load(fontFile('newsreader', 'newsreader-latin-400-italic.woff')),
  mono: load(fontFile('ibm-plex-mono', 'ibm-plex-mono-latin-400-normal.woff')),
};
const THEMES = {
  light: { ink: '#1f2328', muted: '#59636e', dot: '#3d444d', ghost: '#c8d1da', accent: '#2f6f9f', bg: '#ffffff' },
  dark: { ink: '#e6edf3', muted: '#9198a1', dot: '#c9d1d9', ghost: '#3d444d', accent: '#7aa5c7', bg: '#0d1117' },
};

// ---------- type: text outlined to paths, one <path> per unique glyph ----------
function typesetter() {
  const defs = new Map();
  function text(fontKey, str, size, x, y, { tracking = 0, anchor = 'start', fill } = {}) {
    const font = FONTS[fontKey];
    const upem = font.unitsPerEm, scale = size / upem;
    const glyphs = font.stringToGlyphs(str);
    const pos = [];
    let cx = 0;
    glyphs.forEach((g, i) => {
      pos.push(cx);
      cx += g.advanceWidth + tracking * upem;
      if (i < glyphs.length - 1) cx += font.getKerningValue(g, glyphs[i + 1]);
    });
    const width = (cx - tracking * upem) * scale;
    if (anchor === 'end') x -= width; else if (anchor === 'middle') x -= width / 2;
    const uses = glyphs.map((g, i) => {
      const id = `${fontKey[0]}${g.index}`;
      if (!defs.has(id)) defs.set(id, g.getPath(0, 0, upem).toPathData(0));
      return defs.get(id) ? `<use href="#${id}" x="${Math.round(pos[i])}"/>` : '';
    }).join('');
    // getPath(0, 0, upem) draws in font units, y down, baseline at 0
    return `<g fill="${fill}" transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(5)})">${uses}</g>`;
  }
  const defsSvg = () => `<defs>${[...defs].map(([id, d]) => `<path id="${id}" d="${d}"/>`).join('')}</defs>`;
  return { text, defsSvg };
}

// ---------- data: GitHub contribution calendar ----------
async function contributions() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn('No GITHUB_TOKEN: using a synthetic calendar for local preview.');
    let s = 3; const r = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    return Array.from({ length: 365 }, (_, i) => ({ date: `d${i}`, count: i > 180 && r() < 0.7 ? Math.floor(r() * 12) : 0 }));
  }
  const q = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}`;
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q, variables: { login: cfg.login } }),
  });
  const j = await res.json();
  if (!j.data) throw new Error('GraphQL failed: ' + JSON.stringify(j.errors || j));
  const days = j.data.user.contributionsCollection.contributionCalendar.weeks
    .flatMap((w) => w.contributionDays).map((d) => ({ date: d.date, count: d.contributionCount }));
  return days.slice(-365);
}

// ---------- figure: a helix with one point per day ----------
function helix(days, { cx, top, span, R, tilt = 0.26, perTurn = 91, period = 72, animate = true, T, accentLast = 7 }) {
  const ry = R * tilt, n = days.length;
  const max = Math.max(1, ...days.map((d) => d.count));
  let out = '';
  days.forEach((d, i) => {
    const th = (2 * Math.PI * i) / perTurn;
    const y = top + (i * span) / Math.max(1, n - 1);
    const active = d.count > 0;
    const r = active ? 1.15 + 1.25 * Math.sqrt(Math.log1p(d.count) / Math.log1p(max)) : 0.8;
    const cls = !active ? 'g' : i >= n - accentLast ? 'a' : 'd';
    if (animate) {
      const dx = -(((th / (2 * Math.PI)) % 1) * period);
      const dy = -((((th + Math.PI / 2) / (2 * Math.PI)) % 1) * period);
      out += `<g transform="translate(${cx} ${y.toFixed(1)})"><g class="x" style="animation-delay:${dx.toFixed(2)}s"><g class="y" style="animation-delay:${dy.toFixed(2)}s"><circle r="${r.toFixed(2)}" class="${cls}"/></g></g></g>`;
    } else {
      const x = cx + R * Math.cos(th), yy = y + ry * Math.sin(th);
      const op = 0.16 + 0.84 * (Math.sin(th) + 1) / 2;
      out += `<circle cx="${x.toFixed(1)}" cy="${yy.toFixed(1)}" r="${r.toFixed(2)}" class="${cls}" opacity="${op.toFixed(2)}"/>`;
    }
  });
  const ease = 'cubic-bezier(.37,0,.63,1)';
  const css = `circle.d{fill:${T.dot}}circle.a{fill:${T.accent}}circle.g{fill:${T.ghost}}` + (animate
    ? `.x{animation:ax ${period / 2}s ${ease} infinite alternate}.y{animation:ay ${period / 2}s ${ease} infinite alternate}` +
      `@keyframes ax{from{transform:translateX(${R}px)}to{transform:translateX(-${R}px)}}` +
      `@keyframes ay{from{transform:translateY(-${ry.toFixed(1)}px);opacity:.16}to{transform:translateY(${ry.toFixed(1)}px);opacity:1}}` +
      `@media (prefers-reduced-motion:reduce){.x,.y{animation-play-state:paused}}`
    : '');
  return { svg: `<g>${out}</g>`, css };
}

const svgDoc = (w, h, label, css, defs, body, bg) =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${label}">` +
  `<style>${css}</style>${defs}${bg ? `<rect width="${w}" height="${h}" fill="${bg}"/>` : ''}${body}</svg>\n`;

// ---------- outputs ----------
function profileHeader(theme, days) {
  const T = THEMES[theme], t = typesetter();
  const h = helix(days, { cx: 1010, top: 34, span: 228, R: 104, T });
  const body = [
    t.text('mono', 'BIOMEDICAL ENGINEERING  \u00b7  DARTMOUTH COLLEGE', 13.5, 0, 40, { tracking: 0.12, fill: T.muted }),
    t.text('serif', 'Ceyhun Olcan', 86, -4, 150, { tracking: -0.01, fill: T.ink }),
    t.text('italic', 'Reliable, fairness-audited AI for behavioral health.', 27, 0, 200, { fill: T.muted }),
    t.text('mono', 'HANOVER, NH', 12, 0, 262, { tracking: 0.12, fill: T.muted }),
    t.text('mono', 'FIG. 1  LAST 365 DAYS, ONE POINT PER DAY', 10.5, 1114, 292, { tracking: 0.1, anchor: 'end', fill: T.muted }),
    h.svg,
  ].join('');
  return svgDoc(1200, 300, 'Ceyhun Olcan. Reliable, fairness-audited AI for behavioral health.', h.css, t.defsSvg(), body);
}

function repoHeader(repo, theme, days) {
  const T = THEMES[theme], t = typesetter();
  const h = helix(days.slice(-182), { cx: 1080, top: 30, span: 160, R: 70, perTurn: 61, animate: false, T, accentLast: 0 });
  const body = [
    t.text('mono', 'CEYHUN OLCAN  \u00b7  RESEARCH CODE', 13, 0, 36, { tracking: 0.12, fill: T.muted }),
    t.text('serif', repo.title, 58, -3, 122, { tracking: -0.005, fill: T.ink }),
    t.text('italic', repo.claim, 23, 0, 166, { fill: T.muted }),
    h.svg,
  ].join('');
  return svgDoc(1200, 220, repo.title, h.css, t.defsSvg(), body);
}

function socialCard(days) {
  const T = THEMES.light, t = typesetter();
  const h = helix(days, { cx: 1040, top: 110, span: 420, R: 150, perTurn: 91, animate: false, T });
  const body = [
    t.text('mono', 'BIOMEDICAL ENGINEERING  \u00b7  DARTMOUTH COLLEGE', 18, 90, 130, { tracking: 0.12, fill: T.muted }),
    t.text('serif', 'Ceyhun Olcan', 120, 84, 300, { tracking: -0.01, fill: T.ink }),
    t.text('italic', 'Reliable, fairness-audited AI', 38, 90, 370, { fill: T.muted }),
    t.text('italic', 'for behavioral health.', 38, 90, 418, { fill: T.muted }),
    t.text('mono', 'GITHUB.COM/CEYHUNOLCAN', 16, 90, 540, { tracking: 0.12, fill: T.muted }),
    h.svg,
  ].join('');
  return svgDoc(1280, 640, 'Ceyhun Olcan', h.css, t.defsSvg(), body, T.bg);
}

// ---------- papers: curated list plus anything new on ORCID ----------
const normDoi = (d) => (d || '').toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').trim();
async function orcidWorks() {
  try {
    const r = await fetch(`https://pub.orcid.org/v3.0/${cfg.orcid}/works`, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    return (j.group || []).map((g) => {
      const w = g['work-summary'][0];
      const doi = (w['external-ids']?.['external-id'] || []).find((e) => e['external-id-type'] === 'doi')?.['external-id-value'];
      return {
        doi: normDoi(doi), title: w.title?.title?.value, type: w.type,
        venue: w['journal-title']?.value || '', year: Number(w['publication-date']?.year?.value) || 0,
      };
    }).filter((w) => w.doi && w.title && ['preprint', 'journal-article', 'conference-paper'].includes(w.type));
  } catch (e) {
    console.warn('ORCID unavailable, using curated list only:', e.message);
    return [];
  }
}

function paperMd(p) {
  const links = [`[Paper](https://doi.org/${p.doi})`, ...Object.entries(p.links || {}).map(([k, v]) => `[${k}](${v})`)].join(' · ');
  const title = /[.?!]$/.test(p.title) ? p.title : p.title + '.';
  const where = [p.venue ? `*${p.venue}*` : '', p.year || ''].filter(Boolean).join(', ');
  const meta = [p.authors, where].filter(Boolean).join(' ').replace(/\.\s*$/, '');
  return `**${title}**<br>\n${meta}. ${links}` + (p.note ? `<br>\n<sub>${p.note}</sub>` : '');
}

async function papers() {
  const curated = cfg.papers.map((p) => ({ ...p, doi: normDoi(p.doi) }));
  const known = new Set(curated.map((p) => p.doi.replace(/\/v\d+$/, '')));
  const fresh = (await orcidWorks())
    .filter((w) => !known.has(w.doi.replace(/\/v\d+$/, '')))
    .filter((w, i, a) => a.findIndex((x) => x.title.toLowerCase() === w.title.toLowerCase()) === i)
    .sort((a, b) => b.year - a.year);
  return [...fresh, ...curated].slice(0, cfg.maxPapers).map(paperMd).join('\n\n');
}

// ---------- main ----------
const strip = (s) => s.replace(/[\u2013\u2014]/g, '-');
const days = await contributions();
fs.mkdirSync('assets/repos', { recursive: true });
for (const theme of ['light', 'dark']) {
  fs.writeFileSync(`assets/header-${theme}.svg`, profileHeader(theme, days));
  for (const repo of cfg.repos) fs.writeFileSync(`assets/repos/${repo.name}-${theme}.svg`, repoHeader(repo, theme, days));
}
const card = socialCard(days);
fs.writeFileSync('assets/social-preview.png', new Resvg(card, { fitTo: { mode: 'width', value: 1280 } }).render().asPng());
const readme = fs.readFileSync('README.template.md', 'utf8')
  .replace('{{PAPERS}}', strip(await papers()))
  .replace('{{ORCID}}', cfg.orcid);
fs.writeFileSync('README.md', readme);
console.log(`Built: ${days.filter((d) => d.count > 0).length} active days of ${days.length}.`);

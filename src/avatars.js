// Avatares de jugador (personajes de época) y retratos temáticos de cada rol secreto.
// Todo es SVG dibujado para este proyecto: nada del arte original del juego ni parecidos reales.
// Sin dependencias del DOM: la sala (room.js) lo importa para validar el avatar elegido.

const INK = '#2a2219';
const PAPER = '#ece0c2';
// Fondos neutros a propósito: ni azul liberal ni rojo fascista, para no insinuar bando.
const BG = ['#7d8a5e', '#8a6f9e', '#5f8585', '#a8875a', '#5f6f7f', '#9a7466', '#6d7d55', '#7a6a8a'];
const SKIN = ['#f1cba8', '#ddab82', '#b98159', '#8f5d3d', '#62402a'];

// Piezas (viewBox 64x64). c = colores del personaje.
const P = {
  body: (c) => `<path d="M9 64c0-13 10-20 23-20s23 7 23 20z" fill="${c.coat}"/><path d="M26 44l6 8 6-8z" fill="${PAPER}"/>`,
  head: (c) => `<rect x="27.5" y="36" width="9" height="9" fill="${c.skin}"/><ellipse cx="32" cy="28" rx="11" ry="12.5" fill="${c.skin}"/>`,
  face: () => `<circle cx="28" cy="28.5" r="1.4" fill="${INK}"/><circle cx="36" cy="28.5" r="1.4" fill="${INK}"/><path d="M29.5 34.5q2.5 1.4 5 0" stroke="${INK}" stroke-width="1.2" fill="none" stroke-linecap="round"/>`,
  short: (c) => `<path d="M21 27c0-9 5-14.5 11-14.5S43 18 43 27c-2-5-6-7.5-11-7.5S23 22 21 27z" fill="${c.hair}"/>`,
  bob: (c) => `<path d="M19.5 33c0-14 6-20.5 12.5-20.5S44.5 19 44.5 33v5h-4.5V24c-3.5-.5-6.5-2.5-8-5-1.5 2.5-4.5 4.5-8 5v14h-4.5z" fill="${c.hair}"/>`,
  bun: (c) => `${P.short(c)}<circle cx="32" cy="12" r="5" fill="${c.hair}"/>`,
  bowler: (c) => `<path d="M22 21.5c0-8 4.5-12 10-12s10 4 10 12z" fill="${c.hat}"/><path d="M17 21.5h30" stroke="${c.hat}" stroke-width="3" stroke-linecap="round"/>`,
  fedora: (c) => `<path d="M15 21c5 2.5 29 2.5 34 0l-2.5 3.5h-29z" fill="${c.hat}"/><path d="M22 21.5c0-6.5 3-11.5 10-11.5s10 5 10 11.5c-4 1-16 1-20 0z" fill="${c.hat}"/><path d="M22.3 18.5h19.4v2.4H22.3z" fill="${c.band}"/>`,
  tophat: (c) => `<path d="M23 3.5h18v17H23z" fill="${c.hat}"/><path d="M17 20h30v3.2H17z" fill="${c.hat}"/><path d="M23 16.5h18v2.6H23z" fill="${c.band}"/>`,
  beret: (c) => `<ellipse cx="30" cy="17" rx="13.5" ry="5.2" fill="${c.hat}"/><circle cx="30" cy="11.3" r="1.6" fill="${c.hat}"/>`,
  newsboy: (c) => `<path d="M20 21c0-7.5 5-11 12-11s12 3.5 12 11z" fill="${c.hat}"/><path d="M29 20.5h19c-2 3.2-8 4.2-19 3z" fill="${c.band}"/>`,
  cloche: (c) => `<path d="M19 28c0-11.5 6-17 13-17s13 5.5 13 17c-4-2.2-9-3.2-13-3.2S23 25.8 19 28z" fill="${c.hat}"/><path d="M20.5 22.5c6-2 17-2 23 0" stroke="${c.band}" stroke-width="2.2" fill="none"/>`,
  mustache: (c) => `<path d="M26.5 33.8c2-2.4 4.2-2.4 5.5-1.1 1.3-1.3 3.5-1.3 5.5 1.1-2 1-4.2 1-5.5 0-1.3 1-3.5 1-5.5 0z" fill="${c.hair}"/>`,
  beard: (c) => `<path d="M21 29c0 10 5 15.5 11 15.5S43 39 43 29c-2 4.5-6 6.5-11 6.5S23 33.5 21 29z" fill="${c.hair}"/>`,
  glasses: () => `<g fill="none" stroke="${INK}" stroke-width="1.4"><circle cx="28" cy="28.5" r="3.7"/><circle cx="36" cy="28.5" r="3.7"/><path d="M31.7 28.5h.6"/></g>`,
  monocle: () => `<circle cx="36" cy="28.5" r="3.8" fill="none" stroke="#c99b3f" stroke-width="1.4"/><path d="M39.6 30c2 4 2 9-1 13" fill="none" stroke="#c99b3f" stroke-width=".9"/>`,
  pipe: () => `<path d="M35 35.5h6.5v3.5" stroke="#4a2f1a" stroke-width="2" fill="none" stroke-linecap="round"/><rect x="39.5" y="37" width="5" height="6" rx="1.2" fill="#4a2f1a"/>`,
  bowtie: (c) => `<path d="M25.5 44.5l6.5 3.3-6.5 3.3zM38.5 44.5 32 47.8l6.5 3.3z" fill="${c.accent}"/>`,
  tie: (c) => `<path d="M31 44.5h2l1.6 3-2.6 13-2.6-13z" fill="${c.accent}"/>`,
  pearls: () => `<g fill="${PAPER}">${[24.5, 27.5, 30.5, 33.5, 36.5, 39.5].map((x, i) => `<circle cx="${x}" cy="${44 + (i === 0 || i === 5 ? -1 : i === 1 || i === 4 ? 0 : .6)}" r="1.3"/>`).join('')}</g>`,
  scarf: (c) => `<path d="M23.5 41.5c4 3.4 13 3.4 17 0l1.2 4.2c-5.5 3.4-13.9 3.4-19.4 0z" fill="${c.accent}"/><path d="M36 45l3 9 3-1-2-9z" fill="${c.accent}"/>`,
  lips: () => `<path d="M29.6 34.4q2.4 1.6 4.8 0" stroke="#a63a2b" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
  earring: () => `<circle cx="21.3" cy="33" r="1.4" fill="#c99b3f"/>`,
};

function draw(c, parts) {
  // El orden importa: pelo largo detrás de la cara; sombreros y accesorios encima.
  const back = parts.filter((p) => p === 'bob').map((p) => P[p](c)).join('');
  const front = parts.filter((p) => p !== 'bob').map((p) => P[p](c)).join('');
  return `<rect width="64" height="64" fill="${c.bg}"/>${back}${P.body(c)}${P.head(c)}${P.face()}${front}`;
}

const DEFS = [
  ['periodista', 'Periodista', { bg: 0, skin: 0, hair: '#5a3a22', coat: '#4a4f45', hat: '#6b5b45', band: '#54473a', accent: '#8c2f22' }, ['short', 'newsboy', 'tie']],
  ['banquera', 'Banquera', { bg: 1, skin: 1, hair: '#2c1d14', coat: '#3b3346', hat: '#2f2a38', band: '#c99b3f', accent: '#c99b3f' }, ['bob', 'cloche', 'pearls', 'lips']],
  ['profesor', 'Profesor', { bg: 2, skin: 2, hair: '#d9d2c4', coat: '#5a4a3a', accent: '#2d4e6a' }, ['short', 'beard', 'glasses', 'bowtie']],
  ['aristocrata', 'Aristócrata', { bg: 3, skin: 0, hair: '#3a2a1e', coat: '#22201d', hat: '#1b1916', band: '#7a2a20', accent: '#22201d' }, ['short', 'mustache', 'monocle', 'tophat', 'bowtie']],
  ['detective', 'Detective', { bg: 4, skin: 3, hair: '#1f1712', coat: '#6e6250', hat: '#4a4036', band: '#2a241f', accent: '#5a2a22' }, ['short', 'mustache', 'fedora', 'tie']],
  ['pintora', 'Pintora', { bg: 5, skin: 1, hair: '#8a3b1f', coat: '#3f5a4a', hat: '#2a2a2a', accent: '#c99b3f' }, ['bob', 'beret', 'scarf', 'earring']],
  ['obrera', 'Obrera', { bg: 6, skin: 4, hair: '#1a1410', coat: '#3c5266', accent: '#a65a2b' }, ['bun', 'scarf']],
  ['diplomatico', 'Diplomático', { bg: 7, skin: 2, hair: '#2a1d14', coat: '#2b2d33', hat: '#1e1e22', band: '#1e1e22', accent: '#6a4a8a' }, ['short', 'mustache', 'bowler', 'tie']],
  ['poeta', 'Poeta', { bg: 0, skin: 1, hair: '#2b1e16', coat: '#5b4636', accent: '#7a2a3a' }, ['short', 'pipe', 'scarf']],
  ['cantante', 'Cantante', { bg: 1, skin: 3, hair: '#120d0a', coat: '#5a2a3a', accent: '#c99b3f' }, ['bob', 'pearls', 'lips', 'earring']],
  ['abogada', 'Abogada', { bg: 2, skin: 0, hair: '#6b4a2e', coat: '#2f3438', accent: '#7a6a3a' }, ['bun', 'glasses', 'tie']],
  ['sindicalista', 'Sindicalista', { bg: 3, skin: 2, hair: '#3a2a1e', coat: '#4a3a2e', hat: '#3a3a34', band: '#2a2a26', accent: '#8c2f22' }, ['short', 'beard', 'newsboy']],
  ['cientifica', 'Científica', { bg: 4, skin: 4, hair: '#1a1410', coat: '#e2dccb', accent: '#2d4e6a' }, ['bob', 'glasses']],
  ['capitan', 'Capitán de barco', { bg: 5, skin: 1, hair: '#e6e0d2', coat: '#26324a', hat: '#26324a', band: '#c99b3f', accent: '#c99b3f' }, ['short', 'beard', 'fedora']],
  ['actriz', 'Actriz', { bg: 6, skin: 2, hair: '#d8b25a', coat: '#3a2a3a', hat: '#6a2a3a', band: '#d8b25a', accent: '#8a6f9e' }, ['bob', 'cloche', 'scarf', 'lips']],
  ['medico', 'Médico', { bg: 7, skin: 3, hair: '#6a6a66', coat: '#d9d3c4', accent: '#4a6a5a' }, ['short', 'glasses', 'mustache', 'tie']],
];

export const AVATAR_IDS = DEFS.map((d) => d[0]);
export const AVATAR_NAMES = Object.fromEntries(DEFS.map((d) => [d[0], d[1]]));
const AVATAR_ART = Object.fromEntries(DEFS.map(([id, , c, parts]) =>
  [id, draw({ ...c, bg: BG[c.bg], skin: SKIN[c.skin] }, parts)]));

export const isAvatar = (id) => typeof id === 'string' && Object.hasOwn(AVATAR_ART, id);

// Avatar estable a partir de un texto (id de jugador) para quien no haya elegido.
export function defaultAvatar(seed = '') {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_IDS[h % AVATAR_IDS.length];
}

export function avatarSvg(id, cls = '') {
  const key = isAvatar(id) ? id : defaultAvatar(id);
  return `<svg class="avatar ${cls}" viewBox="0 0 64 64" role="img" aria-label="${AVATAR_NAMES[key]}">${AVATAR_ART[key]}</svg>`;
}

// ---------- Retratos de rol ----------
// Liberal: ciudadano con sombrero y la balanza en la solapa.
// Fascista: figura de abrigo cerrado y gorra de plato, con la mirada en sombra.
// Hitler: la misma silueta, en sombra total y con antifaz: el enemigo oculto entre todos.
const ROLE_ART = {
  liberal: `
    <defs><radialGradient id="rl" cx=".5" cy=".35" r=".75"><stop offset="0" stop-color="#4a8fb3"/><stop offset="1" stop-color="#15384a"/></radialGradient></defs>
    <rect width="64" height="64" fill="url(#rl)"/>
    <path d="M9 64c0-13 10-20 23-20s23 7 23 20z" fill="#d3e5ec"/>
    <path d="M26 44l6 9 6-9z" fill="#fff"/><path d="M31 46h2l1.4 3-2.4 11-2.4-11z" fill="#2d6a8a"/>
    <path d="M17 50l9-6 6 9-6 11H17zM47 50l-9-6-6 9 6 11h9z" fill="#b9d2dc"/>
    <g stroke="#2d6a8a" stroke-width="1" fill="none"><path d="M43 52v6M40 54h6"/><path d="M40 54l-1.4 3h2.8zM46 54l-1.4 3h2.8z"/></g>
    <rect x="27.5" y="36" width="9" height="9" fill="#ddab82"/><ellipse cx="32" cy="28" rx="11" ry="12.5" fill="#ddab82"/>
    <circle cx="28" cy="28.5" r="1.4" fill="${INK}"/><circle cx="36" cy="28.5" r="1.4" fill="${INK}"/>
    <path d="M29 34q3 2 6 0" stroke="${INK}" stroke-width="1.3" fill="none" stroke-linecap="round"/>
    <path d="M15 21c5 2.5 29 2.5 34 0l-2.5 3.5h-29z" fill="#e8f0f3"/><path d="M22 21.5c0-6.5 3-11.5 10-11.5s10 5 10 11.5c-4 1-16 1-20 0z" fill="#e8f0f3"/><path d="M22.3 18.5h19.4v2.4H22.3z" fill="#2d6a8a"/>`,
  fascist: `
    <defs><radialGradient id="rf" cx=".5" cy=".35" r=".75"><stop offset="0" stop-color="#c24a36"/><stop offset="1" stop-color="#3a120c"/></radialGradient></defs>
    <rect width="64" height="64" fill="url(#rf)"/>
    <path d="M8 64c0-14 10-21 24-21s24 7 24 21z" fill="#1f1714"/>
    <path d="M22 43l10 4 10-4 2 7-12 4-12-4z" fill="#2c211c"/>
    <g fill="#c99b3f"><circle cx="32" cy="55" r="1.2"/><circle cx="32" cy="60" r="1.2"/></g>
    <path d="M38.5 48.5l2.4 1.6 1.6-2.4 1.6 2.4 2.4-1.6v4h-8z" fill="#c99b3f"/>
    <rect x="27.5" y="36" width="9" height="9" fill="#b98159"/><ellipse cx="32" cy="29" rx="11" ry="12.5" fill="#b98159"/>
    <path d="M21 25h22v6c-4-1.5-18-1.5-22 0z" fill="#000" opacity=".45"/>
    <path d="M26 29h4M34 29h4" stroke="#f4d6ca" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M28.5 35.5h7" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M17 19c2-9 8-12.5 15-12.5S45 10 47 19z" fill="#2a1d16"/><path d="M16 19h32l-1.5 3.5h-29z" fill="#3a2a20"/>
    <path d="M20.5 22.5c4 2.5 19 2.5 23 0l1.5 3c-6 2.5-20 2.5-26 0z" fill="#0d0a08"/>
    <circle cx="32" cy="14" r="2.2" fill="#c99b3f"/>`,
  hitler: `
    <defs><radialGradient id="rh" cx=".5" cy=".3" r=".8"><stop offset="0" stop-color="#5a1a10"/><stop offset="1" stop-color="#0c0504"/></radialGradient></defs>
    <rect width="64" height="64" fill="url(#rh)"/>
    <path d="M8 64c0-14 10-21 24-21s24 7 24 21z" fill="#0a0706"/>
    <path d="M22 43l10 4 10-4 2 7-12 4-12-4z" fill="#161110"/>
    <rect x="27.5" y="36" width="9" height="9" fill="#120c0a"/><ellipse cx="32" cy="29" rx="11" ry="12.5" fill="#120c0a"/>
    <path d="M18.5 26.5c4-3 9-3 13.5.5 4.5-3.5 9.5-3.5 13.5-.5 0 5.5-2.5 8.5-6.5 8.5-3.5 0-4.5-2.5-7-2.5s-3.5 2.5-7 2.5c-4 0-6.5-3-6.5-8.5z" fill="#7c1d13"/>
    <ellipse cx="26.5" cy="29.3" rx="2.6" ry="1.4" fill="#ffcf8a"/><ellipse cx="37.5" cy="29.3" rx="2.6" ry="1.4" fill="#ffcf8a"/>
    <path d="M17 19c2-9 8-12.5 15-12.5S45 10 47 19z" fill="#050303"/><path d="M16 19h32l-1.5 3.5h-29z" fill="#120c0a"/>
    <path d="M20.5 22.5c4 2.5 19 2.5 23 0l1.5 3c-6 2.5-20 2.5-26 0z" fill="#000"/>
    <circle cx="32" cy="14" r="2.2" fill="#7c1d13"/>`,
};
export const ROLE_TITLES = { liberal: 'El ciudadano', fascist: 'El conspirador', hitler: 'La sombra' };

let portraitSeq = 0;
export function rolePortrait(role, cls = '') {
  // Cada SVG necesita ids de degradado únicos en la página.
  const n = ++portraitSeq;
  const art = ROLE_ART[role].replace(/id="(r[lfh])"/, `id="$1${n}"`).replace(/url\(#(r[lfh])\)/, `url(#$1${n})`);
  return `<svg class="portrait ${cls}" viewBox="0 0 64 64" role="img" aria-label="${ROLE_TITLES[role]}">${art}</svg>`;
}

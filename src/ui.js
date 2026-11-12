// Interfaz: pantallas de inicio, conexión, sala de espera y partida. Repinta #app con
// innerHTML a partir del estado `ui`. Las animaciones (revelado de rol, recuento de votos,
// leyes promulgadas) van en una capa aparte (#layer) que solo se repinta cuando cambia,
// para que un repintado normal no las reinicie.
import { HostRoom, randomId, cleanName } from './room.js';
import { startHost, joinHost, makeCode, normalizeCode, isValidCode, CODE_LEN } from './net.js';
import { POWER_NAMES, MIN_PLAYERS, MAX_PLAYERS } from './game.js';
import { AVATAR_IDS, AVATAR_NAMES, avatarSvg, rolePortrait, isAvatar, ROLE_TITLES } from './avatars.js';
import { detectEvents } from './fx.js';
import { play, unlock, isMuted, toggleMute } from './sound.js';

const app = document.getElementById('app');
const layer = document.getElementById('layer'); // no existe en las pruebas: entonces va dentro de #app
const params = new URLSearchParams(location.search);
const DEV = params.has('dev');

function store(getStorage) {
  return {
    get(k) { try { return JSON.parse(getStorage().getItem(k)); } catch { return null; } },
    set(k, v) { try { getStorage().setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { getStorage().removeItem(k); } catch {} },
  };
}
const local = store(() => localStorage);
const session = store(() => sessionStorage);

function initialAvatar() {
  const saved = local.get('sh-avatar');
  return isAvatar(saved) ? saved : AVATAR_IDS[Math.floor(Math.random() * AVATAR_IDS.length)];
}

const ui = {
  screen: 'home', // home | connecting | lobby | game
  status: '',
  error: '',
  toast: '',
  form: { name: local.get('sh-name') ?? '', code: normalizeCode(params.get('sala')), avatar: initialAvatar() },
  avatarOpen: false, // selector de avatar desplegado en la sala
  code: null,
  isHost: false,
  you: null,
  room: null,
  game: null,
  roleOpen: false,
  logOpen: false,
  sel: null,
  selKey: '',
  voteSel: null,
  overlays: [], // cola de animaciones: role | vote | policy | execute
  overlayKey: '',
  fresh: null, // ley recién colocada en el tablero (para animarla)
  roleHeard: false, // el sonido del rol solo suena la primera vez que se abre el sobre
};
let net = null;
let room = null;
let botTimer = null;
let toastTimer = null;
let overlayTimer = null;
let overlaySeq = 0;

const ROLE = { liberal: 'Liberal', fascist: 'Fascista', hitler: 'Hitler' };
const POLICY = { liberal: 'Liberal', fascist: 'Fascista' };
const STATUS = {
  connecting: 'Conectando…',
  online: 'Conectado',
  reconnecting: 'Reconectando…',
  notfound: 'No se encuentra la sala. Reintentando…',
};
const POWER_HELP = {
  investigate: 'Elige a un jugador para ver en secreto su afiliación (liberal o fascista). No verás si es Hitler.',
  special: 'Elige quién será el próximo presidente. Después, la presidencia vuelve a seguir el orden normal.',
  execute: 'Elige a un jugador para eliminarlo. Si es Hitler, ganan los liberales.',
};
const POWER_BUTTON = { investigate: 'Investigar', special: 'Nombrar presidente', execute: 'Ejecutar' };
const POWER_SHORT = { peek: 'Mirar 3 leyes', investigate: 'Investigar', special: 'Elección especial', execute: 'Ejecución' };
const AUTO_CLOSE = { vote: 3600, policy: 2800, execute: 3000, pres: 2200, chan: 2200 }; // ms; el revelado de rol se cierra a mano
const ROLE_SOUND = { liberal: 'roleLiberal', fascist: 'roleFascist', hitler: 'roleHitler' };
// Sonido de cada aviso, al aparecer en pantalla (así va sincronizado con la animación).
const OVERLAY_SOUND = {
  vote: (o) => (o.vote.passed ? 'votePass' : 'voteFail'),
  policy: (o) => (o.policy === 'liberal' ? 'policyLiberal' : 'policyFascist'),
  execute: () => 'execute',
  pres: () => 'president',
  chan: () => 'chancellor',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- Iconos y cartas (dibujo propio, sin el arte original del juego) ----------

const ICONS = {
  scales: '<path d="M24 7v33M14 40h20M9 14h30"/><path d="M9 14 3 28h12zM39 14l-6 14h12z"/><circle cx="24" cy="7" r="2.5"/>',
  crown: '<path d="M7 35V15l9 9 8-14 8 14 9-9v20z"/><path d="M7 41h34"/>',
  mask: '<path d="M4 17c6-4 14-4 20 1 6-5 14-5 20-1 0 10-4 16-10 16-5 0-7-4-10-4s-5 4-10 4C8 33 4 27 4 17z"/><ellipse cx="15" cy="22" rx="4" ry="2.5"/><ellipse cx="33" cy="22" rx="4" ry="2.5"/>',
  eye: '<path d="M4 24c6-9 13-13 20-13s14 4 20 13c-6 9-13 13-20 13S10 33 4 24z"/><circle cx="24" cy="24" r="6"/>',
  lens: '<circle cx="20" cy="20" r="11"/><path d="m28 28 13 13"/>',
  ballot: '<path d="M8 23h32v18H8z"/><path d="M16 23V7h16v16M14 30h20"/>',
  target: '<circle cx="24" cy="24" r="14"/><circle cx="24" cy="24" r="4"/><path d="M24 3v10M24 35v10M3 24h10M35 24h10"/>',
  flag: '<path d="M12 44V5M12 7h24l-6 8 6 8H12"/>',
  star: '<path d="m24 9 4.4 9.6 10.6 1.2-7.9 7.1 2.2 10.4L24 32l-9.3 5.3 2.2-10.4L9 19.8l10.6-1.2z"/>',
};
const icon = (n, cls = '') =>
  `<svg class="ico ${cls}" viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">${ICONS[n]}</svg>`;
const POWER_ICON = { peek: 'eye', investigate: 'lens', special: 'ballot', execute: 'target' };
const ROLE_ICON = { liberal: 'scales', fascist: 'crown', hitler: 'mask' };
const PARTY_ICON = { liberal: 'scales', fascist: 'crown' };
const partyOf = (role) => (role === 'liberal' ? 'liberal' : 'fascist');

const policyCard = (kind, extra = '', i = 0) => `<span class="pcard ${kind} ${extra}" style="--i:${i}">${icon(PARTY_ICON[kind])}<b>${POLICY[kind]}</b></span>`;
const voteCard = (ja, extra = '') => `<span class="vcard ${ja ? 'ja' : 'nein'} ${extra}"><b>${ja ? '¡Ja!' : 'Nein'}</b></span>`;
const cardBack = (extra = '') => `<span class="cardback ${extra}"></span>`;

function roleCardHtml(role) {
  return `<span class="rcard role-card ${role}">${rolePortrait(role)}<small>${ROLE_TITLES[role]}</small><b>${ROLE[role]}</b></span>`;
}

// Avatar de un jugador (los avatares viven en la sala, no en la lógica del juego).
const avatarOf = (id) => ui.room?.players.find((p) => p.id === id)?.avatar ?? id;
const avatarFor = (id, cls = '') => avatarSvg(avatarOf(id), cls);

function avatarPicker() {
  return `<div class="avatar-grid" role="group" aria-label="Elige tu avatar">${AVATAR_IDS.map((id) => {
    const sel = id === ui.form.avatar;
    return `<button class="av-pick ${sel ? 'sel' : ''}" data-a="pickAvatar" data-v="${id}" aria-pressed="${sel}" title="${AVATAR_NAMES[id]}">${avatarSvg(id)}</button>`;
  }).join('')}</div>`;
}
function partyCardHtml(role) {
  const party = partyOf(role);
  return `<span class="rcard party ${party}">${icon(PARTY_ICON[party])}<small>Afiliación</small><b>Partido ${party === 'liberal' ? 'liberal' : 'fascista'}</b></span>`;
}

function myToken() {
  let t = session.get('sh-token');
  if (!t) { t = randomId(24); session.set('sh-token', t); }
  return t;
}

function peerMissing() {
  return !globalThis.Peer ? 'No se ha podido cargar la librería de red (PeerJS). Revisa tu conexión y recarga la página.' : '';
}

// ---------- Anfitrión ----------

function hostGame(saved) {
  const name = cleanName(ui.form.name);
  if (!saved && !name) return showError('Escribe tu nombre para crear la partida.');
  const missing = peerMissing();
  if (missing) return showError(missing);
  if (name) local.set('sh-name', name);
  const code = saved ? saved.code : makeCode();
  const hooks = {
    code,
    send: (c, m) => net?.send(c, m),
    close: (c) => net?.close(c),
    onChange: hostChanged,
    onHostMessage: (m) => { if (m.t === 'error') toast(m.message); },
  };
  room = saved
    ? new HostRoom(hooks, saved.room)
    : new HostRoom({ ...hooks, hostName: name, hostToken: randomId(24), hostAvatar: ui.form.avatar, dev: DEV });
  Object.assign(ui, { isHost: true, code, you: room.hostId, status: 'connecting', error: '' });
  session.set('sh-host-active', true);
  net = startHost(code, {
    onStatus: (s) => { if (s !== ui.status) { ui.status = s; render(); } },
    onData: (id, m) => room?.handle(id, m),
    onClose: (id) => room?.disconnect(id),
    onFatal: (msg) => { leave(true); showError(msg); },
  });
  hostChanged(room);
}

function hostChanged(r) {
  if (r !== room) return;
  local.set('sh-host', { code: r.code, room: r.serialize() });
  applyState(r.publicState(r.hostId));
  if (r.dev && !botTimer) {
    botTimer = setTimeout(() => { botTimer = null; if (r === room) r.stepBots(); }, 1100);
  }
}

// ---------- Cliente ----------

function joinGame(codeIn, nameIn) {
  const code = normalizeCode(codeIn);
  const name = cleanName(nameIn);
  if (!name) return showError('Escribe tu nombre para unirte.');
  if (!isValidCode(code)) return showError(`El código de sala tiene ${CODE_LEN} letras o números.`);
  const missing = peerMissing();
  if (missing) return showError(missing);
  local.set('sh-name', name);
  session.set('sh-client', { code, name });
  Object.assign(ui, { isHost: false, code, screen: 'connecting', status: 'connecting', error: '' });
  const token = myToken();
  net = joinHost(code, {
    onStatus: (s) => { if (s !== ui.status) { ui.status = s; render(); } },
    onOpen: () => net?.send({ t: 'hello', name, token, avatar: ui.form.avatar }),
    onData: onClientMessage,
    onFatal: (msg) => { leave(); showError(msg); },
  });
  history.replaceState(null, '', `${location.pathname}?sala=${code}${DEV ? '&dev' : ''}`);
  render();
}

function onClientMessage(m) {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'welcome') { ui.you = m.you; return; }
  if (m.t === 'state') return applyState(m);
  if (m.t === 'error') {
    if (m.fatal) { leave(); showError(m.message); } else toast(m.message);
    return;
  }
  if (m.t === 'kicked') { leave(); showError(m.message || 'Has salido de la sala.'); }
}

// ---------- Común ----------

function pushOverlay(o) {
  o.n = ++overlaySeq;
  // Si se acumulan muchas (jugadas muy seguidas), se descartan las más antiguas salvo el rol.
  while (ui.overlays.length >= 4) ui.overlays.splice(ui.overlays[0]?.kind === 'role' ? 1 : 0, 1);
  ui.overlays.push(o);
}

function queueEvents(prev, g, events) {
  const ev = (type) => events.find((e) => e.type === type);
  const lv = g.lastVote;
  if (lv && lv.id !== prev.lastVote?.id) pushOverlay({ kind: 'vote', vote: lv });
  if (ev('chancellor')) pushOverlay({ kind: 'chan', id: ev('chancellor').id });
  // Sonidos sin aviso propio: llamada a votar y robar (o mirar) las 3 leyes.
  if (ev('voteCall')) play('voteCall');
  if (ev('draw3')) play('draw3', ev('chancellor') ? 0.4 : 0);
  // Una ley sale "del caos" si no viene de la decisión del canciller (3 fallos o veto aceptado).
  const chaos = prev.phase !== 'chancellorDiscard';
  for (const kind of ['liberal', 'fascist']) {
    if (g[kind] > prev[kind]) {
      const power = kind === 'fascist' && !chaos ? g.powerTrack[g.fascist - 1] : null;
      pushOverlay({ kind: 'policy', policy: kind, chaos, power, over: g.phase === 'gameover' });
      ui.fresh = { kind, idx: g[kind] - 1 };
      setTimeout(() => { ui.fresh = null; }, 1600);
    }
  }
  for (const p of g.players) {
    const before = prev.players.find((x) => x.id === p.id);
    if (before?.alive && !p.alive) pushOverlay({ kind: 'execute', id: p.id });
  }
  if (ev('president')) pushOverlay({ kind: 'pres', id: ev('president').id });
}

function applyState(m) {
  const prev = ui.game;
  const g = m.game;
  const events = detectEvents(prev, g);
  if (g && g.phase !== 'gameover' && (!prev || prev.phase === 'gameover')) {
    // Partida nueva: todo lo secreto empieza oculto y se abre el sobre con el rol.
    ui.roleOpen = false;
    ui.logOpen = false;
    ui.roleHeard = false;
    ui.overHeard = false;
    ui.overlays = [];
    pushOverlay({ kind: 'role', stage: 'sealed' });
    const first = events.find((e) => e.type === 'president');
    if (first) pushOverlay({ kind: 'pres', id: first.id, first: true });
  } else if (g && prev) {
    queueEvents(prev, g, events);
  }
  if (!g) ui.overlays = [];
  ui.room = m.room;
  ui.game = g;
  ui.screen = g ? 'game' : 'lobby';
  const key = g ? [g.phase, g.presidentId, g.chancellorId, g.liberal, g.fascist, g.tracker, g.hand.length].join('|') : '';
  if (key !== ui.selKey) { ui.selKey = key; ui.sel = null; ui.voteSel = null; }
  render();
}

function doAct(action) {
  if (ui.isHost) room?.hostAct(action);
  else net?.send({ t: 'act', action });
}

function leave(keepSaved = false) {
  if (ui.isHost) { if (!keepSaved) local.del('sh-host'); }
  else net?.send({ t: 'leave' });
  session.del('sh-host-active');
  session.del('sh-client');
  clearTimeout(botTimer);
  botTimer = null;
  const old = net;
  net = null;
  room = null;
  setTimeout(() => old?.destroy(), 300);
  Object.assign(ui, { screen: 'home', status: '', code: null, isHost: false, you: null, room: null, game: null, sel: null, voteSel: null, roleOpen: false, logOpen: false, overlays: [] });
  history.replaceState(null, '', location.pathname + (DEV ? '?dev' : ''));
  render();
}

function showError(msg) {
  ui.error = msg;
  ui.screen = 'home';
  render();
}

function toast(msg) {
  ui.toast = msg;
  render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast = ''; render(); }, 3500);
}

function dismissOverlay(n) {
  const o = ui.overlays[0];
  if (!o || (n !== undefined && o.n !== n)) return;
  ui.overlays.shift();
  if (o.kind === 'role') ui.roleOpen = false;
  render();
}

const shareLink = () => `${location.origin}${location.pathname}?sala=${ui.code}`;
const isLocalhost = () => ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

// ---------- Acciones de los botones ----------

const actions = {
  create: () => hostGame(null),
  resume: () => { const s = local.get('sh-host'); if (s) hostGame(s); },
  discardSaved: () => { local.del('sh-host'); render(); },
  join: () => joinGame(ui.form.code, ui.form.name),
  cancel: () => leave(),
  leave: () => {
    if (ui.isHost && !confirm('Si sales, la partida se cierra para todos. ¿Salir?')) return;
    leave();
  },
  copy: async () => {
    try { await navigator.clipboard.writeText(shareLink()); toast('Enlace copiado'); }
    catch { toast('No se pudo copiar: selecciona el enlace y cópialo a mano'); }
  },
  start: () => doAct({ type: 'start' }),
  newGame: () => doAct({ type: 'newGame' }),
  toLobby: () => doAct({ type: 'toLobby' }),
  addBot: () => doAct({ type: 'addBot' }),
  kick: (el) => doAct({ type: 'kick', target: el.dataset.id }),
  toggleRole: () => { ui.roleOpen = !ui.roleOpen; render(); },
  toggleLog: () => { ui.logOpen = !ui.logOpen; render(); },
  select: (el) => { ui.sel = ui.sel === el.dataset.v ? null : el.dataset.v; render(); },
  confirm: (el) => {
    const kind = el.dataset.kind;
    const v = ui.sel;
    if (v == null) return;
    ui.sel = null;
    if (kind === 'nominate' || kind === 'power') doAct({ type: kind, target: v });
    else doAct({ type: kind, index: Number(v) });
  },
  pickVote: (el) => { ui.voteSel = ui.voteSel === el.dataset.v ? null : el.dataset.v; render(); },
  vote: (el) => {
    const v = el.dataset.v || ui.voteSel;
    if (v !== '1' && v !== '0') return;
    ui.voteSel = null;
    play('voteCast');
    doAct({ type: 'vote', vote: v === '1' });
  },
  mute: () => { toggleMute(); render(); },
  veto: () => doAct({ type: 'chancellorDiscard', veto: true }),
  vetoResp: (el) => doAct({ type: 'vetoResponse', agree: el.dataset.v === '1' }),
  ack: () => doAct({ type: 'ack' }),
  pickAvatar: (el) => {
    if (!isAvatar(el.dataset.v)) return;
    ui.form.avatar = el.dataset.v;
    local.set('sh-avatar', ui.form.avatar);
    if (ui.screen !== 'home') {
      ui.avatarOpen = false;
      if (ui.isHost) room?.setAvatar(room.hostId, ui.form.avatar);
      else net?.send({ t: 'avatar', avatar: ui.form.avatar });
    }
    render();
  },
  toggleAvatars: () => { ui.avatarOpen = !ui.avatarOpen; render(); },
  openSeal: () => {
    const o = ui.overlays[0];
    if (o?.kind !== 'role') return;
    o.stage = 'open';
    // Cada rol suena distinto: solo la primera vez por partida, por si alguien escucha.
    const me = ui.game?.players.find((p) => p.id === ui.game.me);
    if (!ui.roleHeard && me) { ui.roleHeard = true; play(ROLE_SOUND[me.role], 0.9); }
    render();
  },
  dismiss: () => dismissOverlay(),
};

function onClick(e) {
  unlock(); // los navegadores solo dejan sonar audio tras un gesto del usuario
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  actions[el.dataset.a]?.(el);
}
app.addEventListener('click', onClick);
layer?.addEventListener('click', (e) => {
  // Tocar el fondo de un aviso automático lo cierra antes de tiempo.
  if (e.target.classList?.contains('ov') && ui.overlays[0] && ui.overlays[0].kind !== 'role') return dismissOverlay();
  onClick(e);
});
app.addEventListener('input', (e) => {
  if (e.target.id === 'name') ui.form.name = e.target.value;
  if (e.target.id === 'code') {
    ui.form.code = normalizeCode(e.target.value);
    if (e.target.value !== ui.form.code) e.target.value = ui.form.code;
  }
});
app.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'code') actions.join();
  if (e.target.id === 'name') (ui.form.code ? actions.join : actions.create)();
});
document.addEventListener?.('keydown', (e) => {
  unlock();
  if (e.key === 'Escape' && ui.overlays[0] && ui.overlays[0].kind !== 'role') dismissOverlay();
});

// ---------- Vistas ----------

function render() {
  const focused = document.activeElement?.id;
  const views = { home: viewHome, connecting: viewConnecting, lobby: viewLobby, game: viewGame };
  app.innerHTML = views[ui.screen]() + renderLayer() + (ui.toast ? `<div class="toast" role="status">${esc(ui.toast)}</div>` : '');
  if (focused) document.getElementById(focused)?.focus();
}

function renderLayer() {
  const o = ui.screen === 'game' && ui.game ? ui.overlays[0] ?? null : null;
  const over = ui.screen === 'game' && ui.game?.phase === 'gameover';
  const key = o ? `${o.n}:${o.stage ?? ''}` : over ? 'over' : '';
  const html = o ? overlayHtml(o) : '';
  if (key !== ui.overlayKey) {
    ui.overlayKey = key;
    if (o && !o.stage) play(OVERLAY_SOUND[o.kind]?.(o));
    // Victoria o derrota suena cuando ya no queda ningún aviso delante.
    if (key === 'over' && !ui.overHeard) {
      ui.overHeard = true;
      const g = ui.game;
      const me = g.players.find((p) => p.id === g.me);
      const won = g.winner === 'liberal' ? me?.role === 'liberal' : me?.role !== 'liberal';
      play(won ? 'victory' : 'defeat', 0.2);
    }
    clearTimeout(overlayTimer);
    if (o && AUTO_CLOSE[o.kind]) {
      const n = o.n;
      overlayTimer = setTimeout(() => dismissOverlay(n), AUTO_CLOSE[o.kind]);
    }
    if (layer) {
      layer.innerHTML = html;
      document.body?.classList.toggle('has-overlay', !!o);
      layer.querySelector('[data-a]')?.focus?.();
    }
  }
  return layer ? '' : html;
}

const footer = () => `<footer>Adaptación no comercial de <a href="https://www.secrethitler.com" target="_blank" rel="noopener">Secret Hitler</a> (Goat, Wolf &amp; Cabbage), con licencia CC BY-NC-SA 4.0. Ilustraciones propias.</footer>`;

function viewHome() {
  const saved = local.get('sh-host');
  const invited = isValidCode(ui.form.code);
  const createCard = `
    <button class="${invited ? 'ghost' : 'primary'}" data-a="create">Crear partida nueva</button>`;
  const joinCard = `
    <label>Código de sala<input id="code" maxlength="${CODE_LEN}" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(ui.form.code)}" placeholder="ABCDE"></label>
    <button class="${invited ? 'primary' : ''}" data-a="join">Unirse a la partida</button>`;
  return `
    <header class="hero">
      <div class="hero-fan" aria-hidden="true">${policyCard('liberal')}${roleCardHtml('hitler')}${policyCard('fascist')}</div>
      <h1>Secret Hitlet</h1>
      <p>Liberales contra fascistas. Uno de vosotros es Hitler. De 5 a 10 jugadores, en el navegador.</p>
    </header>
    ${ui.error ? `<p class="error" role="alert">${esc(ui.error)}</p>` : ''}
    <section class="panel">
      <div class="who">
        ${avatarSvg(ui.form.avatar, 'me-avatar')}
        <label>Tu nombre<input id="name" maxlength="20" autocomplete="nickname" value="${esc(ui.form.name)}" placeholder="Cómo te verán los demás"></label>
      </div>
      <p class="label">Elige tu avatar</p>
      ${avatarPicker()}
      ${invited ? joinCard + '<p class="or">o</p>' + createCard : createCard + '<p class="or">o únete a una</p>' + joinCard}
    </section>
    ${saved ? `<section class="panel"><p>Tienes una partida guardada como anfitrión (sala <b>${esc(saved.code)}</b>).</p>
      <div class="row"><button data-a="resume">Reanudar</button><button class="ghost" data-a="discardSaved">Descartar</button></div></section>` : ''}
    ${rulesBox()}
    ${footer()}`;
}

function viewConnecting() {
  return `
    <section class="panel center">
      <h2>Sala ${esc(ui.code)}</h2>
      <p class="pulse">${STATUS[ui.status] ?? 'Conectando…'}</p>
      <p class="hint">Si tarda mucho, comprueba que el código es correcto y que el anfitrión tiene la partida abierta.</p>
      <button class="ghost" data-a="cancel">Cancelar</button>
    </section>`;
}

function topbar() {
  const label = ui.isHost && ui.status === 'online' ? 'Anfitrión · en línea' : STATUS[ui.status] ?? '';
  return `
    <header class="topbar">
      <span class="room">Sala <b>${esc(ui.code)}</b></span>
      <span class="status ${esc(ui.status)}">${label}</span>
      <button class="ghost small" data-a="mute" aria-pressed="${isMuted()}" title="${isMuted() ? 'Activar sonido' : 'Silenciar'}">${isMuted() ? '🔇' : '🔊'}</button>
      <button class="ghost small" data-a="leave">Salir</button>
    </header>`;
}

function viewLobby() {
  const r = ui.room;
  const n = r.players.length;
  const missing = MIN_PLAYERS - n;
  const list = r.players.map((p) => `
    <li class="${p.connected ? '' : 'off'}">
      <span class="who-row">${avatarSvg(p.avatar, 'sm')}<span>${esc(p.name)}${p.id === ui.you ? ' <i>(tú)</i>' : ''}</span></span>
      <span class="tags">
        ${p.host ? '<b class="tag">Anfitrión</b>' : ''}${p.bot ? '<b class="tag">Bot</b>' : ''}
        ${p.connected ? '' : '<b class="tag off">Desconectado</b>'}
        ${p.id === ui.you ? `<button class="ghost small" data-a="toggleAvatars" aria-expanded="${ui.avatarOpen}">Cambiar avatar</button>` : ''}
        ${ui.isHost && !p.host ? `<button class="ghost small" data-a="kick" data-id="${esc(p.id)}">Sacar</button>` : ''}
      </span>
    </li>`).join('');
  const hostControls = `
    <button class="primary" data-a="start" ${n < MIN_PLAYERS ? 'disabled' : ''}>Empezar partida</button>
    ${missing > 0 ? `<p class="hint">Faltan al menos ${missing} jugador${missing === 1 ? '' : 'es'}.</p>` : ''}
    ${r.dev ? `<button class="ghost" data-a="addBot" ${n >= MAX_PLAYERS ? 'disabled' : ''}>Añadir bot (modo desarrollo)</button>` : ''}`;
  return `${topbar()}
    <section class="panel invite">
      <h2>Invita a la gente</h2>
      <p>Comparte el enlace o dicta el código de sala:</p>
      <b class="bigcode">${esc(ui.code)}</b>
      <div class="row"><input readonly id="link" value="${esc(shareLink())}"><button data-a="copy">Copiar enlace</button></div>
      ${isLocalhost() ? '<p class="hint warn">Estás en localhost: este enlace solo funciona en este PC. Para jugar con otras personas, publica la web (mira el README).</p>' : ''}
    </section>
    <section class="panel">
      <h2>Jugadores (${n}/${MAX_PLAYERS})</h2>
      <ul class="lobby-list">${list}</ul>
      ${ui.avatarOpen ? avatarPicker() : ''}
      ${ui.isHost ? hostControls : '<p class="hint">Esperando a que el anfitrión empiece la partida…</p>'}
    </section>
    ${rulesBox()}`;
}

function rulesBox() {
  return `
    <details class="panel rules">
      <summary>Cómo se juega</summary>
      <p>Cada jugador recibe un rol secreto: <b class="t-lib">liberal</b>, <b class="t-fas">fascista</b> o <b class="t-fas">Hitler</b>. Los fascistas saben quiénes son; los liberales no saben nada.</p>
      <p>En cada ronda, el presidente propone un canciller y todos votan con sus cartas ¡Ja! o Nein. Si sale adelante, el presidente roba 3 leyes, descarta una y pasa 2 al canciller, que descarta otra y promulga la que queda.</p>
      <p><b class="t-lib">Ganan los liberales</b> con 5 leyes liberales o ejecutando a Hitler. <b class="t-fas">Ganan los fascistas</b> con 6 leyes fascistas o si Hitler sale elegido canciller cuando ya hay 3 leyes fascistas.</p>
      <p>Algunas casillas del tablero fascista dan poderes al presidente (mirar leyes, investigar, elección especial, ejecutar). Si se rechazan 3 gobiernos seguidos, se promulga la ley de arriba del mazo.</p>
      <p>Hablad, acusad y mentid por vuestro canal de voz habitual.</p>
    </details>`;
}

const nameOf = (id) => esc(ui.game.players.find((p) => p.id === id)?.name ?? '?');

function viewGame() {
  const g = ui.game;
  const me = g.players.find((p) => p.id === g.me);
  const over = g.phase === 'gameover';
  return `${topbar()}
    ${over ? gameOver(g, me) : rolePanel(g, me)}
    ${over ? '' : actionPanel(g, me)}
    ${boards(g)}
    <section class="panel"><h2>Jugadores</h2>${seats(g)}</section>
    ${notesBox(g)}
    ${logBox(g)}`;
}

function roleInfo(g, me) {
  const mates = g.players.filter((p) => p.id !== me.id && p.role);
  if (me.role === 'liberal') return 'Ganas con 5 leyes liberales o ejecutando a Hitler. Descubre quién miente.';
  if (mates.length) return `Tu equipo: ${mates.map((p) => `<b>${esc(p.name)}</b> (${ROLE[p.role]})`).join(', ')}.`;
  if (me.role === 'hitler') return 'Los fascistas saben quién eres, pero tú no sabes quiénes son. Gánate la confianza de los liberales.';
  return '';
}

function rolePanel(g, me) {
  if (!ui.roleOpen) {
    return `<button class="role-toggle" data-a="toggleRole">${cardBack('tiny')}Ver mi rol en secreto</button>`;
  }
  return `
    <section class="panel role-panel ${partyOf(me.role)}">
      <div class="role-cards">${partyCardHtml(me.role)}${roleCardHtml(me.role)}</div>
      <div class="role-text">
        <h2>Tu rol secreto</h2>
        <p>${roleInfo(g, me)}</p>
        <button class="ghost small" data-a="toggleRole">Ocultar</button>
      </div>
    </section>`;
}

function panel(title, body, cls = '') {
  return `<section class="panel action ${cls}"><h2>${title}</h2>${body}</section>`;
}
const wait = (text) => `<section class="panel action waiting"><p>${text}</p></section>`;

function playerPicker(ids, kind, label, ico = '') {
  const picks = ids.map((id) => `<button class="pick ${ui.sel === id ? 'sel' : ''}" data-a="select" data-v="${esc(id)}">${avatarFor(id, 'sm')}<span>${nameOf(id)}</span></button>`).join('');
  return `<div class="picks">${picks}</div><button class="primary" data-a="confirm" data-kind="${kind}" ${ui.sel == null ? 'disabled' : ''}>${label}</button>`;
}

function cardPicker(hand, kind, label) {
  const cards = hand.map((c, i) => {
    const sel = ui.sel === String(i);
    return `<button class="pcard ${c} deal ${sel ? 'sel' : ''}" style="--i:${i}" data-a="select" data-v="${i}" aria-pressed="${sel}">${icon(PARTY_ICON[c])}<b>${POLICY[c]}</b>${sel ? '<i class="stamp">Descartar</i>' : ''}</button>`;
  }).join('');
  return `<div class="hand">${cards}</div><button class="primary" data-a="confirm" data-kind="${kind}" ${ui.sel == null ? 'disabled' : ''}>${label}</button>`;
}

function actionPanel(g, me) {
  const isPres = g.presidentId === g.me;
  const isChan = g.chancellorId === g.me;
  const P = nameOf(g.presidentId);
  const dead = me.alive ? '' : '<p class="hint">Has sido ejecutado: puedes mirar, pero ya no hablas ni votas.</p>';
  switch (g.phase) {
    case 'nominate':
      return isPres
        ? panel('Eres presidente: elige canciller', playerPicker(g.eligible, 'nominate', 'Proponer como canciller'), 'turn')
        : wait(`<b>${P}</b> es presidente y está eligiendo canciller.${dead}`);
    case 'vote': {
      const head = `<b>${P}</b> propone a <b>${nameOf(g.nomineeId)}</b> como canciller.`;
      const alive = g.players.filter((p) => p.alive).length;
      if (!me.alive) return wait(head + dead);
      if (g.myVote === null) {
        const warn = g.fascist >= 3 ? '<p class="hint warn">Cuidado: si Hitler sale elegido canciller, ganan los fascistas.</p>' : '';
        const cards = ['1', '0'].map((v) => `<button class="vcard ${v === '1' ? 'ja' : 'nein'} ${ui.voteSel === v ? 'sel' : ''}" data-a="pickVote" data-v="${v}" aria-pressed="${ui.voteSel === v}"><b>${v === '1' ? '¡Ja!' : 'Nein'}</b></button>`).join('');
        const label = ui.voteSel === '1' ? 'Votar ¡Ja!' : ui.voteSel === '0' ? 'Votar Nein' : 'Elige una carta';
        return panel('Votación', `<p>${head}</p>${warn}<div class="vote-hand">${cards}</div><button class="primary" data-a="vote" data-v="${ui.voteSel ?? ''}" ${ui.voteSel == null ? 'disabled' : ''}>${label}</button>`, 'turn');
      }
      return panel('Votación', `<p>${head}</p><div class="voted">${voteCard(g.myVote, 'small')}<p>Has votado. Faltan <b>${alive - g.voted.length}</b> de ${alive} votos.</p></div>`, 'waiting');
    }
    case 'presidentDiscard':
      return isPres
        ? panel('Elige qué ley descartar', `<p class="hint">Las otras dos pasarán a ${nameOf(g.chancellorId)}.</p>${cardPicker(g.hand, 'presidentDiscard', 'Descartar la marcada')}`, 'turn')
        : wait(`<b>${P}</b> está mirando las 3 leyes robadas.${dead}`);
    case 'chancellorDiscard': {
      if (!isChan) return wait(`<b>${nameOf(g.chancellorId)}</b> (canciller) está decidiendo qué ley promulgar.${dead}`);
      const veto = g.vetoAvailable ? '<button class="ghost" data-a="veto">Proponer veto (descartar ambas)</button>' : '';
      return panel('Eres canciller: descarta una ley', `<p class="hint">Se promulgará la que no descartes.</p>${cardPicker(g.hand, 'chancellorDiscard', 'Descartar y promulgar la otra')}${veto}`, 'turn');
    }
    case 'vetoDecision':
      return isPres
        ? panel('El canciller propone un veto', `<p>Si aceptas, se descartan las dos leyes y avanza el marcador de gobiernos fallidos.</p><div class="row"><button data-a="vetoResp" data-v="1">Aceptar veto</button><button class="ghost" data-a="vetoResp" data-v="0">Rechazar</button></div>`, 'turn')
        : wait(`<b>${P}</b> decide si acepta el veto del canciller.${dead}`);
    case 'power':
      return isPres
        ? panel(`${icon(POWER_ICON[g.power])} ${POWER_NAMES[g.power]}`, `<p class="hint">${POWER_HELP[g.power]}</p>${playerPicker(g.targets, 'power', POWER_BUTTON[g.power])}`, `turn ${g.power}`)
        : wait(`<b>${P}</b> está usando un poder: ${POWER_NAMES[g.power]}.${dead}`);
    case 'powerAck':
      return isPres
        ? panel('Información secreta', `${powerResult(g.powerResult)}<p class="hint">Solo tú lo sabes. Puedes contarlo… o mentir.</p><button class="primary" data-a="ack">Continuar</button>`, 'turn')
        : wait(`<b>${P}</b> está consultando información secreta.${dead}`);
    default:
      return '';
  }
}

function powerResult(r) {
  if (!r) return '';
  if (r.kind === 'peek') {
    return `<p>Las 3 próximas leyes, de arriba a abajo:</p><div class="hand">${r.cards.map((c, i) => policyCard(c, 'deal', i)).join('')}</div>`;
  }
  return `<div class="investigated">${partyCardHtml(r.party === 'liberal' ? 'liberal' : 'fascist')}<p><b>${nameOf(r.target)}</b> es del partido <b class="t-${r.party === 'liberal' ? 'lib' : 'fas'}">${r.party === 'liberal' ? 'liberal' : 'fascista'}</b>.</p></div>`;
}

// ---------- Tablero ----------

const boardRange = (n) => (n <= 6 ? '5 y 6' : n <= 8 ? '7 y 8' : '9 y 10');

function boards(g) {
  const fresh = ui.fresh;
  const slot = (kind, i, filled, inner, cls = '', title = '') => {
    const isNew = fresh && fresh.kind === kind && fresh.idx === i;
    return `<li class="slot ${cls} ${filled ? 'filled' : ''}"${title ? ` title="${esc(title)}"` : ''}>${filled ? policyCard(kind, isNew ? 'drop' : '') : inner}</li>`;
  };
  const lib = Array.from({ length: 5 }, (_, i) =>
    slot('liberal', i, i < g.liberal, i === 4 ? `${icon('flag')}<small>Victoria</small>` : '', i === 4 ? 'goal' : '')).join('');
  const fas = g.powerTrack.map((p, i) => {
    const inner = i === 5
      ? `${icon('flag')}<small>Victoria</small>`
      : `${p ? icon(POWER_ICON[p]) : ''}<small>${p ? POWER_SHORT[p] : ''}</small>${i === 4 ? '<em>+ veto</em>' : ''}`;
    return slot('fascist', i, i < g.fascist, inner, `${i === 5 ? 'goal' : ''} ${p ? 'power' : ''}`, p ? POWER_NAMES[p] : '');
  }).join('');
  const tracker = [1, 2, 3].map((i) => `<li class="${i <= g.tracker ? 'on' : ''} ${i === 3 ? 'chaos' : ''}">${i === 3 ? 'Caos' : ''}</li>`).join('');
  const stack = (count, cls) => `<span class="stack ${cls}">${count ? cardBack() : ''}${count > 1 ? cardBack() : ''}${count > 2 ? cardBack() : ''}</span>`;
  return `
    <section class="board" aria-label="Tablero">
      <div class="track lib">
        <h2>Leyes liberales <span>${g.liberal} de 5</span></h2>
        <ol class="slots five">${lib}</ol>
        <div class="tracker">
          <span>Gobiernos fallidos</span>
          <ol>${tracker}</ol>
        </div>
        <p class="track-note">Al tercer gobierno fallido se promulga la ley de arriba del mazo, sin poderes.</p>
      </div>
      <div class="track fas">
        <h2>Leyes fascistas <span>${g.fascist} de 6</span></h2>
        <ol class="slots six">${fas}</ol>
        <p class="zone ${g.fascist >= 3 ? 'live' : ''}">${g.fascist >= 3 ? 'Activo: ' : 'Desde la 3ª ley: '}si Hitler sale elegido canciller, gana el fascismo</p>
        <p class="track-note">Tablero para ${boardRange(g.playerCount)} jugadores.${g.fascist >= 5 ? ' Veto desbloqueado.' : ''}</p>
      </div>
      <div class="piles">
        <div class="pile">${stack(g.deckCount, '')}<span>Mazo <b>${g.deckCount}</b></span></div>
        <div class="pile">${stack(g.discardCount, 'discard')}<span>Descartes <b>${g.discardCount}</b></span></div>
      </div>
    </section>`;
}

function seats(g) {
  const conn = Object.fromEntries(ui.room.players.map((p) => [p.id, p.connected]));
  const lv = g.lastVote;
  const over = g.phase === 'gameover';
  const items = g.players.map((p) => {
    const marks = [];
    if (!over && p.id === g.presidentId) marks.push('<b class="placard pres">Presidente</b>');
    if (!over && p.id === g.chancellorId) marks.push('<b class="placard chan">Canciller</b>');
    if (g.phase === 'vote' && p.id === g.nomineeId) marks.push('<b class="placard nom">Candidato</b>');
    let vote = '';
    if (g.phase === 'vote') vote = g.voted.includes(p.id) ? cardBack('mini') : '';
    else if (lv && p.id in lv.votes && !over) vote = voteCard(lv.votes[p.id], 'mini');
    const tags = [];
    if (g.confirmedNotHitler.includes(p.id) && !over) tags.push('<b class="tag">No es Hitler</b>');
    // Los roles ajenos que conoces solo se ven con tu rol desplegado (por si alguien mira tu pantalla).
    if (p.role && (over || (ui.roleOpen && p.id !== g.me))) tags.push(`<b class="tag role-${p.role}">${ROLE[p.role]}</b>`);
    if (conn[p.id] === false) tags.push('<b class="tag off">Desconectado</b>');
    if (!p.alive) tags.push('<b class="tag dead">Ejecutado</b>');
    // Al terminar, cada asiento muestra el retrato de su rol (con el avatar del jugador en la esquina).
    const face = over && p.role
      ? `<span class="seat-face reveal-face ${p.role}">${rolePortrait(p.role)}${avatarFor(p.id, 'badge')}</span>`
      : `<span class="seat-face">${avatarFor(p.id)}</span>`;
    return `<li class="seat ${p.alive ? '' : 'dead'} ${p.id === g.me ? 'me' : ''}">
      ${face}
      <div class="seat-body">
        <div class="seat-top"><span class="seat-name">${esc(p.name)}${p.id === g.me ? ' <i>(tú)</i>' : ''}</span>${vote}</div>
        ${marks.length ? `<div class="marks">${marks.join('')}</div>` : ''}
        ${tags.length ? `<div class="tags">${tags.join('')}</div>` : ''}
      </div>
    </li>`;
  }).join('');
  const caption = lv && g.phase !== 'vote'
    ? `<p class="hint">Última votación: gobierno de ${nameOf(lv.presidentId)} y ${nameOf(lv.nomineeId)} ${lv.passed ? 'aprobado' : 'rechazado'}.</p>`
    : '';
  return `<ul class="seats">${items}</ul>${caption}`;
}

function notesBox(g) {
  if (!g.notes.length || g.phase === 'gameover') return '';
  if (!ui.roleOpen) return '<section class="panel"><p class="hint">Tienes notas secretas: se muestran al desplegar tu rol.</p></section>';
  const items = g.notes.map((n) => n.kind === 'investigate'
    ? `<li>${nameOf(n.target)} es del partido <b class="t-${n.party === 'liberal' ? 'lib' : 'fas'}">${n.party === 'liberal' ? 'liberal' : 'fascista'}</b>.</li>`
    : `<li>Viste las próximas leyes: ${n.cards.map((c) => `<b class="t-${c === 'liberal' ? 'lib' : 'fas'}">${POLICY[c]}</b>`).join(', ')}.</li>`).join('');
  return `<section class="panel"><h2>Tus notas secretas</h2><ul class="notes">${items}</ul></section>`;
}

function logBox(g) {
  const items = ui.logOpen ? `<ol class="log">${[...g.log].reverse().map((l) => `<li>${esc(l)}</li>`).join('')}</ol>` : '';
  return `<section class="panel"><button class="ghost" data-a="toggleLog">${ui.logOpen ? 'Ocultar' : 'Ver'} historial</button>${items}</section>`;
}

function gameOver(g, me) {
  const won = g.winner === 'liberal' ? me.role === 'liberal' : me.role !== 'liberal';
  const controls = ui.isHost
    ? `<div class="row"><button class="primary" data-a="newGame">Otra partida</button><button class="ghost" data-a="toLobby">Volver a la sala</button></div>`
    : '<p class="hint">Esperando a que el anfitrión decida la siguiente partida…</p>';
  return `
    <section class="panel banner ${g.winner}">
      ${icon(PARTY_ICON[g.winner], 'banner-ico')}
      <h2>${g.winner === 'liberal' ? 'Ganan los liberales' : 'Ganan los fascistas'}</h2>
      <p>${esc(g.winReason)}</p>
      <p class="verdict"><b>${won ? '¡Has ganado!' : 'Has perdido.'}</b> Eras ${ROLE[me.role]}.</p>
      ${controls}
    </section>`;
}

// ---------- Capa de animaciones ----------

function overlayHtml(o) {
  const g = ui.game;
  const me = g.players.find((p) => p.id === g.me);
  if (o.kind === 'role') {
    if (o.stage === 'sealed') {
      return `
        <div class="ov ov-role" role="dialog" aria-modal="true" aria-label="Sobre con tu rol secreto">
          <div class="envelope">
            <span class="env-flap"></span>
            <span class="env-text"><small>Confidencial</small>Para ${esc(me.name)}</span>
            <span class="wax">${icon('star')}</span>
          </div>
          <p class="ov-hint">Asegúrate de que nadie más ve tu pantalla.</p>
          <button class="primary" data-a="openSeal">Abrir el sobre</button>
        </div>`;
    }
    const flip = (front, d) => `<span class="flip" style="--d:${d}"><span class="flip-in"><span class="face back">${cardBack()}</span><span class="face front">${front}</span></span></span>`;
    return `
      <div class="ov ov-role open ${partyOf(me.role)}" role="dialog" aria-modal="true" aria-label="Tu rol secreto">
        <div class="envelope gone"><span class="env-flap"></span></div>
        <div class="reveal">${flip(partyCardHtml(me.role), 0)}${flip(roleCardHtml(me.role), 1)}</div>
        <h2 class="ov-title">${me.role === 'hitler' ? 'Eres Hitler' : `Eres ${me.role === 'liberal' ? 'liberal' : 'fascista'}`}</h2>
        <p class="ov-text">${roleInfo(g, me)}</p>
        <button class="primary" data-a="dismiss">Entendido, ocultar</button>
      </div>`;
  }
  if (o.kind === 'vote') {
    const v = o.vote;
    const voters = g.players.filter((p) => p.id in v.votes);
    const ja = voters.filter((p) => v.votes[p.id]).length;
    const cards = voters.map((p, i) => `
      <li><span class="flip" style="--d:${i}"><span class="flip-in"><span class="face back">${cardBack()}</span><span class="face front">${voteCard(v.votes[p.id])}</span></span></span><span class="who-row">${avatarFor(p.id, 'xs')}<span>${esc(p.name)}</span></span></li>`).join('');
    return `
      <div class="ov ov-vote" role="status" aria-live="polite">
        <div class="ov-card">
          <h2 class="ov-title ${v.passed ? 'yes' : 'no'}">${v.passed ? 'Gobierno aprobado' : 'Gobierno rechazado'}</h2>
          <p class="ov-text">${nameOf(v.presidentId)} propuso a ${nameOf(v.nomineeId)}. ¡Ja! ${ja}, Nein ${voters.length - ja}.</p>
          <ul class="vote-grid">${cards}</ul>
          <button class="ghost small" data-a="dismiss">Cerrar</button>
        </div>
      </div>`;
  }
  if (o.kind === 'policy') {
    const pw = o.power ? `<p class="ov-power">${icon(POWER_ICON[o.power])} Poder presidencial: ${POWER_NAMES[o.power]}</p>` : '';
    return `
      <div class="ov ov-policy ${o.policy}" role="status" aria-live="polite">
        <span class="flip big" style="--d:0"><span class="flip-in"><span class="face back">${cardBack()}</span><span class="face front">${policyCard(o.policy)}</span></span></span>
        <h2 class="ov-title">Ley ${o.policy === 'liberal' ? 'liberal' : 'fascista'} promulgada</h2>
        ${o.chaos ? '<p class="ov-text">El pueblo está en caos: se aplica la ley de arriba del mazo.</p>' : ''}
        ${pw}
        <button class="ghost small" data-a="dismiss">Cerrar</button>
      </div>`;
  }
  if (o.kind === 'pres' || o.kind === 'chan') {
    const title = o.kind === 'chan' ? 'Canciller elegido' : o.first ? 'Primer presidente' : 'Nuevo presidente';
    return `
      <div class="ov ov-medal ${o.kind}" role="status" aria-live="polite">
        <span class="medal-face">${avatarFor(o.id)}</span>
        <small class="medal-label">${title}</small>
        <h2 class="ov-title">${nameOf(o.id)}${o.id === g.me ? ' <i>(tú)</i>' : ''}</h2>
        <b class="placard ${o.kind}">${o.kind === 'chan' ? 'Canciller' : 'Presidente'}</b>
      </div>`;
  }
  if (o.kind === 'execute') {
    return `
      <div class="ov ov-exec" role="status" aria-live="polite">
        <span class="exec-face">${avatarFor(o.id)}${icon('target', 'exec-ico')}</span>
        <h2 class="ov-title">${nameOf(o.id)} ha sido ejecutado</h2>
        <p class="ov-text">Ya no puede hablar ni votar. Su rol sigue en secreto.</p>
        <button class="ghost small" data-a="dismiss">Cerrar</button>
      </div>`;
  }
  return '';
}

// ---------- Arranque ----------

function boot() {
  const savedHost = local.get('sh-host');
  const client = session.get('sh-client');
  if (savedHost && session.get('sh-host-active')) return hostGame(savedHost);
  if (client && (!ui.form.code || ui.form.code === client.code)) return joinGame(client.code, client.name);
  ui.error = peerMissing();
  render();
}

boot();

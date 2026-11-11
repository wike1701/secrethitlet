// Interfaz: pantallas de inicio, conexión, sala de espera y partida. Repinta todo con
// innerHTML a partir del estado `ui` (el juego es pequeño y así es fácil de seguir).
import { HostRoom, randomId, cleanName } from './room.js';
import { startHost, joinHost, makeCode, normalizeCode, isValidCode, CODE_LEN } from './net.js';
import { POWER_NAMES, MIN_PLAYERS, MAX_PLAYERS } from './game.js';

const app = document.getElementById('app');
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

const ui = {
  screen: 'home', // home | connecting | lobby | game
  status: '',
  error: '',
  toast: '',
  form: { name: local.get('sh-name') ?? '', code: normalizeCode(params.get('sala')) },
  code: null,
  isHost: false,
  you: null,
  room: null,
  game: null,
  roleOpen: false,
  logOpen: false,
  sel: null,
  selKey: '',
};
let net = null;
let room = null;
let botTimer = null;
let toastTimer = null;

const ROLE = { liberal: 'Liberal', fascist: 'Fascista', hitler: 'Hitler' };
const POLICY = { liberal: 'Liberal', fascist: 'Fascista' };
const STATUS = {
  connecting: 'Conectando…',
  online: 'Conectado',
  reconnecting: 'Reconectando…',
  notfound: 'No se encuentra la sala. Reintentando…',
};
const POWER_HELP = {
  investigate: 'Elige a un jugador para ver en secreto su partido (liberal o fascista). No verás si es Hitler.',
  special: 'Elige quién será el próximo presidente. Después, la presidencia vuelve a seguir el orden normal.',
  execute: 'Elige a un jugador para eliminarlo. Si es Hitler, ganan los liberales.',
};
const POWER_BUTTON = { investigate: 'Investigar', special: 'Nombrar presidente', execute: 'Ejecutar' };
const POWER_SHORT = { peek: 'Mirar', investigate: 'Investigar', special: 'Elección', execute: 'Ejecutar' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

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
    : new HostRoom({ ...hooks, hostName: name, hostToken: randomId(24), dev: DEV });
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
    botTimer = setTimeout(() => { botTimer = null; if (r === room) r.stepBots(); }, 700);
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
    onOpen: () => net?.send({ t: 'hello', name, token }),
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

function applyState(m) {
  const prev = ui.game;
  if (m.game && m.game.phase !== 'gameover' && (!prev || prev.phase === 'gameover')) {
    // Partida nueva: todo lo secreto empieza oculto.
    ui.roleOpen = false;
    ui.logOpen = false;
  }
  ui.room = m.room;
  ui.game = m.game;
  ui.screen = m.game ? 'game' : 'lobby';
  const g = m.game;
  const key = g ? [g.phase, g.presidentId, g.chancellorId, g.liberal, g.fascist, g.tracker, g.hand.length].join('|') : '';
  if (key !== ui.selKey) { ui.selKey = key; ui.sel = null; }
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
  Object.assign(ui, { screen: 'home', status: '', code: null, isHost: false, you: null, room: null, game: null, sel: null, roleOpen: false, logOpen: false });
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
  vote: (el) => doAct({ type: 'vote', vote: el.dataset.v === '1' }),
  veto: () => doAct({ type: 'chancellorDiscard', veto: true }),
  vetoResp: (el) => doAct({ type: 'vetoResponse', agree: el.dataset.v === '1' }),
  ack: () => doAct({ type: 'ack' }),
};

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  actions[el.dataset.a]?.(el);
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

// ---------- Vistas ----------

function render() {
  const focused = document.activeElement?.id;
  const views = { home: viewHome, connecting: viewConnecting, lobby: viewLobby, game: viewGame };
  app.innerHTML = views[ui.screen]() + (ui.toast ? `<div class="toast" role="status">${esc(ui.toast)}</div>` : '');
  if (focused) document.getElementById(focused)?.focus();
}

const footer = () => `<footer>Adaptación no comercial de <a href="https://www.secrethitler.com" target="_blank" rel="noopener">Secret Hitler</a> (Goat, Wolf &amp; Cabbage), con licencia CC BY-NC-SA 4.0.</footer>`;

function viewHome() {
  const saved = local.get('sh-host');
  const invited = isValidCode(ui.form.code);
  const createCard = `
    <button class="${invited ? 'ghost' : 'primary'}" data-a="create">Crear partida nueva</button>`;
  const joinCard = `
    <label>Código de sala<input id="code" maxlength="${CODE_LEN}" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(ui.form.code)}" placeholder="ABCDE"></label>
    <button class="${invited ? 'primary' : ''}" data-a="join">Unirse a la partida</button>`;
  return `
    <header class="hero"><h1>Secret<span>Hitlet</span></h1><p>Deducción social para 5–10 jugadores, en el navegador.</p></header>
    ${ui.error ? `<p class="error" role="alert">${esc(ui.error)}</p>` : ''}
    <section class="card">
      <label>Tu nombre<input id="name" maxlength="20" autocomplete="nickname" value="${esc(ui.form.name)}" placeholder="Cómo te verán los demás"></label>
      ${invited ? joinCard + '<p class="or">o</p>' + createCard : createCard + '<p class="or">o únete a una</p>' + joinCard}
    </section>
    ${saved ? `<section class="card"><p>Tienes una partida guardada como anfitrión (sala <b>${esc(saved.code)}</b>).</p>
      <div class="row"><button data-a="resume">Reanudar</button><button class="ghost" data-a="discardSaved">Descartar</button></div></section>` : ''}
    ${rulesBox()}
    ${footer()}`;
}

function viewConnecting() {
  return `
    <section class="card center">
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
      <span>Sala <b>${esc(ui.code)}</b></span>
      <span class="status ${esc(ui.status)}">${label}</span>
      <button class="ghost small" data-a="leave">Salir</button>
    </header>`;
}

function viewLobby() {
  const r = ui.room;
  const n = r.players.length;
  const missing = MIN_PLAYERS - n;
  const list = r.players.map((p) => `
    <li class="${p.connected ? '' : 'off'}">
      <span>${esc(p.name)}${p.id === ui.you ? ' <i>(tú)</i>' : ''}</span>
      <span class="tags">
        ${p.host ? '<b class="tag">Anfitrión</b>' : ''}${p.bot ? '<b class="tag">Bot</b>' : ''}
        ${p.connected ? '' : '<b class="tag off">Desconectado</b>'}
        ${ui.isHost && !p.host ? `<button class="ghost small" data-a="kick" data-id="${esc(p.id)}">Sacar</button>` : ''}
      </span>
    </li>`).join('');
  const hostControls = `
    <button class="primary" data-a="start" ${n < MIN_PLAYERS ? 'disabled' : ''}>Empezar partida</button>
    ${missing > 0 ? `<p class="hint">Faltan al menos ${missing} jugador${missing === 1 ? '' : 'es'}.</p>` : ''}
    ${r.dev ? `<button class="ghost" data-a="addBot" ${n >= MAX_PLAYERS ? 'disabled' : ''}>Añadir bot (modo desarrollo)</button>` : ''}`;
  return `${topbar()}
    <section class="card">
      <h2>Invita a la gente</h2>
      <p>Comparte el enlace o el código <b class="bigcode">${esc(ui.code)}</b></p>
      <div class="row"><input readonly id="link" value="${esc(shareLink())}"><button data-a="copy">Copiar</button></div>
      ${isLocalhost() ? '<p class="hint warn">Estás en localhost: este enlace solo funciona en este PC. Para jugar con otras personas, publica la web (mira el README).</p>' : ''}
    </section>
    <section class="card">
      <h2>Jugadores (${n}/${MAX_PLAYERS})</h2>
      <ul class="players">${list}</ul>
      ${ui.isHost ? hostControls : '<p class="hint">Esperando a que el anfitrión empiece la partida…</p>'}
    </section>
    ${rulesBox()}`;
}

function rulesBox() {
  return `
    <details class="card rules">
      <summary>Cómo se juega</summary>
      <p>Cada jugador recibe un rol secreto: <b class="liberal">liberal</b>, <b class="fascist">fascista</b> o <b class="fascist">Hitler</b>. Los fascistas saben quiénes son; los liberales no saben nada.</p>
      <p>En cada ronda, el presidente propone un canciller y todos votan. Si sale adelante, el presidente roba 3 leyes, descarta una y pasa 2 al canciller, que descarta otra y promulga la que queda.</p>
      <p><b class="liberal">Ganan los liberales</b> con 5 leyes liberales o ejecutando a Hitler. <b class="fascist">Ganan los fascistas</b> con 6 leyes fascistas o si Hitler sale elegido canciller cuando ya hay 3 leyes fascistas.</p>
      <p>Algunas leyes fascistas dan poderes al presidente (investigar, elegir al siguiente presidente, ejecutar). Si se rechazan 3 gobiernos seguidos, se promulga la ley de arriba del mazo.</p>
      <p>Hablad, acusad y mentid por vuestro canal de voz habitual.</p>
    </details>`;
}

const nameOf = (id) => esc(ui.game.players.find((p) => p.id === id)?.name ?? '?');

function viewGame() {
  const g = ui.game;
  const me = g.players.find((p) => p.id === g.me);
  const over = g.phase === 'gameover';
  return `${topbar()}
    ${over ? gameOver(g, me) : roleCard(g, me)}
    ${over ? '' : actionPanel(g, me)}
    ${boards(g)}
    <section class="card"><h2>Jugadores</h2>${playersList(g)}</section>
    ${notesBox(g)}
    ${logBox(g)}`;
}

function roleCard(g, me) {
  if (!ui.roleOpen) {
    return `<section class="card role-closed"><button data-a="toggleRole">Ver mi rol en secreto</button></section>`;
  }
  const mates = g.players.filter((p) => p.id !== me.id && p.role);
  let info = '';
  if (me.role === 'liberal') info = 'Ganas con 5 leyes liberales o ejecutando a Hitler. Descubre quién miente.';
  else if (mates.length) info = `Tu equipo: ${mates.map((p) => `<b>${esc(p.name)}</b> (${ROLE[p.role]})`).join(', ')}.`;
  else if (me.role === 'hitler') info = 'Los fascistas saben quién eres, pero tú no sabes quiénes son. Gánate la confianza de los liberales.';
  return `
    <section class="card role ${me.role}">
      <div><small>Tu rol secreto</small><strong>${ROLE[me.role]}</strong><small>Partido ${me.role === 'liberal' ? 'liberal' : 'fascista'}</small></div>
      <p>${info}</p>
      <button class="ghost small" data-a="toggleRole">Ocultar</button>
    </section>`;
}

function panel(title, body, cls = '') {
  return `<section class="card action ${cls}"><h2>${title}</h2>${body}</section>`;
}
const wait = (text) => `<section class="card action waiting"><p>${text}</p></section>`;

function playerPicker(ids, kind, label) {
  const picks = ids.map((id) => `<button class="pick ${ui.sel === id ? 'sel' : ''}" data-a="select" data-v="${esc(id)}">${nameOf(id)}</button>`).join('');
  return `<div class="picks">${picks}</div><button class="primary" data-a="confirm" data-kind="${kind}" ${ui.sel == null ? 'disabled' : ''}>${label}</button>`;
}

function cardPicker(hand, kind, label) {
  const cards = hand.map((c, i) => `<button class="policy ${c} ${ui.sel === String(i) ? 'sel' : ''}" data-a="select" data-v="${i}">${POLICY[c]}</button>`).join('');
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
        ? panel('Eres presidente: elige canciller', playerPicker(g.eligible, 'nominate', 'Proponer como canciller'))
        : wait(`${P} es presidente y está eligiendo canciller.${dead}`);
    case 'vote': {
      const head = `${P} propone a <b>${nameOf(g.nomineeId)}</b> como canciller.`;
      const alive = g.players.filter((p) => p.alive).length;
      if (!me.alive) return wait(head + dead);
      if (g.myVote === null) {
        const warn = g.fascist >= 3 ? '<p class="hint warn">Cuidado: si Hitler sale elegido canciller, ganan los fascistas.</p>' : '';
        return panel('Votación', `<p>${head}</p>${warn}<div class="row vote"><button class="ja" data-a="vote" data-v="1">¡Ja!</button><button class="nein" data-a="vote" data-v="0">Nein</button></div>`);
      }
      return wait(`${head} Has votado <b>${g.myVote ? 'Ja' : 'Nein'}</b>. Faltan ${alive - g.voted.length} votos.`);
    }
    case 'presidentDiscard':
      return isPres
        ? panel('Elige qué ley descartar', `<p class="hint">Las otras dos pasarán a ${nameOf(g.chancellorId)}.</p>${cardPicker(g.hand, 'presidentDiscard', 'Descartar la seleccionada')}`)
        : wait(`${P} está mirando las 3 leyes robadas.${dead}`);
    case 'chancellorDiscard': {
      if (!isChan) return wait(`${nameOf(g.chancellorId)} (canciller) está decidiendo qué ley promulgar.${dead}`);
      const veto = g.vetoAvailable ? '<button class="ghost" data-a="veto">Proponer veto (descartar ambas)</button>' : '';
      return panel('Eres canciller: descarta una ley', `<p class="hint">Se promulgará la que no descartes.</p>${cardPicker(g.hand, 'chancellorDiscard', 'Descartar y promulgar la otra')}${veto}`);
    }
    case 'vetoDecision':
      return isPres
        ? panel('El canciller propone un veto', `<p>Si aceptas, se descartan las dos leyes y avanza el contador de elecciones fallidas.</p><div class="row"><button data-a="vetoResp" data-v="1">Aceptar veto</button><button class="ghost" data-a="vetoResp" data-v="0">Rechazar</button></div>`)
        : wait(`${P} decide si acepta el veto del canciller.${dead}`);
    case 'power':
      return isPres
        ? panel(`Poder presidencial: ${POWER_NAMES[g.power]}`, `<p class="hint">${POWER_HELP[g.power]}</p>${playerPicker(g.targets, 'power', POWER_BUTTON[g.power])}`, g.power)
        : wait(`${P} está usando un poder: <b>${POWER_NAMES[g.power]}</b>.${dead}`);
    case 'powerAck':
      return isPres
        ? panel('Información secreta', `${powerResult(g.powerResult)}<p class="hint">Solo tú lo sabes. Puedes contarlo… o mentir.</p><button class="primary" data-a="ack">Continuar</button>`)
        : wait(`${P} está consultando información secreta.${dead}`);
    default:
      return '';
  }
}

function powerResult(r) {
  if (!r) return '';
  if (r.kind === 'peek') {
    return `<p>Las 3 próximas leyes, de arriba a abajo:</p><div class="hand">${r.cards.map((c) => `<div class="policy ${c}">${POLICY[c]}</div>`).join('')}</div>`;
  }
  return `<p>${nameOf(r.target)} es del partido <b class="${r.party}">${r.party === 'liberal' ? 'liberal' : 'fascista'}</b>.</p>`;
}

function boards(g) {
  const lib = Array.from({ length: 5 }, (_, i) => `<div class="slot ${i < g.liberal ? 'filled liberal' : ''}">${i === 4 ? '<small>Victoria</small>' : ''}</div>`).join('');
  const fas = g.powerTrack.map((p, i) => `<div class="slot ${i < g.fascist ? 'filled fascist' : ''}" title="${p ? esc(POWER_NAMES[p]) : ''}"><small>${i === 5 ? 'Victoria' : p ? POWER_SHORT[p] : ''}</small></div>`).join('');
  const dots = [0, 1, 2].map((i) => `<span class="dot ${i < g.tracker ? 'on' : ''}"></span>`).join('');
  return `
    <section class="card boards">
      <div class="track"><h3><span class="liberal">Leyes liberales</span> ${g.liberal}/5</h3><div class="slots">${lib}</div></div>
      <div class="track"><h3><span class="fascist">Leyes fascistas</span> ${g.fascist}/6</h3><div class="slots six">${fas}</div>
        ${g.fascist >= 3 ? '<p class="hint warn">Si Hitler sale elegido canciller, ganan los fascistas.</p>' : ''}
        ${g.fascist >= 5 ? '<p class="hint">Veto desbloqueado.</p>' : ''}</div>
      <div class="meta"><span>Gobiernos fallidos ${dots}</span><span>Mazo ${g.deckCount} · Descartes ${g.discardCount}</span></div>
    </section>`;
}

function playersList(g) {
  const conn = Object.fromEntries(ui.room.players.map((p) => [p.id, p.connected]));
  const lv = g.lastVote;
  const items = g.players.map((p) => {
    const tags = [];
    if (p.id === g.presidentId && g.phase !== 'gameover') tags.push('<b class="tag pres">Presidente</b>');
    if (p.id === g.chancellorId) tags.push('<b class="tag chan">Canciller</b>');
    if (p.id === g.nomineeId && g.phase === 'vote') tags.push('<b class="tag nom">Candidato</b>');
    if (g.phase === 'vote' && g.voted.includes(p.id)) tags.push('<b class="tag">Ha votado</b>');
    if (g.phase !== 'vote' && lv && p.id in lv.votes) tags.push(`<b class="tag ${lv.votes[p.id] ? 'ja' : 'nein'}">${lv.votes[p.id] ? 'Ja' : 'Nein'}</b>`);
    if (g.confirmedNotHitler.includes(p.id) && g.phase !== 'gameover') tags.push('<b class="tag">No es Hitler</b>');
    // Los roles ajenos que conoces solo se ven con tu rol desplegado (por si alguien mira tu pantalla).
    if (p.role && (g.phase === 'gameover' || (ui.roleOpen && p.id !== g.me))) tags.push(`<b class="tag role-${p.role}">${ROLE[p.role]}</b>`);
    if (conn[p.id] === false) tags.push('<b class="tag off">Desconectado</b>');
    return `<li class="${p.alive ? '' : 'dead'} ${p.id === g.me ? 'me' : ''}">
      <span>${esc(p.name)}${p.id === g.me ? ' <i>(tú)</i>' : ''}${p.alive ? '' : ' <i>· ejecutado</i>'}</span>
      <span class="tags">${tags.join('')}</span></li>`;
  }).join('');
  const caption = lv && g.phase !== 'vote'
    ? `<p class="hint">Última votación: gobierno de ${nameOf(lv.presidentId)} y ${nameOf(lv.nomineeId)} ${lv.passed ? 'aprobado' : 'rechazado'}.</p>`
    : '';
  return `<ul class="players">${items}</ul>${caption}`;
}

function notesBox(g) {
  if (!g.notes.length || g.phase === 'gameover') return '';
  if (!ui.roleOpen) return '<section class="card"><p class="hint">Tienes notas secretas: se muestran al desplegar tu rol.</p></section>';
  const items = g.notes.map((n) => n.kind === 'investigate'
    ? `<li>${nameOf(n.target)} es del partido <b class="${n.party}">${n.party === 'liberal' ? 'liberal' : 'fascista'}</b>.</li>`
    : `<li>Viste las próximas leyes: ${n.cards.map((c) => `<b class="${c}">${POLICY[c]}</b>`).join(', ')}.</li>`).join('');
  return `<section class="card"><h2>Tus notas secretas</h2><ul class="notes">${items}</ul></section>`;
}

function logBox(g) {
  const items = ui.logOpen ? `<ol class="log">${[...g.log].reverse().map((l) => `<li>${esc(l)}</li>`).join('')}</ol>` : '';
  return `<section class="card"><button class="ghost" data-a="toggleLog">${ui.logOpen ? 'Ocultar' : 'Ver'} historial</button>${items}</section>`;
}

function gameOver(g, me) {
  const won = g.winner === 'liberal' ? me.role === 'liberal' : me.role !== 'liberal';
  const controls = ui.isHost
    ? `<div class="row"><button class="primary" data-a="newGame">Otra partida</button><button class="ghost" data-a="toLobby">Volver a la sala</button></div>`
    : '<p class="hint">Esperando a que el anfitrión decida la siguiente partida…</p>';
  return `
    <section class="card banner ${g.winner}">
      <h2>${g.winner === 'liberal' ? 'Ganan los liberales' : 'Ganan los fascistas'}</h2>
      <p>${esc(g.winReason)}</p>
      <p><b>${won ? '¡Has ganado!' : 'Has perdido.'}</b> Eras ${ROLE[me.role]}.</p>
      ${controls}
    </section>`;
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

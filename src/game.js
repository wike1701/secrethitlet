// Lógica pura de Secret Hitler: sin red ni DOM. La ejecuta el anfitrión, que es la autoridad.
// El estado es JSON plano (incluido el generador aleatorio), así que se puede guardar y reanudar.
// Reglas del juego original de Goat, Wolf & Cabbage (CC BY-NC-SA 4.0). Proyecto no comercial.

// Reparto por número de jugadores: [liberales, fascistas sin contar a Hitler]
export const DIST = { 5: [3, 1], 6: [4, 1], 7: [4, 2], 8: [5, 2], 9: [5, 3], 10: [6, 3] };
export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 10;

const TRACKS = {
  small: [null, null, 'peek', 'execute', 'execute'],
  mid: [null, 'investigate', 'special', 'execute', 'execute'],
  large: ['investigate', 'investigate', 'special', 'execute', 'execute'],
};
// Poder que desbloquea cada ley fascista (6 casillas; la 6ª es la victoria fascista).
export const powerTrack = (n) => [...(n <= 6 ? TRACKS.small : n <= 8 ? TRACKS.mid : TRACKS.large), null];

export const POWER_NAMES = {
  peek: 'Mirar las 3 próximas leyes',
  investigate: 'Investigar lealtad',
  special: 'Elección especial',
  execute: 'Ejecución',
};

class GameError extends Error {}
const fail = (m) => { throw new GameError(m); };

function randomSeed() {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0];
}

// Generador mulberry32 cuyo estado vive en la propia partida (s.rng).
function rand(s) {
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  let t = Math.imul(s.rng ^ (s.rng >>> 15), 1 | s.rng);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function shuffle(s, arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const aliveList = (s) => s.players.filter((p) => p.alive);
const byId = (s, id) => s.players.find((p) => p.id === id);
const president = (s) => s.players[s.presidentIdx];
const log = (s, text) => { s.log.push(text); if (s.log.length > 200) s.log.shift(); };
const note = (s, pid, n) => { (s.notes[pid] ??= []).push(n); };

// players: [{ id, name }]. opts.seed permite partidas reproducibles (tests).
export function createGame(players, opts = {}) {
  const n = players.length;
  if (!DIST[n]) throw new Error(`Se necesitan entre ${MIN_PLAYERS} y ${MAX_PLAYERS} jugadores`);
  if (new Set(players.map((p) => p.id)).size !== n) throw new Error('Hay jugadores con el mismo id');
  const s = {
    rng: (opts.seed ?? randomSeed()) | 0,
    players: [],
    phase: 'nominate',
    presidentIdx: 0,
    resumeAfter: null,
    chancellorId: null,
    nomineeId: null,
    lastPresidentId: null,
    lastChancellorId: null,
    votes: {},
    lastVote: null,
    tracker: 0,
    liberal: 0,
    fascist: 0,
    deck: [],
    discard: [],
    hand: [],
    power: null,
    powerResult: null,
    investigated: [],
    confirmedNotHitler: [],
    notes: {},
    vetoBlocked: false,
    log: [],
    winner: null,
    winReason: null,
  };
  const [lib, fas] = DIST[n];
  const roles = shuffle(s, [...Array(lib).fill('liberal'), ...Array(fas).fill('fascist'), 'hitler']);
  s.players = shuffle(s, players).map((p, i) => ({ id: p.id, name: p.name, alive: true, role: roles[i] }));
  s.presidentIdx = Math.floor(rand(s) * n);
  s.deck = shuffle(s, [...Array(6).fill('liberal'), ...Array(11).fill('fascist')]);
  log(s, 'Empieza la partida.');
  beginNomination(s);
  return s;
}

export function eligibleChancellors(s) {
  const pres = president(s);
  const n = aliveList(s).length;
  return aliveList(s)
    .filter((p) => p.id !== pres.id && p.id !== s.lastChancellorId && !(n > 5 && p.id === s.lastPresidentId))
    .map((p) => p.id);
}

function nextAliveIdx(s, from) {
  let i = from;
  do { i = (i + 1) % s.players.length; } while (!s.players[i].alive);
  return i;
}

function beginNomination(s) {
  s.phase = 'nominate';
  s.chancellorId = null;
  s.nomineeId = null;
  s.votes = {};
  s.hand = [];
  s.power = null;
  s.powerResult = null;
  s.vetoBlocked = false;
  // Caso extremo (muy pocos vivos): si nadie es elegible, se levantan los límites de mandato.
  if (eligibleChancellors(s).length === 0) { s.lastChancellorId = null; s.lastPresidentId = null; }
  log(s, `Turno de ${president(s).name}: debe nominar a un canciller.`);
}

function nextTurn(s) {
  if (s.phase === 'gameover') return;
  const base = s.resumeAfter ?? s.presidentIdx;
  s.resumeAfter = null;
  s.presidentIdx = nextAliveIdx(s, base);
  beginNomination(s);
}

function win(s, who, why) {
  s.phase = 'gameover';
  s.winner = who;
  s.winReason = why;
  s.power = null;
  s.powerResult = null;
  s.hand = [];
  log(s, why);
}

function ensureDeck(s) {
  if (s.deck.length < 3) {
    s.deck = shuffle(s, [...s.deck, ...s.discard]);
    s.discard = [];
    log(s, 'Se barajan de nuevo las leyes.');
  }
}

function draw(s, n) {
  ensureDeck(s);
  return s.deck.splice(0, n);
}

function enact(s, policy, chaos) {
  s.tracker = 0;
  if (policy === 'liberal') s.liberal++; else s.fascist++;
  log(s, `Se promulga una ley ${policy === 'liberal' ? 'LIBERAL' : 'FASCISTA'}${chaos ? ' (el pueblo está en caos)' : ''}.`);
  if (s.liberal >= 5) return win(s, 'liberal', 'Los liberales han promulgado 5 leyes. ¡Ganan los liberales!');
  if (s.fascist >= 6) return win(s, 'fascist', 'Los fascistas han promulgado 6 leyes. ¡Ganan los fascistas!');
  if (!chaos && policy === 'fascist') {
    const power = powerTrack(s.players.length)[s.fascist - 1];
    if (power) {
      const pres = president(s);
      s.power = power;
      if (power === 'peek') {
        ensureDeck(s);
        const cards = s.deck.slice(0, 3);
        s.powerResult = { kind: 'peek', cards };
        note(s, pres.id, { kind: 'peek', cards });
        s.phase = 'powerAck';
        log(s, `${pres.name} mira en secreto las 3 próximas leyes.`);
      } else {
        s.phase = 'power';
        log(s, `${pres.name} obtiene un poder presidencial: ${POWER_NAMES[power]}.`);
      }
      return;
    }
  }
  nextTurn(s);
}

function bumpTracker(s) {
  s.tracker++;
  if (s.tracker >= 3) {
    const [card] = draw(s, 1);
    s.lastPresidentId = null;
    s.lastChancellorId = null;
    log(s, 'Tres gobiernos fallidos: se promulga la ley superior del mazo.');
    enact(s, card, true);
  } else {
    nextTurn(s);
  }
}

function resolveVote(s) {
  const alive = aliveList(s);
  const votes = { ...s.votes };
  const ja = alive.filter((p) => votes[p.id]).length;
  const nein = alive.length - ja;
  const passed = ja > nein;
  s.lastVote = { presidentId: president(s).id, nomineeId: s.nomineeId, votes, passed };
  log(s, 'Votos: ' + alive.map((p) => `${p.name} ${votes[p.id] ? 'Ja' : 'Nein'}`).join(' · '));
  if (!passed) {
    log(s, `Gobierno rechazado (${ja}-${nein}).`);
    return bumpTracker(s);
  }
  const nominee = byId(s, s.nomineeId);
  if (s.fascist >= 3 && nominee.role === 'hitler') {
    return win(s, 'fascist', `${nominee.name} era Hitler y ha sido elegido canciller. ¡Ganan los fascistas!`);
  }
  if (s.fascist >= 3 && !s.confirmedNotHitler.includes(nominee.id)) {
    s.confirmedNotHitler.push(nominee.id);
    log(s, `${nominee.name} no es Hitler.`);
  }
  s.chancellorId = nominee.id;
  s.lastPresidentId = president(s).id;
  s.lastChancellorId = nominee.id;
  s.hand = draw(s, 3);
  s.phase = 'presidentDiscard';
  s.vetoBlocked = false;
  log(s, `Gobierno aprobado (${ja}-${nein}).`);
}

function checkIndex(s, i) {
  if (!Number.isInteger(i) || i < 0 || i >= s.hand.length) fail('Carta no válida');
}

function dispatch(s, pid, a) {
  if (!a || typeof a.type !== 'string') fail('Acción no válida');
  if (s.phase === 'gameover') fail('La partida ha terminado');
  const me = byId(s, pid);
  if (!me) fail('No estás en la partida');
  if (!me.alive) fail('Estás eliminado');
  const pres = president(s);

  switch (a.type) {
    case 'nominate': {
      if (s.phase !== 'nominate') fail('Ahora no se nomina');
      if (pid !== pres.id) fail('Solo el presidente nomina');
      if (!eligibleChancellors(s).includes(a.target)) fail('Ese jugador no puede ser canciller');
      s.nomineeId = a.target;
      s.votes = {};
      s.phase = 'vote';
      log(s, `${pres.name} propone a ${byId(s, a.target).name} como canciller.`);
      break;
    }
    case 'vote': {
      if (s.phase !== 'vote') fail('Ahora no se vota');
      if (s.votes[pid] !== undefined) fail('Ya has votado');
      s.votes[pid] = !!a.vote;
      if (Object.keys(s.votes).length === aliveList(s).length) resolveVote(s);
      break;
    }
    case 'presidentDiscard': {
      if (s.phase !== 'presidentDiscard') fail('Ahora no toca descartar');
      if (pid !== pres.id) fail('Solo el presidente descarta ahora');
      checkIndex(s, a.index);
      s.discard.push(s.hand.splice(a.index, 1)[0]);
      s.phase = 'chancellorDiscard';
      break;
    }
    case 'chancellorDiscard': {
      if (s.phase !== 'chancellorDiscard') fail('Ahora no toca promulgar');
      if (pid !== s.chancellorId) fail('Solo el canciller promulga');
      if (a.veto) {
        if (s.fascist < 5) fail('El veto aún no está disponible');
        if (s.vetoBlocked) fail('El presidente ya ha rechazado el veto');
        s.phase = 'vetoDecision';
        log(s, `${me.name} (canciller) propone vetar esta agenda.`);
        break;
      }
      checkIndex(s, a.index);
      s.discard.push(s.hand.splice(a.index, 1)[0]);
      const [policy] = s.hand;
      s.hand = [];
      enact(s, policy, false);
      break;
    }
    case 'vetoResponse': {
      if (s.phase !== 'vetoDecision') fail('No hay ningún veto pendiente');
      if (pid !== pres.id) fail('Solo el presidente responde al veto');
      if (a.agree) {
        s.discard.push(...s.hand);
        s.hand = [];
        log(s, `${pres.name} acepta el veto: se descartan las dos leyes.`);
        bumpTracker(s);
      } else {
        s.vetoBlocked = true;
        s.phase = 'chancellorDiscard';
        log(s, `${pres.name} rechaza el veto.`);
      }
      break;
    }
    case 'power': {
      if (s.phase !== 'power') fail('No hay ningún poder pendiente');
      if (pid !== pres.id) fail('Solo el presidente usa el poder');
      const target = byId(s, a.target);
      if (!target || !target.alive || target.id === pres.id) fail('Objetivo no válido');
      if (s.power === 'investigate') {
        if (s.investigated.includes(target.id)) fail('Ese jugador ya fue investigado');
        const party = target.role === 'liberal' ? 'liberal' : 'fascist';
        s.investigated.push(target.id);
        s.powerResult = { kind: 'investigate', target: target.id, party };
        note(s, pres.id, { kind: 'investigate', target: target.id, party });
        s.phase = 'powerAck';
        log(s, `${pres.name} investiga la lealtad de ${target.name}.`);
      } else if (s.power === 'special') {
        s.resumeAfter = s.presidentIdx;
        s.presidentIdx = s.players.indexOf(target);
        log(s, `${pres.name} convoca una elección especial: ${target.name} será el próximo presidente.`);
        beginNomination(s);
      } else if (s.power === 'execute') {
        target.alive = false;
        log(s, `${pres.name} ejecuta a ${target.name}.`);
        if (target.role === 'hitler') return win(s, 'liberal', `${target.name} era Hitler y ha sido ejecutado. ¡Ganan los liberales!`);
        nextTurn(s);
      } else fail('Poder no válido');
      break;
    }
    case 'ack': {
      if (s.phase !== 'powerAck') fail('No hay nada que confirmar');
      if (pid !== pres.id) fail('Solo el presidente confirma');
      nextTurn(s);
      break;
    }
    default:
      fail('Acción desconocida');
  }
}

// Aplica una acción de un jugador. Devuelve { ok: true } o { ok: false, error }.
export function act(s, pid, a) {
  try {
    dispatch(s, pid, a);
    return { ok: true };
  } catch (e) {
    if (e instanceof GameError) return { ok: false, error: e.message };
    throw e;
  }
}

// Vista filtrada para un jugador: solo incluye lo que ese jugador tiene derecho a saber.
export function viewFor(s, pid) {
  const me = byId(s, pid);
  const pres = president(s);
  const over = s.phase === 'gameover';
  const knowsTeam = !!me && (me.role === 'fascist' || (me.role === 'hitler' && s.players.length <= 6));
  const isPres = !!me && me.alive && me.id === pres.id;
  const isChan = !!me && me.alive && me.id === s.chancellorId;

  let targets = [];
  if (isPres && s.phase === 'power') {
    targets = aliveList(s)
      .filter((p) => p.id !== pres.id && !(s.power === 'investigate' && s.investigated.includes(p.id)))
      .map((p) => p.id);
  }

  return {
    me: pid,
    phase: s.phase,
    players: s.players.map((p) => ({
      id: p.id,
      name: p.name,
      alive: p.alive,
      role: over || p.id === pid ? p.role : knowsTeam && p.role !== 'liberal' ? p.role : null,
    })),
    playerCount: s.players.length,
    presidentId: pres.id,
    chancellorId: s.chancellorId,
    nomineeId: s.nomineeId,
    tracker: s.tracker,
    liberal: s.liberal,
    fascist: s.fascist,
    deckCount: s.deck.length,
    discardCount: s.discard.length,
    powerTrack: powerTrack(s.players.length),
    voted: Object.keys(s.votes),
    myVote: pid in s.votes ? s.votes[pid] : null,
    lastVote: s.lastVote,
    eligible: isPres && s.phase === 'nominate' ? eligibleChancellors(s) : [],
    targets,
    hand: (s.phase === 'presidentDiscard' && isPres) || (s.phase === 'chancellorDiscard' && isChan) ? [...s.hand] : [],
    vetoAvailable: s.fascist >= 5 && !s.vetoBlocked,
    power: s.phase === 'power' ? s.power : null,
    powerResult: isPres && s.phase === 'powerAck' ? s.powerResult : null,
    notes: [...(s.notes[pid] ?? [])],
    confirmedNotHitler: [...s.confirmedNotHitler],
    log: s.log.slice(-60),
    winner: s.winner,
    winReason: s.winReason,
  };
}

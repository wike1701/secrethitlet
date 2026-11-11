import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, act, viewFor, DIST } from '../src/game.js';
import { botAction } from '../src/bots.js';

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mk = (n, seed = 1) => createGame(Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'J' + i })), { seed });
const pres = (s) => s.players[s.presidentIdx];
const visibleRoles = (s, pid) => viewFor(s, pid).players.filter((p) => p.role !== null).length;
// Garantiza que Hitler no sea el presidente actual (intercambia roles con otro jugador).
function hitlerNotPresident(s) {
  const p = pres(s);
  if (p.role !== 'hitler') return;
  const other = s.players.find((x) => x.id !== p.id);
  [p.role, other.role] = [other.role, p.role];
}

test('reparto de roles correcto para 5 a 10 jugadores', () => {
  for (let n = 5; n <= 10; n++) {
    const s = mk(n);
    const count = (r) => s.players.filter((p) => p.role === r).length;
    assert.equal(count('liberal'), DIST[n][0]);
    assert.equal(count('fascist'), DIST[n][1]);
    assert.equal(count('hitler'), 1);
  }
});

test('la misma semilla produce la misma partida', () => {
  assert.deepEqual(mk(7, 99), mk(7, 99));
  assert.notDeepEqual(mk(7, 99).deck, mk(7, 100).deck);
});

test('cada jugador solo ve los roles que le corresponden', () => {
  const s7 = mk(7);
  const find = (s, r) => s.players.find((p) => p.role === r).id;
  assert.equal(visibleRoles(s7, find(s7, 'liberal')), 1); // solo el suyo
  assert.equal(visibleRoles(s7, find(s7, 'fascist')), 3); // él, el otro fascista y Hitler
  assert.equal(visibleRoles(s7, find(s7, 'hitler')), 1); // con 7+ Hitler no conoce a nadie
  const s5 = mk(5);
  assert.equal(visibleRoles(s5, find(s5, 'hitler')), 2); // con 5-6 Hitler conoce al fascista
  assert.equal(visibleRoles(s5, find(s5, 'fascist')), 2);
});

test('la mano solo la ve quien la tiene en su turno', () => {
  const s = mk(5);
  hitlerNotPresident(s);
  const p = pres(s);
  const c = s.players.find((x) => x.id !== p.id);
  act(s, p.id, { type: 'nominate', target: c.id });
  for (const pl of s.players) act(s, pl.id, { type: 'vote', vote: true });
  assert.equal(s.phase, 'presidentDiscard');
  for (const pl of s.players) assert.equal(viewFor(s, pl.id).hand.length, pl.id === p.id ? 3 : 0);
  act(s, p.id, { type: 'presidentDiscard', index: 0 });
  for (const pl of s.players) assert.equal(viewFor(s, pl.id).hand.length, pl.id === c.id ? 2 : 0);
});

test('Hitler elegido canciller con 3 leyes fascistas: ganan los fascistas', () => {
  const s = mk(5);
  hitlerNotPresident(s);
  s.fascist = 3;
  const hit = s.players.find((p) => p.role === 'hitler');
  assert.ok(act(s, pres(s).id, { type: 'nominate', target: hit.id }).ok);
  for (const pl of s.players) act(s, pl.id, { type: 'vote', vote: true });
  assert.equal(s.winner, 'fascist');
});

test('ejecutar a Hitler da la victoria liberal', () => {
  const s = mk(5);
  hitlerNotPresident(s);
  s.phase = 'power';
  s.power = 'execute';
  const hit = s.players.find((x) => x.role === 'hitler');
  assert.ok(act(s, pres(s).id, { type: 'power', target: hit.id }).ok);
  assert.equal(s.winner, 'liberal');
});

test('investigar deja una nota privada solo para el presidente', () => {
  const s = mk(9);
  s.phase = 'power';
  s.power = 'investigate';
  const p = pres(s);
  const t = s.players.find((x) => x.id !== p.id);
  assert.ok(act(s, p.id, { type: 'power', target: t.id }).ok);
  assert.equal(viewFor(s, p.id).notes.length, 1);
  assert.equal(viewFor(s, p.id).notes[0].party, t.role === 'liberal' ? 'liberal' : 'fascist');
  assert.equal(viewFor(s, t.id).notes.length, 0);
  assert.equal(act(s, p.id, { type: 'ack' }).ok, true);
});

test('no se puede nominar al canciller anterior ni actuar fuera de turno', () => {
  const s = mk(7);
  const p = pres(s);
  const other = s.players.find((x) => x.id !== p.id);
  assert.equal(act(s, other.id, { type: 'nominate', target: p.id }).ok, false);
  s.lastChancellorId = other.id;
  assert.equal(act(s, p.id, { type: 'nominate', target: other.id }).ok, false);
  assert.equal(act(s, p.id, { type: 'nominate', target: p.id }).ok, false);
  assert.equal(act(s, 'nadie', { type: 'vote', vote: true }).ok, false);
});

test('tres gobiernos fallidos promulgan la ley superior y limpian los límites', () => {
  const s = mk(5);
  for (let i = 0; i < 3; i++) {
    const p = pres(s);
    const t = s.players.find((x) => x.id !== p.id && x.id !== s.lastChancellorId);
    assert.ok(act(s, p.id, { type: 'nominate', target: t.id }).ok);
    for (const pl of s.players) act(s, pl.id, { type: 'vote', vote: false });
  }
  assert.equal(s.liberal + s.fascist, 1);
  assert.equal(s.tracker, 0);
  assert.equal(s.lastChancellorId, null);
});

test('la elección especial devuelve la presidencia al jugador siguiente al que la convocó', () => {
  const s = mk(8);
  s.phase = 'power';
  s.power = 'special';
  const callerIdx = s.presidentIdx;
  const target = s.players[(callerIdx + 3) % 8];
  assert.ok(act(s, s.players[callerIdx].id, { type: 'power', target: target.id }).ok);
  assert.equal(pres(s).id, target.id);
  // Gobierno rechazado: la presidencia vuelve al de la izquierda del que convocó.
  const t = s.players.find((x) => x.id !== target.id);
  act(s, target.id, { type: 'nominate', target: t.id });
  for (const pl of s.players) act(s, pl.id, { type: 'vote', vote: false });
  assert.equal(s.presidentIdx, (callerIdx + 1) % 8);
});

// Partidas completas con bots: sin errores, siempre terminan y el mazo es consistente.
test('600 partidas aleatorias terminan y conservan las 17 leyes', () => {
  for (let g = 0; g < 600; g++) {
    const r = mulberry32(1000 + g);
    const s = mk(5 + (g % 6), 5000 + g);
    let steps = 0;
    while (s.phase !== 'gameover') {
      assert.ok(++steps < 5000, `partida ${g} no termina`);
      let acted = false;
      for (const p of s.players) {
        const a = botAction(viewFor(s, p.id), r);
        if (!a) continue;
        const res = act(s, p.id, a);
        assert.ok(res.ok, `partida ${g}: ${res.error} (fase ${s.phase})`);
        acted = true;
        break;
      }
      assert.ok(acted, `partida ${g}: nadie puede actuar en la fase ${s.phase}`);
      assert.equal(s.deck.length + s.discard.length + s.hand.length + s.liberal + s.fascist, 17);
    }
    assert.ok(['liberal', 'fascist'].includes(s.winner));
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(s)));
  }
});

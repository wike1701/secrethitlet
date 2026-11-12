import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, act, viewFor } from '../src/game.js';
import { detectEvents } from '../src/fx.js';

const mk = (n = 5, seed = 3) => createGame(Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'J' + i })), { seed });
const pres = (s) => s.players[s.presidentIdx];
const types = (ev) => ev.map((e) => e.type);

// Aplica una acción y devuelve los eventos que vería `viewer`.
function step(s, pid, action, viewer = 'p0') {
  const before = viewFor(s, viewer);
  const r = act(s, pid, action);
  assert.ok(r.ok, r.error);
  return detectEvents(before, viewFor(s, viewer));
}
function nominate(s, nominee) {
  const target = nominee ?? viewFor(s, pres(s).id).eligible[0];
  return { ev: step(s, pres(s).id, { type: 'nominate', target }), target };
}
function voteAll(s, yes) {
  let ev = [];
  for (const p of s.players.filter((x) => x.alive)) ev = step(s, p.id, { type: 'vote', vote: yes });
  return ev;
}

test('al empezar una partida se anuncia al primer presidente', () => {
  const s = mk();
  const ev = detectEvents(null, viewFor(s, 'p0'));
  assert.deepEqual(ev, [{ type: 'president', id: pres(s).id, first: true }]);
});

test('al reconectarse a mitad de partida no se dispara nada', () => {
  const s = mk();
  nominate(s);
  voteAll(s, false);
  assert.deepEqual(detectEvents(null, viewFor(s, 'p0')), []);
});

test('nominar, aprobar, robar y promulgar', () => {
  const s = mk();
  const { ev, target } = nominate(s);
  assert.deepEqual(types(ev), ['voteCall']);

  const ev2 = voteAll(s, true);
  assert.deepEqual(types(ev2), ['voteResult', 'chancellor', 'draw3']);
  assert.equal(ev2[0].passed, true);
  assert.equal(ev2[1].id, target);

  s.hand = ['liberal', 'liberal', 'fascist'];
  const oldPres = pres(s).id;
  assert.deepEqual(step(s, oldPres, { type: 'presidentDiscard', index: 2 }), []);
  const ev3 = step(s, target, { type: 'chancellorDiscard', index: 0 });
  assert.deepEqual(types(ev3), ['policy', 'president']);
  assert.deepEqual(ev3[0], { type: 'policy', side: 'liberal', chaos: false });
  assert.notEqual(ev3[1].id, oldPres);
});

test('votación rechazada cambia de presidente; tres fallos promulgan en caos', () => {
  const s = mk();
  nominate(s);
  assert.deepEqual(types(voteAll(s, false)), ['voteResult', 'president']);
  nominate(s);
  voteAll(s, false);
  s.deck[0] = 'fascist';
  nominate(s);
  const ev = voteAll(s, false);
  assert.deepEqual(types(ev), ['voteResult', 'policy', 'president']);
  assert.deepEqual(ev[1], { type: 'policy', side: 'fascist', chaos: true });
});

test('ejecución y victoria según el bando de quien mira', () => {
  const s = mk();
  s.fascist = 3;
  s.phase = 'power';
  s.power = 'execute';
  const hitler = s.players.find((p) => p.role === 'hitler' && p.id !== pres(s).id)
    ?? (() => { const p = s.players.find((x) => x.id !== pres(s).id); const h = s.players.find((x) => x.role === 'hitler'); [p.role, h.role] = [h.role, p.role]; return p; })();
  const lib = s.players.find((p) => p.role === 'liberal');
  const fas = s.players.find((p) => p.role !== 'liberal' && p.id !== hitler.id) ?? hitler;
  const before = { lib: viewFor(s, lib.id), fas: viewFor(s, fas.id) };
  assert.ok(act(s, pres(s).id, { type: 'power', target: hitler.id }).ok);
  const evLib = detectEvents(before.lib, viewFor(s, lib.id));
  assert.deepEqual(types(evLib), ['execute', 'gameover']);
  assert.equal(evLib[0].id, hitler.id);
  assert.deepEqual(evLib[1], { type: 'gameover', winner: 'liberal', won: true });
  assert.equal(detectEvents(before.fas, viewFor(s, fas.id)).at(-1).won, false);
});

test('el poder de mirar las 3 leyes suena como robar cartas', () => {
  const s = mk(5);
  s.fascist = 2;
  const { target } = nominate(s);
  voteAll(s, true);
  s.hand = ['fascist', 'fascist', 'fascist'];
  step(s, pres(s).id, { type: 'presidentDiscard', index: 0 });
  const ev = step(s, target, { type: 'chancellorDiscard', index: 0 });
  assert.deepEqual(types(ev), ['policy', 'draw3']);
  assert.equal(ev[1].peek, true);
});

test('una partida nueva tras otra terminada vuelve a anunciar presidente', () => {
  const ended = viewFor(mk(), 'p0');
  ended.phase = 'gameover';
  const s = mk(5, 8);
  assert.deepEqual(types(detectEvents(ended, viewFor(s, 'p0'))), ['president']);
});

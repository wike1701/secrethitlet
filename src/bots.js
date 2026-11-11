// Jugador automático que juega al azar a partir de su vista. Sirve para los tests
// y para probar el juego sin reunir a 5 personas (modo desarrollo: ?dev en la URL).
export function botAction(v, rand = Math.random) {
  if (!v) return null;
  const me = v.players.find((p) => p.id === v.me);
  if (!me || !me.alive) return null;
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  switch (v.phase) {
    case 'nominate':
      return v.eligible.length ? { type: 'nominate', target: pick(v.eligible) } : null;
    case 'vote':
      return v.myVote === null ? { type: 'vote', vote: rand() < 0.65 } : null;
    case 'presidentDiscard':
      return v.hand.length === 3 ? { type: 'presidentDiscard', index: Math.floor(rand() * 3) } : null;
    case 'chancellorDiscard':
      if (v.hand.length !== 2) return null;
      if (v.vetoAvailable && rand() < 0.2) return { type: 'chancellorDiscard', veto: true };
      return { type: 'chancellorDiscard', index: Math.floor(rand() * 2) };
    case 'vetoDecision':
      return v.presidentId === v.me ? { type: 'vetoResponse', agree: rand() < 0.5 } : null;
    case 'power':
      return v.targets.length ? { type: 'power', target: pick(v.targets) } : null;
    case 'powerAck':
      return v.presidentId === v.me && v.powerResult ? { type: 'ack' } : null;
    default:
      return null;
  }
}

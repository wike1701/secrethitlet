// Configuración de red.
// Por defecto se usa el servidor de señalización gratuito de PeerJS (0.peerjs.com), que solo
// sirve para que los navegadores se encuentren; la partida viaja directamente entre ellos.
// Si algún jugador no consigue conectar (datos móviles, redes de empresa o universidad...),
// añade un servidor TURN en iceServers (hay servicios con capa gratuita).
export const PEER_OPTIONS = {
  debug: 1,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      // { urls: 'turn:TU_SERVIDOR_TURN:3478', username: 'usuario', credential: 'clave' },
    ],
  },
};

# SecretHitlet: contexto para Claude

Adaptación online no comercial de Secret Hitler (CC BY-NC-SA 4.0), en español. Web estática sin build:
módulos ES nativos y PeerJS cargado desde CDN en `index.html`. Sin dependencias de npm.

## Comandos
- `npm test`: pruebas con `node --test` (deben pasar siempre antes de dar algo por terminado).
- `npm start`: servidor estático en http://localhost:8080 (`/?dev` activa bots).

## Arquitectura (de dentro hacia fuera)
1. `src/game.js`: reglas puras. `createGame`, `act(state, playerId, action)` → `{ok, error}`,
   `viewFor(state, playerId)` → vista filtrada. El estado es JSON serializable, incluido el RNG (`s.rng`).
   Nunca uses `Math.random` aquí: usa `rand(s)`.
2. `src/room.js`: `HostRoom`, sin dependencias de red. Protocolo:
   - cliente → anfitrión: `{t:'hello', name, token}`, `{t:'act', action}`, `{t:'leave'}`, `{t:'ping'}`
   - anfitrión → cliente: `{t:'welcome', you}`, `{t:'state', room, game}`, `{t:'error', message, fatal?}`, `{t:'kicked'}`
   - Órdenes solo del anfitrión: `start`, `newGame`, `toLobby`, `kick`, `addBot` (solo en modo dev).
3. `src/net.js`: PeerJS. Id del anfitrión = `secrethitlet-v1-<CÓDIGO>`. Latidos cada 4 s y timeout de 15 s.
4. `src/ui.js`: repinta todo con `innerHTML` desde el objeto `ui`. Botones con `data-a="acción"`.
   Escapa SIEMPRE con `esc()` cualquier texto que venga de jugadores.

## Reglas del proyecto
- Toda la información secreta se filtra en `viewFor`; la interfaz nunca debe recibir datos que el jugador no pueda ver.
- Los roles ajenos y las notas solo se muestran con el rol desplegado (privacidad ante quien mire la pantalla).
- Textos de la interfaz en español. No usar ilustraciones ni textos originales del juego (copyright).
- Al cambiar reglas o protocolo, añade o ajusta pruebas en `test/`.

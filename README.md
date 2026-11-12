# SecretHitlet

Adaptación online y no comercial de **Secret Hitler** para 5–10 jugadores, jugable desde el navegador.
No necesita servidor propio: la partida corre en el navegador de quien la crea (el anfitrión) y el resto
se conecta directamente a él por WebRTC (PeerJS). Nadie tiene que instalar nada ni tocar el router.

## Probarlo en tu PC

Necesitas [Node.js](https://nodejs.org) 20 o superior.

```bash
npm start          # sirve la web en http://localhost:8080
npm test           # ejecuta todas las pruebas
```

- `http://localhost:8080/?dev` activa el **modo desarrollo**: el anfitrión puede añadir bots para
  probar una partida completa sin reunir a 5 personas.
- Para simular varios jugadores en el mismo PC, abre cada uno en una **pestaña distinta** (cada pestaña
  es un jugador diferente).

## Jugar con otras personas

El anfitrión no necesita servidor, pero **todos tienen que poder abrir la página**. `localhost` solo
funciona en tu PC, así que hay que publicar la carpeta en un hosting estático gratuito. La forma más
sencilla es GitHub Pages:

1. Crea un repositorio en GitHub (por ejemplo `secrethitlet`) y sube el contenido de esta carpeta.
2. En el repositorio: **Settings → Pages → Source: Deploy from a branch**, rama `main`, carpeta `/ (root)`.
3. Al cabo de un minuto la web estará en `https://TU-USUARIO.github.io/secrethitlet/`.

También funciona igual en Netlify o Cloudflare Pages (arrastrando la carpeta).

Después: el anfitrión pulsa **Crear partida**, comparte el enlace o el código de 5 letras, y cuando haya
5 o más jugadores pulsa **Empezar partida**. Las conversaciones se hacen por vuestro canal de voz habitual.

## Cómo funciona

```
index.html, style.css
src/game.js    Reglas puras (sin red ni DOM). Estado en JSON, con su propio generador aleatorio.
src/bots.js    Jugador automático al azar (pruebas y modo desarrollo).
src/avatars.js Avatares de jugador y retratos de cada rol (SVG propio).
src/room.js    Sala del anfitrión: jugadores, reconexiones, órdenes y vistas filtradas por jugador.
src/net.js     Transporte PeerJS: anfitrión con id fijo según el código, latidos y reconexión.
src/config.js  Servidores STUN/TURN.
src/ui.js      Interfaz (pantallas de inicio, sala y partida).
serve.js       Servidor estático para desarrollo.
test/          Pruebas: reglas, sala y una partida completa jugada desde la interfaz.
```

- **El anfitrión es la autoridad.** Los demás solo envían acciones; el anfitrión las valida y manda a cada
  jugador únicamente lo que puede ver (su rol, su mano, sus notas secretas).
- **Reconexión.** Si un jugador recarga la página, vuelve a su sitio automáticamente. Si el anfitrión
  recarga, la partida se reanuda desde donde estaba (se guarda en su navegador).

## Limitaciones conocidas

- Si el anfitrión cierra la pestaña, la partida se pausa hasta que vuelva a abrirla (puede reanudarla
  desde la pantalla de inicio).
- El anfitrión, técnicamente, podría inspeccionar el estado completo de la partida. Para jugar entre
  amigos no importa; para un juego público haría falta un servidor central.
- Algunas redes (datos móviles, redes de empresa o universidad) bloquean las conexiones directas.
  Si alguien no consigue conectar, añade un servidor TURN en `src/config.js`.
- La señalización usa el servidor gratuito de PeerJS; si algún día falla, se puede montar uno propio
  con `peerjs-server`.

## Licencia

Secret Hitler es obra de Goat, Wolf & Cabbage, publicada bajo licencia
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). Este proyecto es una adaptación
no comercial y debe mantenerse así, con la misma licencia y citando a los autores. Los textos y el
diseño visual son propios; no se usan las ilustraciones originales.

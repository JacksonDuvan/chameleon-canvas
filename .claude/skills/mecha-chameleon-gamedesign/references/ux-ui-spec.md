# Especificación de UX/UI — clon de Meccha Chameleon
 
Detalle de pantallas, HUD y controles para el clon web. Las mecánicas están en el
`SKILL.md`; aquí está lo que ve y toca el jugador. Todo lo visual se construye con
las reglas de `r3f-rendering` (estado lento por hooks selectores, nada de `setState`
por frame) y en las features del frontend (`canvas-3d`, `matchmaking`,
`monetization`).
 
## Principio rector de UI
 
El juego es una competición de **observación**. La UI debe **quitarse de en medio**
durante la observación (hunt, inspección de pintura) y ser **precisa y rápida**
durante la preparación (donde el temporizador presiona). La superficie de UI más
importante y difícil es el **panel de pintura**: es casi un mini editor de arte
dentro de un juego 3D.
 
## Controles: teclado/ratón y táctil
 
El original es PC (teclado + ratón). Los keybinds son observados por la comunidad,
no oficiales; tu clon define los suyos y muestra **prompts en vivo en el HUD**. Base
de teclado/ratón sugerida:
 
| Acción                    | Sugerido | Notas |
|---------------------------|----------|-------|
| Mover                     | WASD     | una sola velocidad, sin sprint |
| Mirar / orbitar cámara    | Ratón    | rueda/medio para orbitar en modo pintura |
| Abrir pintura             | F        | solo en PREPARATION |
| Muestrear (Spoid)         | Click / tecla | raycast al entorno |
| Aplicar pintura           | Click izq. | sobre la región apuntada del cuerpo |
| Abrir rueda de poses      | R        | mantener = rueda; soltar = elegir |
| Agacharse                 | Ctrl     | |
| Trepar / wall-stick       | contextual | subir/bajar para alinear; soltar para moverse |
| Disparar / tag (Seeker)   | Click izq. | consume munición |
| Cambiar cámara TPP/FPP     | tecla    | Hider inspecciona en TPP en prep |
| Chat / voz push-to-talk   | tecla    | voz de proximidad opcional |
 
**Web/táctil (móvil o Steam Deck-like):** el ratón hace fácil el trabajo fino de
color; en táctil, el pintado con dedo es más natural que con stick. Prevé:
joystick virtual para mover, tap-para-muestrear, un panel de color a pantalla
completa, y pinch/drag para orbitar. Diseña el panel de pintura **primero para el
input más impreciso** que quieras soportar.
 
## HUD (durante la ronda)
 
Minimal y no intrusivo. Lee estado **lento** del `worldStore` con hooks selectores
(nunca por frame):
- **Temporizador de fase**, grande y legible ("hasta que empiece la búsqueda" en
  prep; cuenta atrás de caza en hunt).
- **Indicador de fase/rol** (eres Hider / Seeker).
- **Munición del Seeker** (disparos restantes) — solo para Seekers.
- **Contador de Hiders restantes** / progreso de la ronda.
- **Prompts contextuales en vivo** en el borde inferior (p. ej. "F: pintar",
  "R: pose", "wall-stick disponible", y el aviso **"cuerpo demasiado enterrado"**).
- Sin minimapa para el Seeker (caza por observación); opcional para Hider en prep.
## Panel de pintura (Meccha Paint) — PREPARATION
 
Es la pantalla más rica. Se abre con F. Layout de referencia:
 
- **Vista del personaje en 3D** (centro), orbitar con rueda/drag para pintar e
  inspeccionar desde el ángulo del Seeker. En `MechaMesh` con material
  `meshStandardMaterial`.
- **Rueda de color + sliders HSV/RGB + entrada hex** (lateral).
- **Spoid (cuentagotas):** al activarlo, el cursor muestrea del **entorno 3D** (no
  del cuerpo) por raycast → `useRaycastColor.ts`. Muestra el color capturado y
  permite ajustarlo con HSV antes de aplicar (la luz cambia el tono más de lo que
  parece; muestrea la superficie exacta que vas a tocar, incluida su **sombra**).
- **Sliders Metallic y Roughness:** cómo capta la luz. Prevé una previsualización
  bajo la iluminación del sitio final.
- **Swatches / temas guardados por mapa.**
- **Patrones de pincel** (stretch): junta de baldosa, borde de marco, cuadrícula.
- **Undo / Clear.**
- **Regiones del cuerpo** (MVP): selector para pintar torso/cabeza/brazos/piernas
  por separado; cada aplicación = un `ChangeColor` confirmado al servidor.
Guía visible del flujo experto: base → sombra → bloques grandes → textura. Anima al
jugador a **inspeccionar en tercera persona desde la dirección de spawn del Seeker**
antes de que acabe prep ("cuidado con los codos blancos").
 
## Rueda de poses — PREPARATION
 
- Overlay radial (mantener R) con: de pie, agachado, bola/curl, wall-flat, y poses
  contextuales según la superficie cercana.
- Al elegir, la malla adopta la postura leyendo el estado desde el `worldStore`.
- Mensaje de diseño: **pose primero, pinta después** para encajar la silueta.
- En wall-stick, mostrar prompts finos de alinear (subir/bajar) y soltar.
## Vista del Seeker — HUNT
 
- **Primera persona, sin linterna.** Retícula/mira simple.
- **Contador de munición** prominente (el recurso escaso).
- Feedback de disparo: acierto (tag confirmado + evento de score) vs fallo
  (munición gastada). El `EVENT` de hit llega del servidor; nunca lo decide el
  cliente.
- Sensibilidad de ratón lo bastante baja para inspeccionar paredes con calma.
- Al ser eliminado (Hider) o al acabar: espectador / cámara libre.
## Pantalla de resultados / Answer-check — RESULTS
 
- **Revela todos los escondites y trabajos de pintura** de la ronda. Es el momento
  más divertido y la principal herramienta de aprendizaje: muéstralo siempre, se
  gane o se pierda.
- Recorre a cada Hider mostrando dónde estaba y su disfraz; destaca por qué se le
  vio o no (silueta, color, brillo).
- Anuncia el equipo ganador. El **host** puede iniciar otra ronda o volver al lobby.
## Lobby y salas — LOBBY
 
Feature `matchmaking` (`RoomForm`, `PlayerList`, `useGameSockets`):
- **Crear sala:** nombre, contraseña (privada), región, tags, mapa y modo. El host
  configura y arranca.
- **Buscar/unirse:** browser de salas públicas o unión por código; filtrar por
  región/tags. (En el original, muchos problemas de "no encuentro la sala" vienen de
  región/tags/contraseña mal copiados: haz esos campos claros y validados.)
- **Lista de jugadores** con roles/estado. 2–10 recomendados; el máximo depende de
  la conexión del host (en tu caso, del presupuesto del Durable Object; ver
  `authoritative-netcode` y `workers-memory-optimization`).
- Selector de modo con explicación breve (Normal / Infección / Double).
## Accesibilidad y "juego" del color
 
Como la mecánica central es el color, cuida a jugadores con daltonismo: no bases
ninguna **regla** en distinguir colores (el camuflaje es percepción del rival, no un
check del sistema, así que es seguro), pero sí ofrece sliders numéricos (HSV/RGB/hex)
y valores exactos del Spoid para no depender del ojo. Contraste alto en HUD y
temporizadores. Prompts en texto además de iconos.
 
## Qué NO hacer en la UI
 
- No metas estado de UI que cambie por frame en React (temporizador: actualiza el
  texto ~1/s, no cada frame; ver `r3f-rendering`).
- No muestres a los Seekers el mapa ni la pintura de los Hiders durante PREPARATION.
- No dejes que el cliente decida un tag/impacto ni la munición; solo refleja el
  `EVENT` del servidor.
- No bloquees la observación con overlays durante HUNT.

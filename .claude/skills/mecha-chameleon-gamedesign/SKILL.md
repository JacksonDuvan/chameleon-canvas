---
name: mecha-chameleon-gamedesign
description: >-
  Biblia de mecánicas de juego y diseño UX/UI del clon de Meccha Chameleon
  (めっちゃカメレオン): un hide-and-seek multijugador donde los Hiders (camaleones
  blancos) se pintan para camuflarse en el escenario y los Seekers los cazan en
  primera persona con disparos limitados. Usa esta skill SIEMPRE que se
  implemente, ajuste o revise una característica de juego: el bucle de partida y
  sus fases (lobby, preparación, búsqueda, resultados), el sistema de pintura
  (Meccha Paint / Spoid / paleta / metallic-roughness), el sistema de poses, la
  mecánica del Seeker (arma, disparos limitados, tagging, resolución de impacto),
  el movimiento, los modos de juego (Normal, Infección, Double), los mapas, el
  HUD, las pantallas (paint UI, pose wheel, results/answer-check, lobby), la
  cámara, la monetización cosmética, o al decidir qué es autoritativo vs
  predicho. Define QUÉ construir para que el clon sea fiel al original; el CÓMO
  técnico se apoya en las skills de arquitectura, netcode, render y memoria.
  Aplícala antes de diseñar o codificar cualquier feature de gameplay o de UI.
---
 
# Diseño de juego y UX/UI — Meccha Chameleon (clon)
 
Esta skill es la fuente de verdad de **qué** hace el juego. Describe las mecánicas
del original de forma fiel y las traduce a requisitos implementables sobre tu
stack (slices del backend, use-cases, hooks de `canvas-3d`, netcode). El **cómo**
de cada pieza vive en las otras skills: arquitectura (`hexagonal-vertical-slicing`),
sincronización (`authoritative-netcode`), render (`r3f-rendering`), memoria
(`workers-memory-optimization`) y tests (`tdd-testing`).
 
Sobre el original: *Meccha Chameleon* (めっちゃカメレオン; "meccha" = "muchísimo" en
dialecto de Kansai) es un juego indie de lemorion_1224, lanzado en Steam en junio
de 2026, para 2–10 jugadores por sala. **Advertencia de fidelidad:** Steam no
publica una tabla oficial de controles ni de tiempos; muchos detalles (keybinds,
duraciones de fase, economía de disparos, ausencia de ítems) son *observados por
la comunidad*, no documentación oficial. Trata las constantes de abajo como
**valores por defecto ajustables de tu clon**, no como cifras canónicas, y define
tus propias reglas autoritativas.
 
## El concepto y el bucle central
 
Cada jugador empieza como un camaleón bípedo **blanco puro**. Dos equipos:
- **Hiders (camaleones):** el grupo grande. Se pintan y posan para volverse
  indistinguibles del escenario.
- **Seekers (Oni / cazadores):** el grupo pequeño. Cazan en **primera persona** y
  usan un arma con **disparos limitados** para marcar (tag) a quien parezca
  sospechoso.
El bucle de una ronda, memorizable como cuatro tiempos: **el escenario → la pose →
el color local → la quietud.** El juego premia la observación y la creatividad, no
los reflejos: no hay ítems, buffs, consumibles ni builds (consenso de la comunidad,
no confirmado por el dev). Tus únicas "herramientas" son la paleta, el Spoid, el
menú de poses y el arma del Seeker.
 
**Condiciones de victoria:** los Hiders ganan si **al menos uno** sobrevive hasta
que el temporizador de búsqueda llega a cero. Los Seekers ganan si encuentran a
**todos** los Hiders antes de que se acabe el tiempo.
 
## Máquina de estados de la partida
 
El servidor (el `GameRoomDO`) es autoritativo sobre la fase actual y el
temporizador. Modela la ronda como una máquina de estados explícita en el dominio:
 
```
LOBBY → ASSIGNMENT → PREPARATION → HUNT → RESULTS → (LOBBY | PREPARATION)
```
 
1. **LOBBY.** El host elige mapa, modo y privacidad (público / privado con
   contraseña, región, tags). Los jugadores entran vía browser de salas o código.
   2–10 jugadores recomendados. → slice `matchmaking` + `PlayerJoin`.
2. **ASSIGNMENT.** El sistema reparte roles según el modo y el número de jugadores
   (Hiders = grupo grande, Seekers = grupo pequeño). En modos de infección los
   roles cambian durante la ronda.
3. **PREPARATION.** Los Hiders aparecen en el mapa y se mueven libres para elegir
   sitio, pintarse y fijar una pose. Los **Seekers están confinados al spawn y no
   ven el mapa** (importante: durante prep no necesitas replicar el estado de
   pintura a los Seekers). Un temporizador visible ("hasta que empiece la
   búsqueda") marca el fin. → use-case `ProcessTick` avanza la fase; la pintura se
   confirma con `ChangeColor`.
4. **HUNT.** Termina prep; los Seekers se liberan y deben encontrar y "golpear" a
   todos los Hiders antes de que expire el temporizador. Ahora **sí** se replica a
   los Seekers el estado de pintura/pose/posición de los Hiders.
5. **RESULTS / Answer-check.** Se revelan todos los escondites y trabajos de
   pintura (es el momento más divertido y una herramienta de aprendizaje). El host
   puede iniciar otra ronda.
Los tiempos exactos no son oficiales. Puntos de partida razonables para tu clon:
prep ~45–90 s, hunt ~120–240 s, results ~15–30 s. Hazlos constantes de
configuración por mapa/modo, no números mágicos.
 
## El sistema Meccha Paint (el corazón del juego)
 
El cuerpo empieza como lienzo blanco. El jugador lo pinta para engañar al ojo del
Seeker **a la distancia y ángulo a los que inspeccionará**, no para lograr
perfección artística. El menú de pintura es más un pequeño programa de arte que un
menú de juego.
 
Componentes del original (replícalos con el nivel de fidelidad que elijas):
- **Spoid (cuentagotas 3D):** muestrea el color exacto de una superficie del mundo
  (pared, suelo, prop, y también sombras). Es *la* herramienta clave. En tu clon
  esto es un **raycast desde la cámara/cursor a la malla del entorno** que lee el
  color del punto de impacto → **ya lo tienes previsto en `useRaycastColor.ts`**.
- **Paleta / rueda de color:** sliders RGB y HSV, entrada hex, swatches, y **temas
  de color guardados por mapa** (para preparar más rápido en rondas futuras).
- **Metallic y roughness:** ajustan cómo el cuerpo capta la luz (brillo). Es el
  control que más ignoran los novatos y el que más delata (un cuerpo mate sobre una
  pared brillante canta). En R3F esto mapea directo a `meshStandardMaterial`
  (`metalness`, `roughness`).
- **Patrones de pincel:** extender líneas de junta de baldosa, bordes de marco,
  cuadrícula tipo ajedrez. Nivel avanzado.
- **Undo / clear.**
Flujo estándar del jugador experto (documéntalo en la UI como guía): muestrear
**color base** con el Spoid → muestrear un **tono de sombra** más oscuro → rellenar
**bloques grandes** → añadir **líneas de textura/patrón** al final. Pintar bloques
grandes primero y detalles después es más rápido bajo la presión del temporizador.
 
Niveles de habilidad que tu diseño debe soportar (dan profundidad sin cambiar
reglas):
- **Básico:** relleno de color sólido.
- **Intermedio:** gradientes muestreados del suelo, copia parcial de patrones en
  bordes de muebles.
- **Avanzado:** réplica completa de patrones (ajedrez, baldosas, marcos de cuadro),
  mezclas multi-superficie.
- **Sin pintura:** mimetismo de objeto vía pose (hacerse un globo, una caja),
  válido en esquinas de silueta uniforme.
### Implementación de la pintura en el clon
 
La pintura **no** es dato de tick (twitchy); es estado que se fija en PREPARATION y
se confirma al servidor. Dos niveles de fidelidad:
 
- **MVP recomendado — pintura por regiones:** divide el cuerpo del camaleón en N
  regiones (torso, cabeza, brazos, piernas…). Cada región = un `ColorRGBA` +
  `metallic` + `roughness`. Estado compacto, trivial de sincronizar y de validar en
  el servidor. Encaja con tu value object `ColorRGBA` y el use-case `ChangeColor`
  ("absorción de color": el jugador muestrea con el Spoid y aplica el color a la
  región apuntada).
- **Stretch — pintura de textura:** pintar sobre una textura UV del modelo (canvas
  → `CanvasTexture` en Three.js) para patrones libres. Mucho más caro de
  sincronizar (envía deltas del canvas o un blob comprimido al confirmar, nunca por
  tick) y de validar. No lo metas en el MVP.
Reglas de sincronización: el color se aplica **localmente al instante** (feedback
inmediato en `MechaMesh`), y se **confirma al servidor** vía `ChangeColor`, que
valida (¿la fase permite pintar?, ¿la región existe?, ¿rate-limit?) y devuelve
`Result` (ver `hexagonal-vertical-slicing` y `authoritative-netcode`). El servidor
guarda el estado de pintura por jugador y lo difunde a los Seekers al empezar HUNT.
 
## El sistema de Pose
 
El color no basta: un camaleón es un humanoide bípedo, y esa silueta erguida te
delata. **Los Seekers reconocen formas humanas antes que fallos de color.** Las
poses rompen la silueta a nivel estructural.
 
- La **Pose Wheel** (rueda de poses) ofrece: de pie, agachado, hecho una bola
  (curl), aplastado contra la pared (wall-flat), y poses según contexto.
- Regla de diseño: **pose primero, luego pinta para encajar en esa forma final**,
  no al revés.
- **Wall-stick:** pegarse a una superficie para posar como cuadro, rejilla de
  ventilación o accesorio, fuera del suelo. Controles finos para subir/bajar y
  alinearse a un marco o borde de estante, y soltar para moverse.
En el clon: la pose es un **estado enumerado** en la entidad `Player` (parte del
mundo autoritativo, se sincroniza como el resto del estado). La animación/postura
de la malla se resuelve en `MechaMesh.tsx` leyendo ese estado desde el `worldStore`
(sin `setState` por frame; ver `r3f-rendering`). Una pose que "no encaja" (demasiado
centrada, demasiado erguida) delata más rápido que una pintura imperfecta:
considera exponer una vista en tercera persona durante prep para que el jugador
inspeccione su propia silueta.
 
## El Seeker (cazador)
 
- Caza en **primera persona, sin linterna**. Barre el mapa buscando cualquier cosa
  que parezca fuera de lugar.
- **Arma con disparos limitados** (economía de disparos / "salud" del intento). Los
  disparos fallados gastan el recurso; en rondas casuales el castigo puede ser
  leve, pero siempre cuestan tiempo y atención. Dispara solo con una razón: forma
  rara, sonido, cambio en el marcador, sombra extraña, patrón de pared roto, un
  objeto que no pertenece.
- **Tag por impacto:** click izquierdo dispara/marca. Si un disparo confirma a un
  Hider, este queda encontrado (eliminado o convertido según el modo).
- Ritmo de búsqueda: barrer rápido primero, luego frenar en estantes, esquinas,
  cortinas, techos y cambios de marcador.
- Puede existir una vista "see-through" o cámara libre de espectador tras ser
  eliminado.
En el clon (ver `authoritative-netcode`):
- El disparo es un **comando de input** (raycast desde la cámara del Seeker). El
  **servidor valida el impacto** (¿el rayo golpea la cápsula de un Hider?),
  aplicando **lag compensation** al instante en que el Seeker vio la escena.
- El servidor lleva la **economía de disparos** por Seeker (decrementa por disparo,
  no permite disparar sin munición). Nunca confíes en un "acerté" afirmado por el
  cliente.
- El "cambio en el marcador" como pista sugiere feedback de puntuación al encontrar
  a alguien; modela un evento `EVENT` (hit confirmado / score) que el cliente
  muestra en el HUD.
## Movimiento
 
- **WASD + ratón** para mirar. **Una sola velocidad** (no hay sprint): el skill
  está en planear la ruta y llegar al sitio antes de que acabe prep, no en correr.
- **Agacharse** para colarse bajo muebles y alcanzar sitios a ras de suelo por
  debajo de la altura de cámara del Seeker.
- **Trepar / wall-stick** para sitios elevados.
- **Aviso de "demasiado enterrado":** cuando el jugador empuja demasiado dentro de
  una pared u objeto. En el clon, es una validación del servidor sobre la posición
  (clamp + feedback), no una decisión del cliente.
Movimiento = camino caliente de netcode: **predicción + reconciliación** para el
jugador local, **interpolación** para los remotos (ver `authoritative-netcode`).
La pintura y la pose NO son camino caliente.
 
## Modos de juego
 
El host elige el modo en el lobby; todos comparten el núcleo pintar-y-esconder. Lo
que cambia es **qué pasa cuando atrapan a un Hider**:
 
- **Normal:** hide-and-seek clásico. Los Hiders atrapados quedan eliminados
  (espectan hasta la siguiente ronda). Bueno para 2–4 jugadores, rondas cortas y
  legibles.
- **Infección / "Increasing Oni":** el Hider atrapado **se convierte en Seeker**;
  la tensión sube según crece el bando cazador. Escala mejor con 6–10.
- **Double:** todos pasan tiempo como Hider **y** como Seeker en una misma ronda
  estructurada; premia a quien es fuerte en ambos lados.
Modela el modo como una **estrategia inyectada** en el slice `gameplay` (una regla
de "qué hacer al ser atrapado" y de asignación de roles). Añadir un modo = una
estrategia nueva, sin `if`s repartidos por `ProcessTick` (OCP; ver
`hexagonal-vertical-slicing`).
 
## Mapas / escenarios
 
Interiores detallados diseñados para esconderse con creatividad: cocinas con
mostradores abarrotados, salas de fiesta con decoración colorida, suelos de
ajedrez, cuadros en la pared, salones de texturas mixtas. Cada mapa debe ofrecer
**a la vez** zonas de alta habilidad de pintura (patrones ricos) y esquinas de
mimetismo de bajo nivel (siluetas uniformes donde casi no hace falta pintar). Las
salas **planas** son más difíciles para disfraces rudimentarios (menos props y
sombras donde esconder la forma). → entidad `GameMap`; el color muestreable sale de
los materiales del `Environment.tsx`.
 
## Autoritativo vs cliente (resumen para netcode)
 
- **Servidor autoritativo:** fase y temporizador, asignación de equipos, posición
  y pose (estado del mundo), estado de pintura confirmado, economía de disparos,
  resolución de impacto/tag con lag compensation, condición de victoria, "demasiado
  enterrado" (clamp de posición).
- **Predicho en cliente:** movimiento del jugador local (Hider en prep, Seeker en
  hunt) con reconciliación.
- **Interpolado:** posición/pose de los demás durante hunt.
- **Aplicado local + confirmado (no por tick):** pintura y selección de pose.
- **Solo presentación (fuera de React, ver `r3f-rendering`):** el render del
  `MechaMesh` pintado, el HUD lento (temporizador, munición) por hooks selectores.
## Monetización fiel
 
El original es un juego de **pura habilidad de camuflaje, sin builds ni gacha**.
Para no romper esa identidad, tu slice `monetization` debe ser **estrictamente
cosmético y no pay-to-win**: skins/temas de color guardables, patrones cosméticos,
emotes/taunts, quizá cosméticos de sala. Nada que dé ventaja de camuflaje o de
economía de disparos. La verificación vive en el slice `monetization` del backend
(puertos + adaptadores a KV/SDK); el frontend (`features/monetization`:
`CosmeticsShop`, `AdPlaceholder`) solo consume el contrato. Los anuncios, si los
hay, van entre rondas o en el lobby, nunca durante hunt.
 
## Alcance del clon: MVP vs stretch
 
- **MVP:** Normal mode; pintura por regiones con Spoid (raycast) + metallic/roughness;
  poses básicas (de pie, agachado, curl, wall-flat); Seeker FPP con disparos
  limitados y tag por raycast; una máquina de estados de ronda completa con
  temporizadores; 1–2 mapas; pantalla de results con reveal; lobby público/privado.
- **Stretch:** modos Infección y Double; pintura de textura libre con patrones;
  temas de color guardados; ranking; espectador/see-through; voz de proximidad;
  workshop/cosméticos.
## Definition of done (para una feature de gameplay)
 
La mecánica coincide con el comportamiento del original descrito arriba (o con una
desviación consciente y documentada); la fase y el temporizador los decide el
servidor; movimiento predicho/reconciliado y remotos interpolados; pintura y pose
aplicadas local y confirmadas con `Result`, nunca por tick; el impacto del Seeker
se valida en servidor con lag compensation y economía de disparos; el modo está
modelado como estrategia inyectada (no `if`s); la monetización relacionada es
cosmética y no pay-to-win; y el HUD/UX correspondiente sigue la
`references/ux-ui-spec.md`.
 
## Referencia
 
- Steam (página oficial): https://store.steampowered.com/app/4704690/MECCHA_CHAMELEON/
- Wiki de la comunidad (mecánicas, modos, controles):
  https://mecchachameleon.wiki/  y  https://mecchachameleonwiki.com/en/gameplay/
- Guía de controles (paint F, pose R, Spoid, metallic/roughness — observado por la
  comunidad): https://meccha-chameleon.wiki/guides/controls/
- Cobertura de mecánicas (Niche Gamer, Mobalytics, GAMES.GG) — ver
  `references/ux-ui-spec.md` para el detalle de pantallas.
- Especificación de UX/UI (HUD, paint panel, pose wheel, results, lobby, controles
  web/táctiles): `references/ux-ui-spec.md`

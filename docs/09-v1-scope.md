# 09 · V1 — objetivo de lanzamiento (clon *lite* web, jugable)

> **Este documento define QUÉ se lanza como V1.** Es el filtro para decidir en qué
> trabajar. El backlog completo vive en [`docs/06`](06-roadmap.md); aquí está el **corte
> V1**. La biblia de mecánicas del original es la skill
> [`mecha-chameleon-gamedesign`](../.claude/skills/mecha-chameleon-gamedesign/SKILL.md).

---

## 1. Visión de V1

Un **clon *lite* jugable en el navegador, sin descargas ni compra**, lo más cercano
posible al **bucle** del original *Meccha Chameleon*. Prioridad, en orden:

1. **Jugable y divertido** — se puede jugar una ronda completa con amigos y engancha.
2. **Funcional** — salas, roles, camuflaje, caza, resultados; robusto.
3. **Fiel al bucle del original** — pintarse, posar, esconderse, ser cazado.
4. **Gráficos: secundarios pero no descuidados** — estilo **low-poly estilizado**
   (cel/flat shading), no fotorrealismo. Ver §5.

> **REGLA INNEGOCIABLE DE V1:** tiene que existir una **forma real de esconderse sin ser
> detectado**. Si un Hider bien camuflado, posado y quieto entre los props NO puede pasar
> desapercibido ante un Seeker que ronda cerca, V1 **no** está listo, por muy bonito que
> se vea.

## 2. Diagnóstico honesto del estado actual (por qué aún no "es" esconderse)

Lo construido en P0 (ver [`docs/08`](08-step-6-camouflage-core.md)) es correcto pero
**no crea la experiencia de esconderse**:

- **Escenario plano y abierto**: zonas de suelo de colores, sin cobertura ni desorden →
  no hay dónde ocultarse; el Seeker ve toda la sala de un vistazo.
- **Avatar = cápsula erguida**: siempre "lee" como jugador, se pinte del color que se pinte.
- **Sin 1ª persona del Seeker**: la cámara es cenital y el apunte deriva del movimiento →
  no hay tensión de *escanear y encontrar*.
- ✅ Lo que **sí** funciona y hay que conservar: camuflaje por color + quietud + `camoScore`
  determinista + **captura por fijación** (el camuflaje alarga la mira necesaria). La
  mecánica está; le falta el **contexto** donde importe.

## 3. Los 3 pilares de "esconderse de verdad" (el corazón de V1)

El esconderse emerge de la combinación de estos tres, no de uno solo:

1. **Escenario con cobertura y desorden.** Props densos, muebles, cajas, bolsas, plantas,
   estanterías, nichos — colocados para que un jugador **quieto + camuflado + posado**
   entre ellos **desaparezca**. Occlusión real (no ver a través). Superficies de colores
   variados para que el color de camuflaje tenga a qué parecerse.
2. **Poses + rotación** para **romper la silueta humana** ("hazte una caja / una bola /
   pégate plano a la pared") junto a props que imitar. Una cápsula erguida siempre canta;
   una "caja" verde entre cajas verdes, no.
3. **Seeker en 1ª persona con mouse-look** que **barre y se fija**: no ve toda la sala a la
   vez; el camuflaje engaña su vista y la **fijación** (ya hecha) resuelve la caza.

## 4. Backlog V1 (must-have para lanzar)

Orden sugerido de ejecución entre paréntesis. `✅`=hecho · `🟡`=parcial · `❌`=pendiente.

| # | Épica V1 | Estado | Por qué es V1 |
|---|---|---|---|
| **V1-A** | **Escenario "escondible"**: props densos + occlusión + colores variados (amplía el mapa compartido de `@mecha/sim`) | ❌ (1) | El corazón. Sin cobertura no hay dónde esconderse. |
| **V1-B** | **Poses + rotación** (P1.1): de pie/agachado/bola/plano-pared; rota para encajar | ❌ (1) | Romper silueta = esconderse de verdad. |
| **V1-C** | **Seeker FPP + mouse-look**: 1ª persona, apuntar con el ratón, retícula | ❌ (1) | La caza necesita mirar/escanear/apuntar. |
| **V1-D** | Camuflaje + detección por **fijación** (P0.2/P0.3) | ✅ | Ya hecho; re-balancear con el escenario nuevo. |
| **V1-E** | **Matchmaking**: crear/unirse por código + nombre (P2.1, cierra Hono RPC) | ❌ (3) | Para jugar con gente / lanzar al público. |
| **V1-F** | **Bucle + resultados/reveal** (P1.3): pantalla de fin que **revela** dónde se escondió cada uno; feedback de roles | 🟡 (2) | El *payoff* divertido ("answer-check"). |
| **V1-G** | **Pass visual estilizado**: cielo, luz, sombras suaves, personaje con silueta decente, HUD con botones/timer/placas de nombre | ❌ (4) | Que parezca un juego, no una escena de debug. Ver §5. |
| **V1-H** | **Audio mínimo**: SFX de captura + ambiente (silbido/whistling opcional, P2.2) | ❌ (5) | "Juice" barato que sube mucho la diversión. |
| **V1-I** | **Deploy a producción** (P4.3): `wrangler deploy` back+front en el edge | ❌ (6) | Para que sea público y jugable **sin instalar nada**. |

**Ruta recomendada:** el "núcleo de esconderse" **V1-A + V1-B + V1-C** primero (están
acoplados y son el juego), re-balancear **V1-D**, luego **V1-F** (payoff), **V1-E** (salas),
**V1-G** (visual), **V1-H** (audio) y **V1-I** (deploy). Verificación jugable en navegador
tras cada uno (no al final).

## 5. Objetivo visual de V1 (respuesta a "¿se puede como las imágenes 2–3?")

**Sí, con R3F/three y SIN modelar en Blender.** El norte visual es la **imagen 3**
(low-poly estilizado, sombreado plano/toon, cielo y sombras suaves, personaje simple).

- **Primitivas puras** (cajas/cilindros) + buena luz → estilo geométrico (≈ imagen 2).
- **+ modelos `.glb` low-poly CC0** (gratis, sin modelar) **+ material toon/flat + cielo +
  sombras suaves + niebla + post-procesado** → carácter tipo **imagen 3**.

Herramientas (todo del ecosistema ya permitido, ver [`docs/07`](07-librerias-cliente-3d.md)):
- **Assets CC0 gratis** (soltar como `.glb`, sin Blender): **Kenney.nl**, **Poly Pizza**,
  **Quaternius**. Alojar en **Cloudflare R2** (Draco/meshopt para bajar peso).
- **drei**: `useGLTF`, `Sky`/`Environment`, `SoftShadows`, `ContactShadows`, `Instances`.
- **Materiales**: `MeshToonMaterial` + gradient map, o `MeshStandardMaterial` con
  `flatShading` — el look "plano" es más barato y estiliza bien.
- **Post-procesado (opcional)**: `@react-three/postprocessing` (bloom, AO, outline).
- Fuente de ideas: **ejemplos de threejs.org**.

> El coste de este look es **arte por dirección (materiales/luz/cielo) + assets CC0
> gratis**, no "modelar en Blender". Es perfectamente asumible dentro de V1.

## 6. No-goals de V1 (explícitos — para no dispersarse)

Post-V1 (siguen en [`docs/06`](06-roadmap.md), no se tocan para lanzar):

- **Gráficos AAA / camaleón riggeado propio** (Blender, animaciones custom) → P4.1.
  V1 usa low-poly estilizado con assets CC0.
- **Monetización / cosméticos** (P3) → el objetivo de V1 es *free lite*.
- **Modo Double**, infección avanzada, **lag compensation** (P4.2), **i18n**.
- **Móvil / táctil** (P4.5) → deseable en **V1.1**, no bloquea el lanzamiento (V1 = teclado+ratón).
- **Pintura por textura/patrones libres, metallic/roughness** → V1 = pintura por **color**
  (regiones), que es lo que ya tenemos vía Spoid + `ChangeColor`.
- **Match de sombras como factor de detección** (P1.2) → la fijación ya resuelve la caza;
  las sombras en V1 son solo visuales.

## 7. Definición de "listo para lanzar" (V1 = done)

- [ ] Dos+ navegadores entran **por código** a la misma sala (nombre propio) y juegan una
      **ronda completa** lobby → prep → hunt → **results con reveal**.
- [ ] Un Hider **camuflado + posado + quieto entre props NO es detectado** por un Seeker que
      ronda cerca; uno mal escondido/en movimiento **sí** cae. *(La regla innegociable, §1.)*
- [ ] El **Seeker caza en 1ª persona apuntando con el ratón**.
- [ ] **Se ve como un juego** (estilizado, §5), no como una escena de debug.
- [ ] **Desplegado en el edge**, jugable desde una URL, **sin descargas**.
- [ ] `pnpm test` · `test:do` · `typecheck` · `lint` en verde; smoke test multi-cliente.

## 8. Alineación con la biblia (`mecha-chameleon-gamedesign`)

El V1 coincide con el **MVP** que define la skill (Normal mode; pintura por regiones con
Spoid; poses básicas; Seeker FPP + tag; máquina de estados con temporizadores; 1–2 mapas;
results con reveal; lobby público/privado). Diferencias conscientes y documentadas:

- **Caza por fijación** (híbrido) en vez de economía de disparos — ver [`docs/07`](07-librerias-cliente-3d.md).
  La munición/disparos limitados queda como *tuning* opcional de V1.
- Un Hider atrapado **pasa a Seeker** (infección) ya está implementado; V1 = Normal/Infección.

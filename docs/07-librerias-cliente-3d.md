# 07 · Librerías del cliente 3D y el patrón de camuflaje (referencia)

> Documento de **referencia** (no un "paso"). Recoge las librerías del ecosistema R3F
> sugeridas para el desarrollo y —lo importante— **cómo encajan o chocan con la
> arquitectura de este monorepo** (servidor autoritativo + `@mecha/sim` determinista).
> Léelo antes de añadir cualquier dependencia de render/física al frontend o de tocar
> el cuentagotas / la detección de camuflaje. Fuente: sugerencias externas + skills
> `r3f-rendering`, `authoritative-netcode`, `mecha-chameleon-gamedesign`.

---

## TL;DR — qué usar y qué NO

| Librería / enfoque | Veredicto en este repo | Por qué |
|---|---|---|
| **`@react-three/drei`** | ✅ **Úsala** (ya está instalada, v10) | Cámara, controles, captura de textura, helpers. Compatible con React 19. |
| **`@react-three/rapier`** | ❌ **NO la añadas** | La física es determinista y **compartida** server+cliente vía `@dimforge/rapier3d-compat` tras el puerto `IPhysicsWorld`. Una física solo-cliente rompería el netcode autoritativo. |
| **`@react-three/cannon`** | ❌ **NO** | Mismo motivo; además `cannon` no es determinista cross-platform. |
| **Raycast Spoid (cuentagotas)** | ✅ **Sí, pero solo presentación** | El raycast cliente pinta el avatar (feedback inmediato). La **detección/score** de camuflaje es **autoritativa del servidor** en `@mecha/sim`, nunca la decide el cliente. |

Regla de oro del repo (CLAUDE.md §4.1): **el dominio/núcleo nunca importa `three`,
`@react-three/*` ni SDKs de física del cliente.** Todo lo que el cliente y el servidor
deban calcular idéntico vive en `@mecha/sim` detrás de puertos.

---

## 1. `@react-three/drei` — helpers de R3F (obligatoria, ya instalada)

Está en `apps/frontend/package.json` como `"@react-three/drei": "catalog:"` → **v10**
(la línea que soporta React 19 + R3F v9). No hay que instalar nada. Piezas útiles por
fase del juego:

- **Cámara / controles**
  - `PerspectiveCamera` — cámara del juego (ya hay lógica de cámara en
    [`CameraRig.tsx`](../apps/frontend/src/features/canvas-3d/components/CameraRig.tsx)).
  - `PointerLockControls` — **vista en primera persona del Seeker** durante HUNT
    (barrer el mapa con el ratón, sin cursor). Encaja con la mecánica FPP de la
    biblia (`mecha-chameleon-gamedesign` §"El Seeker").
  - `OrbitControls` — **inspección en tercera persona** del propio avatar en el panel
    de pintura de PREPARATION ("mírate desde el ángulo del Seeker"). Úsalo acotado al
    panel de pintura, no en hunt.
- **Texturas y materiales**
  - `useTexture` / `useKTX2` — cargar texturas de superficies del escenario (ladrillo,
    madera, ajedrez) para P0.1. Memoiza y comparte; no crear texturas por frame
    (`r3f-rendering`).
  - `Environment`, `Sky`, `SoftShadows` — iluminación/ambiente; relevante para P1.2
    (match de sombras).
- **Instancing y utilidades**
  - `Instances` / `Merged` — envoltorios ergonómicos sobre `InstancedMesh` para los
    props repetidos del mapa (P0.1). Alternativa a `InstancedMesh` a mano.
  - `Html`, `Text` — etiquetas sobre cabezas / prompts 3D (con cuidado de rendimiento;
    P2.3). Preferir HUD 2D para estado lento.
- **Captura de color (Spoid):** drei **no** trae un cuentagotas; el muestreo de color
  es un `raycaster` a mano (ver §3). Drei sí ayuda con la cámara/controles alrededor.

> ⚠️ Rendimiento: todo componente de drei que uses en la escena sigue las reglas de
> `r3f-rendering` — nada de `setState` por frame, memoizar geometrías/materiales,
> mutar refs en `useFrame`. Drei no te exime de eso.

---

## 2. Física: **NO** `@react-three/rapier` ni `@react-three/cannon`

Las sugerencias externas proponen `@react-three/rapier` o `@react-three/cannon` para
colisiones. **En este repo eso sería un error de arquitectura.** Motivo:

- El netcode es **servidor-autoritativo con predicción del cliente** (skill
  `authoritative-netcode`). Para predecir sin desincronizarse, **cliente y servidor
  ejecutan exactamente la misma simulación** a 30 Hz.
- Por eso la física vive en `@mecha/sim` detrás del puerto
  [`IPhysicsWorld`](../packages/sim/src/physics/IPhysicsWorld.ts), con dos adaptadores:
  [`KinematicPhysicsWorld`](../packages/sim/src/physics/KinematicPhysicsWorld.ts)
  (determinista, barato) y
  [`RapierPhysicsWorld`](../packages/sim/src/physics/RapierPhysicsWorld.ts)
  (`@dimforge/rapier3d-compat`, **pin exacto** por determinismo cross-platform).
- `@react-three/rapier`/`cannon` corren **solo en el cliente**, dentro del árbol de
  React, y **no** los comparte el servidor → romperían la reconciliación y el
  determinismo. `cannon` además no es determinista entre plataformas.

**Cómo añadir colisiones de props del escenario (P0.1), correctamente:**
1. Define los colliders del mapa como **datos** (posición/tamaño/forma) en un mapa
   compartido de `@mecha/sim` (o en la entidad `GameMap`).
2. El puerto `IPhysicsWorld` los consume en ambos lados → el servidor y el cliente
   colisionan igual.
3. El `Environment.tsx` del cliente **solo renderiza** esas superficies/props (visual);
   no define la física. Fuente única de verdad = los datos del sim.

---

## 3. El patrón de camuflaje (Spoid por Raycast) — presentación vs. autoridad

La sugerencia externa describe el flujo correcto para **pintar** el avatar:

> En `useFrame` (o al activar el Spoid): lanzar un rayo (`useThree().raycaster`) desde
> la cámara/cursor hacia la superficie del entorno; si impacta, leer color/textura del
> punto (`intersection.uv` / `intersection.point`); asignar ese color al
> `meshStandardMaterial` del cuerpo.

Esto **ya está previsto** en
[`useRaycastColor.ts`](../apps/frontend/src/features/canvas-3d/hooks/useRaycastColor.ts)
y es el **Spoid** de la biblia (`mecha-chameleon-gamedesign` §"Meccha Paint"). Reglas
de este repo al implementarlo/ampliarlo:

- ✅ **El raycast cliente pinta** el avatar al instante (feedback inmediato) y **se
  confirma al servidor** vía el use-case `ChangeColor` (`Result`), no por tick. La
  pintura NO es camino caliente.
- ✅ **No muestrear por frame** salvo mientras el Spoid está activo apuntando; reutilizar
  el `Raycaster` y vectores (sin asignar por frame; `r3f-rendering` +
  `workers-memory-optimization`).
- ❌ **El cliente NO decide si estás oculto.** La medida de "qué tan camuflado estás"
  (score) y la resolución de captura del Seeker son **autoritativas del servidor**,
  calculadas de forma **determinista en `@mecha/sim`** a partir del color del avatar y
  del **color de referencia del entorno** (dato del mapa compartido, ver §2).
- El raycast contra el entorno para *leer color* (presentación) y el color de
  referencia *del dato del mapa* (autoridad) son **dos cosas distintas**: la primera
  vive en el cliente (three.js), la segunda en el sim (sin three.js).

### Decisión de diseño TOMADA: camuflaje híbrido por tiempo de fijación

Había una **tensión** entre dos autoridades del repo sobre qué significa "camuflaje":

- La **biblia de diseño** (`mecha-chameleon-gamedesign` + `ux-ui-spec` §"Accesibilidad"):
  el camuflaje es **percepción del Seeker humano, no un check del sistema** (el servidor
  solo valida raycast→cápsula).
- El **roadmap P0.3** (`06-roadmap.md`): un **score de camuflaje** que hace al bien
  camuflado **prácticamente inmune** (un check del sistema).

**Resuelto (2026-06-30) → modelo HÍBRIDO por tiempo de fijación.** El Seeker **puede**
taggear a cualquiera al que apunte, pero contra un objetivo bien camuflado y quieto debe
**mantener la mira** (el gatillo) un tiempo — la **fijación** — antes de que el tag
cuente. El `camoScore` (0..1, autoritativo del servidor, determinista en `@mecha/sim`)
**modula ese tiempo**: visible → casi instantáneo; camuflaje perfecto → hasta ~2.5 s.
No hay inmunidad dura ni "detector" pasivo de Hiders. Es fiel al "juego de observación"
(el Seeker que SÍ te vio te caza sosteniendo la mira) y hace el camuflaje mecánicamente
relevante y justo para ambos bandos.

Implementación (P0.2/P0.3):
- `@mecha/sim/core/map/MapData.ts` — mapa compartido + `referenceColorAt(x,z)` (color de
  referencia del entorno, determinista). Ver [`docs/08`](08-step-6-camouflage-core.md).
- `@mecha/sim/core/camouflage.ts` — `computeCamouflage(color, ref, speed, cfg)` (0..1) +
  `requiredFixationTicks(camoScore, cfg)`.
- `step.ts` — score por Hider (pase 2) + captura por fijación (pase 3); `PlayerState`
  gana `camoScore`/`beingWatched` (van en el snapshot) y `lockTargetId`/`lockTicks`
  (solo servidor). Wire `PROTOCOL_VERSION` 1→2 (+1 byte `camoScore`, bit `beingWatched`).
- HUD: barra de camuflaje (verde→rojo) + aviso "te están fijando" + destello de captura.

> Desviación consciente y documentada respecto al original (permitido por la biblia:
> "…o con una desviación consciente y documentada"). Nota para daltónicos: el `camoScore`
> se expone numérico en el HUD (barra + %), no depende de distinguir colores a ojo.

---

## 4. Objetivo visual (V1): low-poly estilizado **sin Blender**

El norte visual de V1 (ver [`docs/09`](09-v1-scope.md)) es un **low-poly estilizado**
(cel/flat shading, cielo y sombras suaves, personajes simples) — alcanzable con R3F/three
**sin modelar en Blender**. Confirmado: es el estilo de muchos ejemplos de threejs.org.

- **Primitivas puras** (cajas/cilindros) + buena luz → estilo geométrico (limpio, retro).
- **+ modelos `.glb` low-poly CC0** (gratis, se sueltan sin modelar) **+ material toon/flat
  + cielo + sombras suaves + niebla + post-procesado** → carácter estilizado con encanto.

**Herramientas (todo dentro del ecosistema permitido):**
- **Assets CC0 gratis**: [Kenney.nl](https://kenney.nl), [Poly Pizza](https://poly.pizza),
  [Quaternius](https://quaternius.com). Formato `.glb`; alojar en **Cloudflare R2**;
  comprimir con **Draco/meshopt** (baja el peso de descarga — el límite del navegador es
  descarga + GPU, no los 128 MB del DO, que es server-side).
- **drei**: `useGLTF` (carga `.glb`), `Sky`/`Environment` (cielo/IBL), `SoftShadows`/
  `ContactShadows` (sombras estilizadas), `Instances`/`Merged` (props repetidos).
- **Materiales**: `MeshToonMaterial` + gradient map (cel-shading), o `MeshStandardMaterial`
  con `flatShading: true` (plano, más barato). Reutilizar/memoizar (regla `r3f-rendering`).
- **Post-procesado (opcional)**: `@react-three/postprocessing` (bloom, AO, outline).

> Coste real de este look = **dirección de arte por código (materiales/luz/cielo) + assets
> CC0 gratis**, NO "modelar en Blender". Asumible dentro de V1. El salto a fotorrealismo /
> camaleón riggeado propio es post-V1 (roadmap P4.1).

## 5. Versiones (fuente: `pnpm-workspace.yaml` catalog)

- `three ^0.171`, `@react-three/fiber ^9`, `@react-three/drei ^10`, `zustand ^5`.
- `@dimforge/rapier3d-compat 0.14.0` (**pin exacto**, mismo en server y cliente).
- React 19, Vite 7. Cambiar versiones = editar el **catalog**, no los `package.json`.

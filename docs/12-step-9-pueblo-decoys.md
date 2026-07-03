# 12 · Paso 9 — Pueblo 48×48 + muñeco del original + señuelos (V1-G v2)

> Respuesta al playtest del pass visual: *"es difícil esconderse porque todo es muy
> cuadrado y los personajes se diferencian muy fácil… el mapa es muy básico, debería
> ser más grande, una especie de ciudad"*. El usuario aportó capturas del original como
> norte: el muñeco blanco de plastilina, el Hider posado entre cactus con brazos, las
> galletas planas en las fachadas y los mapas tipo diorama.

---

## La tesis del paso

En el original no te escondes "detrás" de cosas: te escondes **entre cosas que se
parecen a ti**. Faltaban dos piezas: (1) que el avatar sea el **muñeco** genérico del
original (no una cápsula ni un camaleón con hocico), y (2) que el mapa esté **poblado
de señuelos con esa misma silueta** para que un jugador pintado y posado sea
indistinguible. Eso es lo que añade este paso.

## Qué se construyó

- **Avatar v2 — el muñeco liso** ([`avatarGeometry.ts`](../apps/frontend/src/features/canvas-3d/components/avatarGeometry.ts)):
  cabeza esférica SIN cara + torso blob + brazos/piernas (como las figuras del
  original). Poses fieles: de pie (simétrico), **arrodillado** (rodillas al frente,
  sigue al yaw), **bola acurrucada** (casi esférica, con la cabeza recogida) y **plano
  "galleta"** (silueta aplastada en Z). Sombreado LISO (el facetado queda para la
  arquitectura). Sigue siendo UNA geometría fusionada por pose → 4 draw calls
  instanciados. Contratos del test intactos: pies en y=0, cubre el hitbox del server,
  fleco ≤ `VISUAL_FRINGE`; nuevos: plano delgado en Z, arrodillado con sesgo frontal.
- **Señuelos en el mapa compartido** (`MapZone.shape`): **`figure`** (estatuas/
  maniquíes de pie) y **`figureWall`** (muñecos planos en fachadas, como las galletas)
  + `rot` (cuartos de vuelta, render). El cliente los renderiza **con la geometría del
  avatar** y con su MISMO acabado (`AVATAR_ROUGHNESS`, liso) — también las bolas
  (`sphere`) comparten teselación y acabado. Son zonas sólidas: **ocluyen el disparo**
  (tirarle a una estatua = fallo, como al cactus del original) y colisionan.
- **Mapa v2 `pueblo-01` (48×48)** ([`MapData.ts`](../packages/sim/src/core/map/MapData.ts)):
  plaza central de spawn (rejilla libre de sólidos, test lo fuerza), calles en cruz,
  4 barrios con paleta propia y **casas con interior accesible** (crema/NW,
  teal/NE con **jardín de estatuas**, mercado mostaza/SW con maniquíes y muro en L,
  navy/SE con lockers), galletas en 6 fachadas, 8 figuras de pie, bolas/barriles/
  jardineras. **Sin voladizos ni tejados**: la colisión de movimiento es 2D (ignora Y).
  `DEFAULT_MAP.bounds ≡ DEFAULT_SIM_CONFIG.bounds` (test lo fuerza; el clamp y los
  muros ya no divergen). Tests nuevos: tamaño ≥44, spawn libre, ≥6+4 señuelos,
  ≥8 colores, formas para todas las poses.
- **Balance para el pueblo**: prep 30→**45 s**, hunt 90→**120 s** (más terreno);
  `catchRange` 30 se queda corto adrede (el Seeker debe entrar a los barrios).
- **Viewmodel del arma** ([`SeekerViewmodel.tsx`](../apps/frontend/src/features/canvas-3d/components/SeekerViewmodel.tsx)):
  blaster low-poly en la esquina inferior derecha de la FPP (como el original); grupo
  que copia la pose de la cámara por frame; `noSample` (ni cuentagotas ni trazador lo
  "ven"). Ajustes: niebla 40→130 m, vista aérea más alta, sombras a ±30.

## Verificación

- Suite completa en verde: shared 7 · **sim 106** (5 tests nuevos de mapa) ·
  backend 23 · **frontend 25** · DO 6 · typecheck · lint · build.
- **Capturas headless de una ronda real** (2 clientes, rol detectado por el chip del
  HUD): el lobby muestra el pueblo (casas, jardín de estatuas, galletas en fachadas);
  el muñeco lee EXACTO al original en las 4 poses; el Seeker caza con arma y retícula.
  Dos retoques salidos de las capturas: arma más clara/pequeña y arrinconada.

## Notas de diseño

- La indistinguibilidad señuelo↔jugador es **geométrica y de material** (misma malla,
  mismo roughness, mismo sombreado). Lo único que puede delatar a un jugador es su
  **color mal pintado** o **moverse** — exactamente la tensión del original.
- El test de la rejilla de spawn usa el `spawnPlayer` REAL (no una copia de la fórmula).
- `figureWall` va montado a media altura de la fachada (base a ~0.5 m), como una placa.
- Post-V1: props elevados/tejados exigirían colisión 3D (hoy 2D a propósito).

## Qué falta para cerrar V1

Playtest de esta versión (usuario) · **V1-F results/reveal** · V1-E matchmaking ·
V1-H audio · V1-I deploy. Checklist maestro en [`docs/09`](09-v1-scope.md).

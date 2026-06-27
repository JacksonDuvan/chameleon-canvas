# `@mecha/sim` — Kernel de simulación determinista compartido

> **Decisión arquitectónica clave del Paso 1.** Léela antes de tocar este paquete.

## Por qué existe este paquete

Dos skills imponen requisitos que, a primera vista, tiran en direcciones distintas:

- `hexagonal-vertical-slicing`: las reglas de juego viven en los **slices** de cada
  app; `packages/shared` es **solo contratos** (no lógica).
- `authoritative-netcode`: *"la misma simulación debe correr en el backend
  (autoritativo) y en el frontend (predicción)… **compártelo vía el package de
  dominio**"*. Sin esto, no hay predicción del cliente ni reconciliación.

`packages/sim` es **ese "package de dominio"**: el subconjunto **puro y
determinista** de la simulación que el cliente necesita re-ejecutar para predecir
(movimiento, integración física, colisiones, RNG con semilla). Lo importan **los
dos** lados:

- Backend: el use-case `ProcessTick` (autoritativo) lo ejecuta a 30 Hz.
- Frontend: la predicción/reconciliación en `useGameSockets` lo re-ejecuta sobre el
  jugador local.

Las **reglas de alto nivel server-only** (transición de fases Lobby→Prep→Hunt,
condición de victoria, asignación de roles, lógica de monetización) **no** viven
aquí: viven en los slices del backend, porque el cliente no necesita predecirlas.

> Resumen: aquí va lo que **cliente y servidor deben calcular idéntico**; en los
> slices del backend va lo que **solo el servidor decide**.

## Determinismo (innegociable)

- `dt` **fijo inyectado** (1/30), nunca reloj de pared dentro del step.
- RNG **con semilla** (`core/rng.ts`); la semilla del servidor se replica al cliente.
- Mismas entradas + mismo estado ⇒ misma salida, en ambos lados.
- Misma versión EXACTA de Rapier en servidor y cliente (ver catalog: pin sin `^`).

## Estructura

```
src/
├── core/                  # PURO: cero dependencias de framework/transporte/render
│   ├── value-objects/     # Position, ColorRGBA (inmutables, forma monomórfica)
│   ├── entities/          # WorldState, PlayerState (estado de simulación)
│   ├── step.ts            # integrate(state, commands, dt, rng, physics) — el tick puro
│   └── rng.ts             # RNG determinista con semilla
└── physics/               # Adaptador de físicas tras un PUERTO
    ├── IPhysicsWorld.ts    # el PUERTO (interfaz pura); core depende de ESTO
    ├── RapierPhysicsWorld.ts  # adaptador que implementa el puerto con Rapier
    └── wasm/              # *** Config WASM (Rapier) AISLADA ***
        ├── rapier-init.ts  # carga/`await RAPIER.init()` una sola vez (singleton)
        └── README.md       # cómo se carga el WASM en Worker vs navegador
```

`core/` nunca importa `@dimforge/rapier3d-compat`: depende de `IPhysicsWorld`. El
único lugar que toca Rapier es `physics/` (el adaptador) — así el núcleo sigue
siendo puro y testeable con un fake del puerto (ver skill `tdd-testing`).

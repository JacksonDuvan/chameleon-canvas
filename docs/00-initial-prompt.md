# 00 · Prompt inicial del proyecto

> Documento de referencia. Contiene, **verbatim**, el prompt fundacional que dio
> origen a este monorepo. Sirve como fuente de verdad del alcance, las reglas de
> negocio y los requisitos técnicos. Las sesiones futuras deben leerlo antes de
> continuar el desarrollo.

---

## Rol y objetivo

Actúa como un Ingeniero de Software Principal y Arquitecto de Videojuegos
Cloud-Native. Vamos a construir un clon web 3D online inspirado en el juego viral
"Meccha Chameleon". Todo el sistema debe ser desplegable en Cloudflare,
estructurado como un monorrepo TypeScript limpio usando pnpm workspaces.

Para garantizar la mantenibilidad y modularidad, debes aplicar estrictamente los
siguientes patrones arquitectónicos:

1. **BACKEND (Node.js + Hono en Cloudflare Workers + Durable Objects):**
   - Arquitectura Hexagonal (Puertos y Adaptadores): Aislar por completo la lógica
     de negocio de los Sockets/HTTP (Adaptadores Primarios) y de la persistencia o
     cachés (Adaptadores Secundarios).
   - Vertical Slicing (Arquitectura por Capas Verticales): Organizar el código por
     características independientes (ej: `/slices/rooms`, `/slices/gameplay`,
     `/slices/monetization`). Cada slice contiene su propio dominio, casos de uso y
     adaptadores.
   - Hono RPC: Exportar el `AppType` del servidor para que pueda ser consumido por
     el Frontend logrando tipado estricto de extremo a extremo.

2. **FRONTEND (TanStack Start + Vite + Three.js / React Three Fiber):**
   - Feature-Based Architecture: Organizar los componentes, hooks y estado por
     dominios funcionales (ej: `features/matchmaking`, `features/canvas-3d`,
     `features/shop`).
   - Separación estricta de responsabilidades: La UI/Vista (React) debe consumir
     únicamente lógica de negocio mediante custom hooks que interactúen con managers
     o tiendas de estado desacopladas de Three.js.

---

## Reglas de negocio originales de "Meccha Chameleon" a replicar

- **Flujo de tres fases por ronda:** Lobby (Espera), Prep Phase (Fase de
  preparación cronometrada donde los Hiders se mueven libremente y se camuflan, los
  Seekers esperan a ciegas) y Hunt Phase (Los Hiders quedan congelados y los Seekers
  salen a cazar).
- **Mecánica de Camuflaje Realista:** El mapa 3D contendrá materiales con colores y
  patrones planos o texturizados llamativos (ej: ladrillo, madera). El Hider usa un
  Raycaster ("Cuentagotas") para absorber el color/textura exacto del entorno del
  escenario al presionar 'E', pintando dinámicamente el canvas interno de su propio
  avatar 3D (Mesh).
- **Poses y Match de Sombras:** El jugador Hider puede rotar su avatar y elegir
  múltiples poses para encajar estéticamente en las esquinas del escenario. Al
  congelarse ('Espacio'), la sombra debe ser un factor de delación para el Seeker si
  el Hider no calculó la luz.
- **Whistling (Silbidos):** Si el host activa la regla, los Hiders emiten un
  silbido/sonido automático o manual cada cierto tiempo dando una pista posicional
  sonora a los Seekers.
- **Fin de juego:** Si el Seeker atrapa a un Hider (vía colisión/interacción), ese
  Hider se convierte automáticamente en Seeker para ayudar a buscar al resto. Los
  Hiders ganan si sobrevive al menos uno al terminar el tiempo.

---

## Requisitos técnicos y monetización (preparación de arquitectura)

- El Backend debe usar Cloudflare Durable Objects para coordinar el estado de las
  salas WebSockets en tiempo real sin perder consistencia (Stateful Coordination en
  el Edge).
- **Infraestructura de Monetización (Hooks & Interfaces Listas):**
  - Define los puertos e interfaces en el Dominio para un `MonetizationService`.
  - Deja preparados los placeholders o SDK Mocks en el Frontend (dentro de
    `features/monetization`) para soportar en el futuro: AdSense for Games /
    CrazyGames SDK (Rewarded e Interstitial Ads antes/después de rondas), Tienda de
    Cosméticos (Carga de texturas custom premium desde Cloudflare R2 / KV), y
    verificación de suscripción "Premium Club" para saltarse anuncios.

---

## Fases de ejecución

- **Paso 1: Configurar el entorno del monorrepo.** Inicializa Git con un
  `.gitignore` robusto; fija Node 24 (`engines` / `.nvmrc`); crea el `wrangler.json`
  moderno (Worker de Hono, binding y migraciones de DO) y el adapter de Cloudflare
  para TanStack Start; define la estructura completa de carpetas (Hexagonal +
  Slicing) como árbol visual, contemplando la separación de la config de WASM
  (Rapier), los esquemas compartidos de Hono RPC y las carpetas del lienzo 3D y el
  estado desacoplado.
- **Paso 2: Desarrollar el Dominio del Backend** (Sala, Jugador, Estado del Juego,
  Transición de Fases) libre de infraestructura. Estrategia *Netcode primero*:
  modelar el MVP en formato plano/texto con coordenadas `(x, y, z)`; dos entidades
  abstractas que se mueven, disparan y registran impactos matemáticos. Servidor
  autoritativo con físicas ligeras, pensado para integración determinista de
  Rapier.js (WASM) sin exceder los límites de memoria de los V8 Isolates.
- **Paso 3: Implementar los Durable Objects y Sockets de Hono** como adaptadores de
  entrada. Bucle de juego dentro del DO con **Tick Rate 20–30 Hz** para proteger los
  límites de CPU de los Workers.
- **Paso 4: Diseñar la experiencia visual 3D (R3F)** en el Frontend: raycasting de
  color, absorción de texturas y desacoplamiento de estado en arquitectura
  Feature-Based. Prohibido `useState`/`useEffect` para posiciones por frame: estado
  en `refs` o store Zustand vanilla conectado a `useFrame`. Interpolación (`Lerp`)
  cliente para suavizar a 60+ FPS entre ticks de red. Pipeline de assets `.glb`
  Draco/Meshopt vía `gltfjsx`, `InstancedMesh` para proyectiles/duplicados.

---

## Idea de arquitectura del repositorio (provista en el prompt)

Monorepo con pnpm workspaces:
- `/packages/shared`: Esquemas comunes de Hono RPC, tipos globales y DTOs de red.
- `/apps/backend`: Node.js + Hono + Cloudflare Durable Objects.
- `/apps/frontend`: TanStack Start + React Three Fiber + Zustand.

### Estructura del backend (Slicing Vertical + Hexagonal)

```
apps/backend/src/
├── index.ts                     # Punto de entrada de Cloudflare Workers (Hono App)
├── wrangler.json                # Configuración de Workers, DO Bindings y Migraciones
├── shared/                      # Infraestructura global (módulos de base, logs, etc.)
└── slices/                      # Capas Verticales por Características de Negocio
    ├── gameplay/                # Slice Principal del Juego
    │   ├── domain/              # CAPA DE DOMINIO (Pura, sin Hono, sin WebSockets)
    │   │   ├── entities/        # Player.ts, Room.ts, GameMap.ts (Coordenadas puras x,y,z)
    │   │   ├── value-objects/   # Position.ts, ColorRGBA.ts
    │   │   └── ports/           # Interfaces de salida (ej: IMonetizationService.ts)
    │   ├── use-cases/           # CAPA DE CASOS DE USO (Lógica de aplicación)
    │   │   ├── ProcessTick.ts   # Ejecuta el bucle físico a 30Hz
    │   │   ├── ChangeColor.ts   # Procesa la absorción de color de un jugador
    │   │   └── PlayerJoin.ts    # Lógica de entrada a la sala
    │   └── infrastructure/      # CAPA DE INFRAESTRUCTURA (Adaptadores)
    │       ├── adapters/        # Implementaciones de los puertos
    │       └── entrypoints/     # Sockets de Hono y Durable Objects (GameRoomDO.ts)
    └── monetization/            # Slice de Monetización (Suscripciones, Anuncios)
        ├── domain/              # Puertos de verificación y reglas
        └── infrastructure/      # Adaptadores para SDKs externos / KV Store
```

### Estructura del frontend (Feature-Based)

```
apps/frontend/src/
├── routes/                      # Enrutamiento basado en archivos de TanStack Start
├── shared/                      # UI Global, Botones, Layouts, Estilos
└── features/                    # Dominios Funcionales del Cliente
    ├── canvas-3d/               # FEATURE DEL MUNDO 3D
    │   ├── components/          # Scene.tsx, MechaMesh.tsx, Environment.tsx
    │   ├── hooks/               # useRaycastColor.ts, useInterpolation.ts
    │   └── store/               # worldStore.ts (Zustand Vanilla para la GPU)
    ├── matchmaking/             # FEATURE DE SALAS Y LOBBY
    │   ├── components/          # RoomForm.tsx, PlayerList.tsx
    │   └── hooks/               # useGameSockets.ts
    └── monetization/            # FEATURE DE MONETIZACIÓN
        └── components/          # AdPlaceholder.tsx, CosmeticsShop.tsx
```

> **Nota de evolución:** durante el Paso 1 esta estructura se respetó y se amplió de
> forma justificada (ver `docs/01-step-1-monorepo-setup.md`). La ampliación más
> relevante es el paquete `packages/sim`, el kernel de simulación determinista
> compartido entre backend (autoritativo) y frontend (predicción), que materializa
> el requisito de netcode "la misma simulación corre en ambos lados".

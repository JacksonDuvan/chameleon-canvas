---
name: r3f-rendering
description: >-
  Renderizado de alto rendimiento para clientes de juego con React Three Fiber
  (R3F) / Three.js, donde el ciclo de render reactivo de React debe mantenerse
  fuera del bucle de animación por-frame. Usa esta skill SIEMPRE que el trabajo
  toque una escena 3D, useFrame, meshes, geometrías, materiales, el Canvas,
  movimiento de cámara, animación por-frame, uniforms de shaders, instancing, o
  estado de Zustand que alimente la escena; y siempre que el síntoma sea "la
  escena va a tirones", "caen los fps", "stutter cuando cambia el estado" o "picos
  de GC en el render". Impone las reglas de R3F: nunca setState en el bucle, mutar
  refs/objetos directamente vía useFrame, animar con delta, reutilizar objetos
  (sin asignar por frame), compartir/memoizar geometrías y materiales, instanciar
  objetos repetidos, y leer estado de cambio rápido por suscripción transitoria a
  Zustand en vez de hooks reactivos. Aplícala antes de escribir cualquier
  componente que anime o cualquier store que la escena lea a tasa de frames.
---
 
# Renderizado de alto rendimiento en R3F / Three.js
 
R3F es genuinamente Three.js nativo: el JSX que escribes *son* objetos de Three.js.
La trampa de rendimiento no es R3F; es dejar que el ciclo render/diff/reconcile de
React corra sobre cosas que cambian cada frame. React solo debería involucrarse
cuando cambian props infrecuentes y dirigidas por el usuario (se abrió un menú, se
cargó un nivel). Todo lo que se mueve a 60 fps debe esquivar React por completo.
 
La frontera, dicha una vez: **estado de React para lo que cambia rara vez; refs y
mutación directa (dentro de `useFrame`) para lo que cambia cada frame. Las dos
cosas rara vez deberían cruzarse.** Confundirlas es la causa número uno de
problemas de rendimiento en R3F.
 
Lee esto antes de escribir cualquier componente animado o cualquier store que la
escena lea cada frame. El store del mundo de este juego es `worldStore.ts`
(Zustand Vanilla) en `features/canvas-3d/store/`.
 
## Regla 1 — Nunca setState en un bucle de animación
 
Llamar a `setState` (o cualquier update reactivo) por frame fuerza a todo el
subárbol de componentes por el diffing de React 60 veces por segundo. Hunde el
frame rate en segundos.
 
```ts
// ❌ enruta un update por-frame por el scheduler de React — nunca hagas esto
const [x, setX] = useState(0);
useFrame(() => setX(v => v + 0.01));
return <mesh position-x={x} />;
 
// ✅ toma un ref y muta el objeto de Three.js directamente
const ref = useRef<THREE.Mesh>(null!);
useFrame((_, delta) => { ref.current.position.x += delta; });
return <mesh ref={ref} />;
```
 
Lo mismo aplica a eventos de alta frecuencia (pointermove durante un arrastre):
muta el ref en vivo, y solo haz `setState` una vez al final (p. ej. en pointer-up)
para sincronizar el valor final de vuelta a React si algo no-render lo necesita.
 
## Regla 2 — Mueve con `delta`, no con pasos fijos
 
`useFrame((state, delta) => ...)` te da los segundos desde el frame anterior. Úsalo
para que la app corra a la misma velocidad en un portátil a 60 Hz y en un monitor a
144 Hz.
 
```ts
useFrame((_, delta) => { ref.current.rotation.y += delta * SPIN_RATE; });
```
 
Los incrementos por-frame fijos (`+= 0.01`) hacen que la velocidad dependa de la
tasa de refresco.
 
## Regla 3 — No asignes en `useFrame`
 
Crear un `THREE.Vector3` / `Quaternion` / `Matrix4` dentro del bucle genera basura
60 veces por segundo y alimenta al GC, que causa tirones periódicos. Crea objetos
scratch una vez y reutilízalos. (Esta es la cara del lado render de la skill
`workers-memory-optimization`.)
 
```ts
// ❌ new Vector3 cada frame
useFrame(() => { ref.current.position.lerp(new THREE.Vector3(x, y, z), 0.1); });
 
// ✅ reutiliza un vector (el inicializador de useState corre una vez; sobrevive a re-renders)
const [vec] = useState(() => new THREE.Vector3());
useFrame(() => { ref.current.position.lerp(vec.set(x, y, z), 0.1); });
```
 
Los objetos scratch de ámbito de módulo también valen, mientras no se compartan
entre instancias que corran a la vez.
 
## Regla 4 — Lee el estado de cambio rápido de forma transitoria (Zustand)
 
Enlazar estado del store que cambia rápido a un componente con el hook selector
reactivo re-renderiza el componente en cada cambio: el mismo problema que la
Regla 1.
 
```ts
// ❌ re-renderiza este componente cada vez que x cambia (p. ej. a 60 fps)
const x = useWorldStore(s => s.x);
return <mesh position-x={x} />;
```
 
Dos opciones correctas:
 
```ts
// ✅ A) toma el valor dentro de useFrame vía getState — cero re-renders
const ref = useRef<THREE.Mesh>(null!);
useFrame(() => { ref.current.position.x = useWorldStore.getState().x; });
return <mesh ref={ref} />;
 
// ✅ B) suscríbete de forma transitoria y escribe directo al ref
const ref = useRef<THREE.Mesh>(null!);
useEffect(
  () => useWorldStore.subscribe(
    s => s.x,
    x => { ref.current.position.x = x; }
  ),
  []
);
return <mesh ref={ref} />;
```
 
Los hooks selectores reactivos (`useWorldStore(s => s.algo)`) son perfectos para
estado **infrecuente** (puntuación, arma actual, menú abierto) porque un selector
solo re-renderiza cuando *ese* slice cambia. Simplemente nunca los uses para datos
a tasa de frames.
 
## Regla 5 — Comparte y memoiza geometrías/materiales
 
Cada material distinto debe compilarse; cada geometría debe procesarse. Un literal
`<meshStandardMaterial color="red" />` nuevo en cada render hace que Three.js
descarte en silencio el recurso de GPU viejo y suba uno nuevo: muerte por mil
recompilaciones.
 
```ts
// ✅ crea una vez, reutiliza entre instancias
const geom = useMemo(() => new THREE.BoxGeometry(), []);
const mat  = useMemo(() => new THREE.MeshStandardMaterial({ color: 'orange' }), []);
return items.map(i => <mesh key={i.id} geometry={geom} material={mat} position={i.pos} />);
```
 
## Regla 6 — Instancia los objetos repetidos
 
Para muchos objetos del mismo tipo (balas, tiles, asteroides, multitud) no montes
un `<mesh>` por cada uno. Usa `InstancedMesh` y escribe las transformaciones por
instancia en la matriz de instancia dentro de `useFrame` (reutilizando un `Matrix4`
scratch). Una sola draw call en vez de miles.
 
## Regla 7 — No montes/desmontes indiscriminadamente
 
Montar crea recursos de GPU; desmontar los descarta; hacerlo rápido genera thrash.
En Three.js es común *no* remontar en absoluto. Alterna la visibilidad, mueve los
objetos fuera de pantalla, o recíclalos desde un pool en vez de agitar el grafo de
escena. Cachea assets asíncronos con `useLoader` (deduplica y cachea) en vez de
construir un loader por componente.
 
## Arquitectura: mantén la sim fuera de React por completo
 
Para un juego, guarda el mundo autoritativo/predicho en un **store de Zustand
Vanilla** (`createStore` de `zustand/vanilla`), no en un store enlazado a React.
Este store vive fuera del ciclo de vida de React, lo muta la capa de
red/predicción a tasa de tick, y lo lee `useFrame` vía `getState()` o `subscribe`
transitorio. Los componentes de React leen solo los slices lentos y de
presentación por hooks selectores. En este repo es `worldStore.ts` en
`features/canvas-3d/store/`, y lo alimenta `useGameSockets.ts` de
`features/matchmaking/hooks/`.
 
```ts
import { createStore } from 'zustand/vanilla';
 
export const worldStore = createStore<WorldState>(() => ({
  entities: new Map(),     // lo muta la sim, lo lee useFrame
  score: 0,                // lento → seguro de leer reactivamente en el HUD
}));
 
// la red/predicción escribe aquí cada tick; la escena lo lee cada frame;
// React solo re-renderiza el HUD cuando cambia `score`.
```
 
Esto refleja la separación de `hexagonal-vertical-slicing`: la simulación pura
posee el estado, el render es un *adaptador driven* que lo lee y empuja píxeles;
nunca posee estado de juego.
 
## Triaje rápido cuando "la escena va a tirones"
 
1. Busca `setState`/`setX`/hooks selectores del store llamados dentro de `useFrame`
   o un intervalo por-frame → muévelo a mutación de ref.
2. Busca `new THREE.*` dentro de `useFrame` → súbelo a un objeto scratch
   reutilizado.
3. Busca **literales** de material/geometría que se recreen en cada render →
   memoiza y comparte.
4. Muchos meshes similares → cambia a `InstancedMesh`.
5. Incrementos fijos → cambia a `delta`.
6. Montaje/desmontaje frecuente → alterna visibilidad o poolea en su lugar.
## Definition of done
 
No ocurre ningún update de estado reactivo por frame; los valores animados se mutan
directamente sobre refs dentro de `useFrame`; el movimiento usa `delta`; no se
asignan objetos en el bucle; las geometrías/materiales se memoizan y comparten (e
instancian donde se repiten); el estado de cambio rápido se lee vía `getState()` o
`subscribe` transitorio; los hooks selectores reactivos se usan solo para estado
lento y de presentación; y la simulación vive en un store vanilla fuera de React.
 
## Referencia
 
- React Three Fiber, *Performance pitfalls* (fuente autoritativa de todas las
  reglas de arriba): https://r3f.docs.pmnd.rs/advanced/pitfalls
- R3F scaling-performance e instancing:
  https://r3f.docs.pmnd.rs/advanced/scaling-performance
- Store vanilla de Zustand: https://zustand.docs.pmnd.rs/apis/create-store
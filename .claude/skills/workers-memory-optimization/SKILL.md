---
name: workers-memory-optimization
description: >-
  TypeScript consciente de memoria y GC para el runtime de V8 isolates que mueve
  Cloudflare Workers y Durable Objects, donde el límite duro es 128 MB por isolate
  y el bucle de juego/tick corre muchas veces por segundo. Usa esta skill SIEMPRE
  que escribas o revises cualquier camino caliente por-frame o por-tick, un bucle
  de juego, un paso de física, serialización/encoding, o cualquier código que
  corra a alta frecuencia en backend o frontend; y siempre que el síntoma sea
  "micro-stutter", "tirones periódicos", "pausas de GC", "el worker excedió la
  memoria" o "picos en el frame time". Impone object pooling, pre-asignación,
  formas de objeto monomórficas (hidden classes estables de V8) y bucles calientes
  sin asignaciones. Aplícala ANTES de escribir el código del bucle, no como una
  pasada de optimización posterior: meter pooling a posteriori es mucho más caro
  que diseñarlo desde el principio.
---
 
# Optimización de memoria y GC en V8 / Workers
 
El runtime es un único V8 isolate con tope de **128 MB**, compartido entre
peticiones concurrentes, con un presupuesto por defecto de **30 s de CPU** por
invocación. No hay forma de subir el techo de 128 MB. Dentro de ese presupuesto
corre un recolector de basura que no puedes afinar. En un bucle de juego que corre
30–60 veces por segundo, **cada objeto que asignas en el camino caliente es presión
futura de GC**, y una pausa de GC es un tirón visible.
 
El modelo mental: en el camino caliente, *asignar es el enemigo*. Fuera del camino
caliente (setup, joins, eventos ocasionales) escribe código idiomático normal.
Optimiza el bucle; deja el resto legible.
 
Lee esto antes de escribir cualquier código por-tick / por-frame.
 
## La regla que más importa
 
**No asignes dentro del bucle.** Nada de `new`, ni literales de objeto/array que
escapen, ni `.map`/`.filter`/`.reduce` que construyan arrays intermedios, ni
closures creados por iteración, ni concatenación de strings. Asigna una vez, al
principio, y reutiliza.
 
```ts
// ❌ asigna un Vector, un array y un closure cada tick → diente de sierra de GC
function step() {
  const delta = new Vec3(vx * dt, vy * dt, vz * dt);
  entities.map(e => e.pos.add(delta));
}
 
// ✅ cero asignaciones: muta in situ, reutiliza scratch, for clásico
const _delta = new Vec3(); // ámbito de módulo/instancia, asignado una vez
function step() {
  _delta.set(vx * dt, vy * dt, vz * dt);
  for (let i = 0; i < entities.length; i++) {
    entities[i].pos.addMut(_delta);
  }
}
```
 
Si no recuerdas nada más: un heap que sube de forma sostenida durante el juego, con
caídas periódicas, es el diente de sierra del GC; significa que el bucle está
asignando. El arreglo siempre es "deja de asignar en el bucle", no "asigna más
rápido".
 
## Object pooling
 
Para objetos que aparecen y desaparecen durante el juego (proyectiles, partículas,
eventos de impacto, paquetes de red, vectores temporales) no hagas `new` y los
descartes. Mantén un pool: adquiere de él, devuélvelos a él.
 
```ts
class Pool<T> {
  private free: T[] = [];
  constructor(private make: () => T, private reset: (o: T) => void, prime = 0) {
    for (let i = 0; i < prime; i++) this.free.push(make());
  }
  acquire(): T { return this.free.pop() ?? this.make(); }
  release(o: T): void { this.reset(o); this.free.push(o); }
}
 
const bullets = new Pool<Bullet>(() => new Bullet(), b => b.reset(), 256);
 
const b = bullets.acquire();
b.init(x, y, angle);
// ...más tarde, cuando expira:
bullets.release(b);
```
 
Poolea todo cuya vida sea más corta que la partida: proyectiles, efectos,
manifolds de colisión, vectores/matrices scratch y **los buffers de encode/decode
de red**. Pre-llena el pool al número esperado en régimen permanente para no pagar
asignaciones en el primer momento intenso de juego.
 
## Pre-asigna buffers; reutiliza typed arrays
 
La serialización es un asignador oculto clásico. Un `new Uint8Array(n)` o un
`JSON.stringify` por tick agita el heap. Asigna un buffer por sala/bucle y escribe
en él cada tick con un cursor reseteable.
 
```ts
const scratch = new ArrayBuffer(MAX_SNAPSHOT_BYTES); // una vez
const view = new DataView(scratch);
function encodeSnapshot(world: World): Uint8Array {
  let o = 0;
  view.setUint32(o, world.tick); o += 4;
  // ...escribir campos...
  return new Uint8Array(scratch, 0, o); // una vista, no una copia
}
```
 
Prefiere `ArrayBuffer`/`DataView`/typed arrays sobre arrays-de-objetos para estado
numérico pesado. Son contiguos, baratos de limpiar y no fragmentan el heap.
 
## Mantén las formas de objeto monomórficas (hidden classes de V8)
 
V8 optimiza el acceso a propiedades asignando a cada objeto una **hidden class**
(map) y cacheando los lookups inline. Lo mantienes rápido manteniendo *estables*
las formas de los objetos:
 
- **Inicializa cada campo en el constructor**, en el mismo orden, incluso los que
  empiezan en `null`/`0`. No añadas propiedades después.
- **Nunca hagas `delete` de propiedades** en objetos calientes: fuerza una
  transición de forma y desoptimiza el inline cache. Pon `null`/`0` en su lugar (y
  así debe funcionar el `reset()` de un objeto pooleado).
- **Mantén los tipos estables por campo.** Un campo que a veces es número y a veces
  string vuelve *megamórfico* y lento el sitio de acceso.
- **No pases objetos de formas distintas a la misma función caliente.** Una función
  llamada con una forma consistente se mantiene monomórfica y se inlinea; llámala
  con cinco formas y se degrada.
```ts
// ❌ la forma muta → deopt
class Entity { constructor() { this.x = 0; this.y = 0; } }
const e = new Entity();
e.vx = 1;            // añadido después → nueva hidden class
delete e.y;          // borrado → deopt
 
// ✅ forma fija, declarada una sola vez
class Entity {
  x = 0; y = 0; vx = 0; vy = 0; hp = 0; dead = false;
  reset() { this.x = 0; this.y = 0; this.vx = 0; this.vy = 0; this.hp = 0; this.dead = false; }
}
```
 
## Evita asignadores ocultos y disparadores de deopt en el camino caliente
 
- **Métodos de array que asignan**: `map`, `filter`, `slice`, `concat`,
  `Object.values`, spread `[...arr]`, `Array.from`. Cada uno devuelve un array
  nuevo. En el bucle, usa `for` indexado y muta in situ.
- **Closures por iteración**: `arr.forEach(x => ...)` asigna un contexto de
  closure. Saca los callbacks fuera o inlinea el bucle.
- **Construcción de strings**: evita `+`/template strings en el bucle; arma el
  texto fuera o envía binario.
- **`async`/`await` en el bucle interno más ajustado**: cada suspensión tiene
  overhead y asigna promesas. Mantén la sim interna síncrona; haz el I/O en el
  borde del bucle.
- **Boxing**: no guardes números en `Map`/`Set` con clave de objeto cuando un array
  indexado por un id entero pequeño serviría.
## Gotchas del ciclo de vida del Durable Object (específicos de memoria)
 
- **El estado en memoria se descarta al hibernar/desalojar.** Pools, buffers
  scratch y caches *no* sobreviven. Reconstrúyelos perezosamente en el constructor
  o en el primer uso, y mantén el constructor barato porque corre de nuevo en cada
  *wake*.
- **Persiste el estado durable explícitamente** al storage del DO; nunca asumas que
  un `Map` en memoria seguirá ahí en la próxima petición.
- **El tiempo de CPU es solo procesamiento activo**: el tiempo esperando
  storage/red/IO no cuenta contra el presupuesto de 30 s, pero un bucle ocupado y
  asignón sí. Ajusta el bucle, no solo muevas trabajo detrás de un `await`.
## Cómo medir
 
No adivines. Confirma:
- **Tiempo de frame/tick**: registra duración min/media/máx del step; las pausas de
  GC aparecen como picos máximos muy por encima de la media.
- **Tendencia del heap**: un diente de sierra que sube durante el juego = bucle
  asignando. Plano = bien.
- **Profiling de CPU**: perfila localmente (p. ej. con DevTools contra
  `wrangler dev`) para encontrar los sitios calientes de asignación antes de
  optimizar.
- Optimiza lo que el profiler señale; no poolees cosas que se asignan una sola vez
  en el setup.
## Definition of done
 
El camino caliente no asigna nada por tick/frame; los objetos transitorios salen de
pools; la serialización escribe en buffers reutilizables pre-asignados; los objetos
calientes tienen forma fija declarada en su constructor y nunca se extienden ni se
hace `delete`; los bucles calientes son `for` indexados sin métodos de array que
asignen ni closures por iteración; y los caches en memoria del DO se tratan como
reconstruibles, con el estado durable persistido al storage.
 
## Referencia
 
- Cloudflare, *Workers Limits* (128 MB por isolate, tiempo de CPU):
  https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare, *Durable Objects Limits* (CPU por invocación, storage):
  https://developers.cloudflare.com/durable-objects/platform/limits/
- Cloudflare, *Lifecycle of a Durable Object* (el estado en memoria es volátil):
  https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/
- Blog de V8 (internals del motor, hidden classes, GC): https://v8.dev/blog
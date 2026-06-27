/**
 * *** CONFIG WASM (Rapier) — punto único de inicialización. ***
 *
 * Usamos `@dimforge/rapier3d-compat`: este build INLINEA el binario WASM como
 * base64 dentro del JS y expone `await RAPIER.init()`. Ventajas decisivas para
 * este proyecto:
 *   - Funciona IGUAL en Cloudflare Workers (workerd) y en el navegador desde UN
 *     solo paquete compartido (`@mecha/sim`) — requisito de netcode.
 *   - NO requiere `vite-plugin-wasm` ni `vite-plugin-top-level-await`, ni imports
 *     `.wasm` (prohibidos vía CDN en Workers): el WASM viaja embebido en el bundle.
 *
 * Regla (skills `hexagonal-vertical-slicing` + `workers-memory-optimization`):
 * `init()` se llama UNA sola vez, en la composition root (constructor del DO en el
 * backend; arranque del cliente en el frontend). NUNCA por tick. El `world.step()`
 * posterior es síncrono. Tras hibernar, el isolate se recrea ⇒ se vuelve a init
 * perezosamente; por eso el patrón es un singleton lazy.
 *
 * Determinismo (skill `authoritative-netcode`): servidor y cliente DEBEN cargar
 * la MISMA versión exacta de Rapier (pin sin `^` en el catalog).
 *
 * SCAFFOLD del Paso 1.
 */
import RAPIER from '@dimforge/rapier3d-compat';

let _ready: Promise<typeof RAPIER> | null = null;
let _rapier: typeof RAPIER | null = null;

/** Inicializa Rapier una vez (idempotente). Llamar en la composition root. */
export function initRapier(): Promise<typeof RAPIER> {
  if (_ready) return _ready;
  _ready = RAPIER.init().then(() => {
    _rapier = RAPIER;
    return RAPIER;
  });
  return _ready;
}

/** Acceso síncrono tras `initRapier()`. Lanza si aún no se inicializó (bug, no error de negocio). */
export function getRapier(): typeof RAPIER {
  if (!_rapier) {
    throw new Error('Rapier no inicializado. Llama a initRapier() en la composition root.');
  }
  return _rapier;
}

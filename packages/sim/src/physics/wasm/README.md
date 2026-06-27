# Config WASM (Rapier) — aislada aquí a propósito

El prompt exige "separación de los archivos de configuración para WASM (Rapier)".
Toda esa preocupación vive en esta carpeta: un único módulo de inicialización
(`rapier-init.ts`) y estas notas. El resto del kernel solo ve el puerto
`IPhysicsWorld`.

## Build elegido: `@dimforge/rapier3d-compat` (NO `rapier3d` plano)

| | `@dimforge/rapier3d` | `@dimforge/rapier3d-compat` ✅ |
|---|---|---|
| Entrega del WASM | `import "...wasm"` (archivo aparte) | **inlined base64** en el JS |
| Init | top-level await del módulo | `await RAPIER.init()` explícito |
| Vite | requiere `vite-plugin-wasm` + `top-level-await` | **sin plugins extra** |
| Cloudflare Workers | frágil (import `.wasm`) | **funciona tal cual** |
| Un paquete para server+cliente | difícil | **directo** ✅ |

Por eso, en este monorepo **no** hay `vite-plugin-wasm` ni
`vite-plugin-top-level-await`: el `-compat` los hace innecesarios. Si algún día se
migra al build no-compat por rendimiento, esos plugins se añadirían al
`vite.config.ts` del frontend y a la config de bundle del worker — y ese cambio se
documenta aquí.

## Reglas de uso

1. **`initRapier()` una sola vez**, en la composition root:
   - Backend: en el constructor de `GameRoomDO` (se re-ejecuta en cada *wake* tras
     hibernar — barato porque es idempotente).
   - Frontend: al arrancar el cliente, antes de crear el primer `RapierPhysicsWorld`.
2. **Nunca `await` por tick.** Tras init, `world.step()` es síncrono.
3. **Misma versión EXACTA** de Rapier en server y cliente (catalog, pin sin `^`):
   un mismatch rompe el determinismo cross-platform del netcode.

## Puntos a verificar (Paso 1)

- ⚠ Confirmar la **última versión** de `@dimforge/rapier3d-compat` en npm y fijarla
  exacta en `pnpm-workspace.yaml` (catalog).
- ⚠ Confirmar que el bundle del **worker de juego** (wrangler/esbuild) embebe el
  WASM base64 sin intentar un fetch externo (prohibido en Workers).
- ⚠ Medir el tamaño del WASM (~varios MB) contra el límite de **128 MB** del isolate
  (skill `workers-memory-optimization`): holgado, pero monitorizar con muchas salas.

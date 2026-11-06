# 21 · Paso 18 — Rework visual "oficina" + fix z-fighting (playtest r4)

> Feedback del usuario: "las paredes comienzan a parpadear" + directriz estética
> completa (renderer, iluminación de interiores, materiales, props de oficina,
> personajes). Ejecutado como Game Director (`threejs-game-director`); skills
> hermanas NO instaladas ⇒ principios del director + skills del repo.

## 1. El parpadeo era TRES bugs de geometría (todos con test de regresión)

1. **Caras coplanarias en esquinas de muros**: la fusión de tramos extendía los
   extremos ±t/2 ⇒ el tope de un muro quedaba EXACTAMENTE en el plano de la cara
   lateral del muro perpendicular. Fix: extensión `t/2−0.1` (esquina sellada,
   tope a 1 cm de la cara vecina).
2. **Esquinas del PERÍMETRO**: grosor clavado a ras del bound + tapa del muro
   perpendicular clamped al MISMO bound ⇒ coplanarias en CADA esquina. Fix:
   `pushWall(axis)`: grosor a ras, tapas con inset `CAP_EPS=0.1` (0.05 era caso
   `.5` que `q()` redondeaba fuera).
3. **`q()` redondea `.5` hacia +∞** y clava caras de props/galletas en planos de
   muro (p. ej. galleta −35.75 → −35.7 = cara del muro). Fixes: offsets de
   galleta en múltiplos de 0.1 que no caen en planos de muro (x+0.2/x+0.5) +
   **post-pase `deplanarizeProps`**: escaneo determinista de pares sólidos que
   separa cualquier prop coplanario con un nudge de 0.1 ALEJÁNDOSE del otro
   sólido (máx 4 pases; frío, una vez por ronda).

**Y un cuarto bug que encontró el test de perímetro**: los bucles de aristas solo
cubrían celdas interiores ⇒ **la casa estaba ABIERTA en todo su contorno** (el
clamp de posición la cerraba de facto, pero visual y para el rayo quedaba
expuesta). Los bucles ahora van de −1 a COLS/ROWS (incluyen celda|fuera).

Tests de regresión (10 semillas): `anti z-fighting` (pares de caras X/Z
coplanarias solapadas) · `perímetro CERRADO` (toda celda de piso del borde con
muro) · invariantes de muebles.

## 2. Directriz visual (implementada tal cual)

| Spec | Implementación |
|---|---|
| PCFSoftShadowMap + ACESFilmic 1.2 | `<Canvas shadows="soft" gl={{toneMapping: ACESFilmic, toneMappingExposure: 1.2}}>` (fuera `SoftShadows` de drei) |
| Ambiente frío #223344·0.4 | `<ambientLight>` reemplaza al hemisférico |
| Direccional diagonal + sombras 2048 | sol [14,20,8], castShadow, 2048², cámara ±52 |
| PointLights cálidas en techos (decay 2) | ~60-90 lámparas por casa; **pool de 6 luces** reasignadas por frame a las más cercanas a la cámara (top-K sin allocar; >6 luces fijas matan el forward renderer). Lámparas lejanas: malla emisiva |
| Muros mate 0.8/0 · suelos pulidos 0.3/0.1 | valores en el GENERADOR (`MapZone` es la verdad del render) |
| Reflexión sutil de suelos | `PMREMGenerator` + `RoomEnvironment` (módulo LOCAL de three — cero descargas) · `scene.environmentIntensity 0.3` |
| castShadow/receiveShadow | en toda malla jugable; lámparas instanciadas con castShadow |
| Props de oficina low-poly | **en el generador** (sim): archivadores 0.9×2.1×0.7, mesas 1.6×0.75×0.8, terminales-kiosco 0.6×1.4×0.5, taburetes Ø0.6×0.9 — en las ESQUINAS de las celdas (±1.05: no pisan estatuas centrales ni puertas). ≥30 por mapa (72 en seed 1), SÓLIDOS para el servidor (oclusión + camuflaje + anti-cheat) |
| Personajes: apariencia | ojos-bolita low-poly en de pie y agachado (leídos por sombreado; misma geometría que los señuelos ⇒ mimetismo intacto; dentro del fleco del hitbox, tests verdes) |
| Personajes: movilidad | `maxSpeed` 6→6.5 (paso más ágil para la casa 2.2×; el clamp anti-trampas usa el mismo valor) |
| Formas más complejas de esconderse | los muebles dan cobertura/oclusión nueva: archivadores altos tras los que posarse "plano", mesas para la pose agachado, terminales junto a los que hacerse caja |

## 3. Optimizaciones (`r3f-rendering` + `workers-memory-optimization`)

- **Geometrías unitarias compartidas** (box/cyl/sphere/plane) escaladas por malla:
  305 zonas ⇒ ~6 buffers GPU.
- **Cache de materiales** por (color|rough|metal|flat): ~45 materiales vs ~300;
  sobreviven a las rondas (cero churn de GPU al cambiar de mapa).
- **Lámparas en UN InstancedMesh** (poste+pantalla fusionados + bombillas
  emisivas en otro): ~130 lámparas = 2 draw calls.
- Pool de luces: scratch preasignado (Float64Array/Int32Array/Uint8Array),
  cero allocs por frame, cero setState.
- Geometrías de pose: singleton de módulo (antes se filtraban 6 fusiones por ronda).

## 4. Verificación

- 359 tests verdes (sim 230 con anti z-fighting/perímetro/oficina/puertas; fe 66;
  be 36; shared 25) + 28 workerd · typecheck · lint.
- E2E 2 navegadores 8/8 (flujo completo con el render nuevo).
- Numérico: **60.2 FPS** en lobby con 305 zonas · WebGL2 · cero errores de
  consola/página · misma semilla en ambos clientes (determinismo).
- Golden replay actualizado (solo velocidad de pase 6→6.5).

## 5. Notas / pendientes

- Los techos no existen (estética elegida: lámparas de poste + luz de sol
  diagonal); si el playtest pide interiores más oscuros, techos por cuarto con
  agujero de "claraboya" sobre el sol es el siguiente paso.
- Favicons 404 en dev (dos páginas): cosmético, no bloquea.
- El buscador de fps del HUD y el modo limitado de munición siguen igual.

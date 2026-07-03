# 14 · Paso 11 — V1-F Results/Reveal (answer-check) + el bug de la "sala congelada en el pasado"

> El *payoff* del original: al terminar la ronda se REVELA dónde se escondió cada
> Hider y cómo se pintó ("¡¿estaba AHÍ?!"). Y de propina, el E2E de verificación cazó
> un bug de persistencia que explicaba el feedback del playtest ("no importa desde qué
> distancia debería atrapar").

---

## V1-F · El tour de revelado

- **[`reveal.ts`](../apps/frontend/src/features/canvas-3d/hooks/reveal.ts)** (lógica
  pura, TDD): `buildRevealList` — todos los que JUGARON de Hider (un atrapado termina
  como 'seeker'+caught por la infección; un Seeker de origen no se revela), orden
  **atrapados primero, supervivientes al final** (clímax); `revealIndexAt` — un
  escondite cada `REVEAL_SECONDS` (3 s), −1 = tour terminado.
- **Congelado al entrar en `ended`** (`useGameSockets`): `worldStore.revealList` +
  `endedAt`. **`catchSpots`**: la posición se captura EN el momento de la captura
  (local y remotos) — el reveal enseña DÓNDE cayó, no dónde acabó tras volverse
  Seeker. Se limpia en la revancha.
- **Cámara** (`CameraRig`): en `ended` con tour activo, ORBITA el escondite en curso
  (radio 4.5, lerp de viaje rápido); cámara y HUD calculan el índice con la MISMA
  función pura — nunca se desincronizan.
- **HUD**: tarjeta inferior con "🔎 Escondite i/N", swatch de la pintura final,
  estado (🦎 ¡Sobrevivió! / ✕ Atrapado), "(tú)", camuflaje % y pose. El panel de
  victoria con "Jugar otra vez" llega TRAS el tour.

## 🐛 El bug: `SimConfig` persistido (regresión real, cazada por el E2E)

Los disparos E2E a >3 m **nunca** atrapaban aunque el rayo diera en el centro exacto
del hitbox (log del DO: `raySphere t=5.47` pero `hit=null`). Causa raíz:
`DoStorageRoomRepository.fromSnapshot` rehidrataba el **`SimConfig` persistido** — la
sala `demo` guardada antes del Paso 7.5 revivía con `catchRange: 3` (el "toque"
viejo), prep/hunt antiguos, etc. **Esto es lo que sufría el usuario en su playtest**
("cuando dispare a un Hider no importa desde qué distancia…"): no era falta de
feedback — era el alcance viejo congelado en su sala persistida.

- **Regla nueva (test de regresión)**: el `SimConfig` es **CÓDIGO, no estado** — al
  rehidratar se usa SIEMPRE el del build actual. Las futuras opciones del host (V1-E,
  `ammoLimitEnabled`) irán en `RoomConfig` (server-only), no congelando el SimConfig.
- De paso el snapshot de jugador ahora conserva `aimY/pose/ammo/shotCooldownUntil`
  (antes se perdían si el DO hibernaba a mitad de ronda); campos opcionales para
  retro-compatibilidad con snapshots viejos.

## Verificación (y guerra de tooling)

- Suite: shared 7 · sim 109 · **backend 25** (+2 regresión) · **frontend 33** (+5
  reveal) · DO 6 · typecheck · lint · build — verde.
- **E2E real**: disparo con pitch a un Hider AGACHADO a ~6 m (¡el hitbox por pose
  funcionó: el primer intento falló porque el rayo horizontal pasaba por encima!) →
  captura → fin instantáneo → **tarjeta del tour orbitando el escondite** → panel
  final. Capturas en el scratchpad.
- Lecciones del entorno E2E (para futuras sesiones):
  - `pkill -f "wrangler dev"` NO mata el `workerd` — quedan **zombies** sirviendo
    código viejo en 8787 (y vite salta a 5174+). Matar `wrangler`+`workerd`+`vite` y
    verificar el puerto en el log antes de testear. OJO: el vite del frontend TAMBIÉN
    usa workerd (plugin de Cloudflare) — reiniciarlo tras la limpieza.
  - El pointer lock es flaky en Chrome headless: los hooks dev-only `window.__world`
    y `window.__look` (solo `import.meta.env.DEV`) permiten leer estado real y
    apuntar determinista.

## Qué falta para cerrar V1

**V1-E matchmaking por código** (siguiente) · V1-H audio · V1-I deploy. Checklist en
[`docs/09`](09-v1-scope.md).

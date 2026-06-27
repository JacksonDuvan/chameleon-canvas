# Patrón Result: helpers y composición
 
Lee esto cuando necesites encadenar varias operaciones que devuelven `Result` sin
caer en pirámides de `if (!res.ok) return ...`. El tipo base y las reglas están en
el `SKILL.md`; aquí están los combinadores y los patrones de uso.
 
## El tipo y los constructores
 
```ts
export type Result<T, E> =
  | { readonly ok: true;  readonly value: T }
  | { readonly ok: false; readonly error: E };
 
export const Ok  = <T>(value: T): Result<T, never> => ({ ok: true,  value });
export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });
 
export const isOk  = <T, E>(r: Result<T, E>): r is { ok: true;  value: T } => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is { ok: false; error: E } => !r.ok;
```
 
## Combinadores
 
`map` — transforma el valor de éxito; deja pasar el error intacto.
 
```ts
export const map = <T, U, E>(r: Result<T, E>, f: (t: T) => U): Result<U, E> =>
  r.ok ? Ok(f(r.value)) : r;
```
 
`mapErr` — transforma el error (útil para traducir errores de adaptador a errores
de dominio en el borde).
 
```ts
export const mapErr = <T, E, F>(r: Result<T, E>, f: (e: E) => F): Result<T, F> =>
  r.ok ? r : Err(f(r.error));
```
 
`andThen` (flatMap) — encadena otra operación que también devuelve `Result`; corta
en el primer `Err`. Es el sustituto del `try` anidado.
 
```ts
export const andThen = <T, U, E>(
  r: Result<T, E>,
  f: (t: T) => Result<U, E>,
): Result<U, E> => (r.ok ? f(r.value) : r);
```
 
`unwrapOr` — extrae el valor o un default (nunca lanza).
 
```ts
export const unwrapOr = <T, E>(r: Result<T, E>, fallback: T): T =>
  r.ok ? r.value : fallback;
```
 
`combine` — junta un array de `Result`; `Ok` con todos los valores, o el primer
`Err`.
 
```ts
export const combine = <T, E>(rs: Result<T, E>[]): Result<T[], E> => {
  const out: T[] = [];
  for (const r of rs) {
    if (!r.ok) return r;
    out.push(r.value);
  }
  return Ok(out);
};
```
 
## Encadenado legible (en vez de try/catch anidado)
 
```ts
// PlayerJoin: validar sala -> verificar cupo -> verificar monetización -> añadir
execute(cmd: JoinCmd): Result<Room, JoinError> {
  return andThen(this.loadRoom(cmd.roomId), (room) =>
    andThen(this.checkCapacity(room), (room) =>
      andThen(this.monet.canJoin(cmd.playerId), (entitlement) =>
        Ok(room.addPlayer(cmd.playerId, entitlement)),
      ),
    ),
  );
}
```
 
Si el equipo prefiere una cadena fluida, `neverthrow` ofrece la misma semántica
con `.map()`, `.andThen()`, `.mapErr()` sobre objetos `Result`. El contrato es
idéntico; elige uno y sé consistente en todo el repo.
 
## Convertir excepciones en Result, en el borde
 
Las APIs externas lanzan. Captura **en el adaptador** y devuelve un error de
dominio tipado, para que el núcleo nunca vea un `try/catch`.
 
```ts
// infrastructure/adapters/KvMonetizationAdapter.ts
async canJoin(playerId: string): Promise<Result<Entitlement, MonetError>> {
  try {
    const raw = await this.kv.get(`ent:${playerId}`);
    return raw ? Ok(parseEntitlement(raw)) : Ok(FREE_TIER);
  } catch (e) {
    return Err({ kind: 'MonetizationUnavailable', cause: String(e) });
  }
}
```
 
## Exhaustividad: que el compilador te obligue
 
Apóyate en `never` para no olvidar ningún caso de error al traducir al transporte:
 
```ts
function assertNever(x: never): never {
  throw new Error(`Caso no manejado: ${JSON.stringify(x)}`);
}
 
switch (err.kind) {
  case 'PlayerNotFound': /* ... */ break;
  case 'ColorLocked':    /* ... */ break;
  case 'OutOfBounds':    /* ... */ break;
  default: assertNever(err); // error de compilación si añades un kind y no lo manejas
}
```
 
## Qué hacer / qué no
 
- HAZ que dominio y use-cases devuelvan `Result`. NO lances errores de negocio.
- HAZ que los errores sean uniones discriminadas tipadas. NO uses strings ni
  `Error` genéricos para errores esperados.
- HAZ el `try/catch` solo en adaptadores, convirtiendo a `Err(...)`. NO metas
  `try/catch` en el dominio.
- HAZ exhaustivos los `switch` sobre `kind` con `assertNever`. NO uses `default`
  silencioso que oculte casos nuevos.
- HAZ `andThen`/`combine` para encadenar. NO anides 5 niveles de `if (!res.ok)`.
 
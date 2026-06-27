/**
 * Patrón Result (estilo Rust): los errores son VALORES, no excepciones.
 *
 * Gobernado por la skill `hexagonal-vertical-slicing` (y su referencia
 * `result-pattern.md`). El dominio y los use-cases DEVUELVEN `Result`; nunca
 * lanzan errores de negocio. Las excepciones reales (I/O, red) se capturan en
 * el borde (adaptador) y se convierten en `Err(tipoDeDominio)`.
 *
 * Import canónico en todo el monorepo: `@shared/result`.
 */

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const isOk = <T, E>(r: Result<T, E>): r is { ok: true; value: T } => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is { ok: false; error: E } => !r.ok;

/** Transforma el valor de éxito; deja pasar el error intacto. */
export const map = <T, U, E>(r: Result<T, E>, f: (t: T) => U): Result<U, E> =>
  r.ok ? Ok(f(r.value)) : r;

/** Transforma el error (traduce errores de adaptador a errores de dominio en el borde). */
export const mapErr = <T, E, F>(r: Result<T, E>, f: (e: E) => F): Result<T, F> =>
  r.ok ? r : Err(f(r.error));

/** Encadena otra operación que también devuelve `Result`; corta en el primer `Err`. */
export const andThen = <T, U, E>(
  r: Result<T, E>,
  f: (t: T) => Result<U, E>,
): Result<U, E> => (r.ok ? f(r.value) : r);

/** Extrae el valor o un default (nunca lanza). */
export const unwrapOr = <T, E>(r: Result<T, E>, fallback: T): T =>
  r.ok ? r.value : fallback;

/** Junta un array de `Result`; `Ok` con todos los valores, o el primer `Err`. */
export const combine = <T, E>(rs: Result<T, E>[]): Result<T[], E> => {
  const out: T[] = [];
  for (const r of rs) {
    if (!r.ok) return r;
    out.push(r.value);
  }
  return Ok(out);
};

/**
 * Chequeo de exhaustividad: que el compilador te obligue a manejar cada `kind`
 * de error al traducir al transporte. Un `kind` nuevo no manejado => error de
 * compilación.
 */
export function assertNever(x: never): never {
  throw new Error(`Caso no manejado: ${JSON.stringify(x)}`);
}

/**
 * Helpers de aserción para `Result` (skill `tdd-testing`, ref. tooling-setup.md).
 * Estrechan el tipo y leen limpio. NO se esperan throws para errores de negocio.
 */
import { expect } from 'vitest';
import type { Result } from '@shared/result';

export function expectOk<T, E>(r: Result<T, E>): T {
  expect(r.ok, `se esperaba Ok pero fue Err: ${JSON.stringify(!r.ok && r.error)}`).toBe(
    true,
  );
  if (!r.ok) throw new Error('inalcanzable');
  return r.value;
}

export function expectErr<T, E extends { kind: string }>(
  r: Result<T, E>,
  kind: E['kind'],
): E {
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error('inalcanzable');
  expect(r.error.kind).toBe(kind);
  return r.error;
}

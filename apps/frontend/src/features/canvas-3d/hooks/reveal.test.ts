/**
 * reveal — lógica PURA del "answer-check" (V1-F): al terminar la ronda se revela
 * dónde se escondió cada Hider. Contratos:
 *  - La lista solo incluye a quienes JUGARON de Hider (los Seekers originales no
 *    tienen escondite que revelar).
 *  - Orden: atrapados primero, SUPERVIVIENTES al final (el clímax del tour).
 *  - El tour avanza por tiempo: un escondite cada REVEAL_SECONDS; al agotar la lista
 *    el tour termina (índice -1 ⇒ panel final).
 */
import { describe, expect, it } from 'vitest';
import { buildRevealList, revealIndexAt, REVEAL_SECONDS, type RevealSubject } from './reveal';

const subject = (over: Partial<RevealSubject>): RevealSubject => ({
  id: 'p',
  x: 0,
  y: 0,
  z: 0,
  role: 'hider',
  caught: false,
  colorPacked: 0xffffffff,
  camoScore: 0.5,
  pose: 0,
  ...over,
});

describe('buildRevealList', () => {
  it('incluye a los Hiders (vivos o atrapados) y excluye a los Seekers de origen', () => {
    const list = buildRevealList([
      subject({ id: 'cazador', role: 'seeker', caught: false }), // Seeker original
      subject({ id: 'superviviente', role: 'hider', caught: false }),
      subject({ id: 'caido', role: 'seeker', caught: true }), // Hider atrapado (infección → seeker)
    ]);
    expect(list.map((e) => e.id)).toEqual(['caido', 'superviviente']);
  });

  it('ordena: atrapados primero, supervivientes al final (clímax)', () => {
    const list = buildRevealList([
      subject({ id: 'vivo-1', caught: false }),
      subject({ id: 'caido-1', role: 'seeker', caught: true }),
      subject({ id: 'vivo-2', caught: false }),
      subject({ id: 'caido-2', role: 'seeker', caught: true }),
    ]);
    expect(list.map((e) => e.caught)).toEqual([true, true, false, false]);
  });

  it('conserva los datos del escondite (pos, color, camo, pose)', () => {
    const list = buildRevealList([
      subject({ id: 'h', x: 3, z: -7, colorPacked: 0xb5563fff, camoScore: 0.9, pose: 2 }),
    ]);
    expect(list[0]).toMatchObject({ x: 3, z: -7, colorPacked: 0xb5563fff, camoScore: 0.9, pose: 2 });
  });
});

describe('revealIndexAt', () => {
  it('avanza un escondite cada REVEAL_SECONDS y termina con -1', () => {
    expect(revealIndexAt(0, 3)).toBe(0);
    expect(revealIndexAt(REVEAL_SECONDS - 0.01, 3)).toBe(0);
    expect(revealIndexAt(REVEAL_SECONDS + 0.01, 3)).toBe(1);
    expect(revealIndexAt(REVEAL_SECONDS * 2.5, 3)).toBe(2);
    expect(revealIndexAt(REVEAL_SECONDS * 3 + 0.01, 3)).toBe(-1); // tour terminado
  });

  it('con lista vacía el tour no existe (-1 desde el inicio)', () => {
    expect(revealIndexAt(0, 0)).toBe(-1);
  });
});

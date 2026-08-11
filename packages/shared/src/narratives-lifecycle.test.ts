/**
 * Corre con:
 *   node_modules/.bin/tsx --test packages/shared/src/narratives-lifecycle.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLifecycleState, autoEps } from './narratives-math';

/**
 * Estos tests fijan los tres defectos que la auditoría de agosto encontró en la
 * máquina de estados, para que no vuelvan:
 *
 *  N6a · `born_at` es la mención MÁS VIEJA del cluster. Con el pool oldest-first
 *        eso hacía nacer narrativas con ageDays grande, así que nacían ya
 *        `declining`/`dormant` y JAMÁS pasaban por `emerging`.
 *  N6b · toda la velocidad se medía sobre `published_at`, así que una narrativa
 *        detectada hoy sobre menciones de hace 5 días tenía velocity24h=0. Es lo
 *        que producía la píldora "Pico" junto a "VEL. 24H 0.0".
 *  N6c · `revived` era estructuralmente inalcanzable y, cuando se alcanzaba,
 *        duraba una sola corrida.
 */
// ── computeLifecycleState
const base = {
  velocity24h: 0,
  avgVelocity7d: 0,
  daysSinceLast: 0,
  mentionCount: 12,
  ageDays: 0,
  prevStatus: null as null,
};

test('una narrativa recién detectada sobre menciones VIEJAS nace emerging, no declining', () => {
    // El caso real: el pool oldest-first entrega menciones de hace 20 días, así
    // que born_at queda a 20 días y daysSinceLast a 9 — con la lógica anterior
    // eso caía en `declining` en el mismo run que la creaba.
    const r = computeLifecycleState({
      ...base,
      ageDays: 20,
      daysSinceLast: 9,
      detectedDaysAgo: 0.2,   // la acabamos de detectar
      daysSinceAssigned: 0.2, // y de asignarle menciones
      mentionCount: 14,
    });
    assert.equal(r.status, 'emerging');
  });

test('sin los campos nuevos conserva el comportamiento anterior (compatibilidad)', () => {
    const r = computeLifecycleState({ ...base, ageDays: 20, daysSinceLast: 9 });
    assert.equal(r.status, 'declining');
  });

test('dormant sigue siendo dormant cuando de verdad no hay actividad', () => {
    const r = computeLifecycleState({
      ...base, daysSinceLast: 30, daysSinceAssigned: 30, ageDays: 60, detectedDaysAgo: 60,
    });
    assert.equal(r.status, 'dormant');
  });

test('revived es ALCANZABLE cuando una dormant recibe una mención nueva', () => {
    const r = computeLifecycleState({
      ...base, prevStatus: 'dormant', velocity24h: 3, daysSinceLast: 0, daysSinceAssigned: 0,
      ageDays: 90, detectedDaysAgo: 90,
    });
    assert.equal(r.status, 'revived');
  });

test('revived es STICKY: no se borra en la corrida siguiente si la actividad es reciente', () => {
    // Antes, con velocity24h de vuelta a 0 el siguiente ciclo lo mandaba a otro
    // estado y la señal "esto volvió" se perdía sin que nadie la viera.
    const r = computeLifecycleState({
      ...base, prevStatus: 'revived', velocity24h: 0, daysSinceLast: 1, daysSinceAssigned: 1,
      ageDays: 91, detectedDaysAgo: 91,
    });
    assert.equal(r.status, 'revived');
  });

test('revived deja de serlo cuando la actividad se enfría', () => {
    const r = computeLifecycleState({
      ...base, prevStatus: 'revived', velocity24h: 0, daysSinceLast: 20, daysSinceAssigned: 20,
      ageDays: 110, detectedDaysAgo: 110,
    });
    assert.equal(r.status, 'dormant');
  });

test('peaking exige velocidad significativa Y más del doble del promedio', () => {
    assert.equal(computeLifecycleState({ ...base, velocity24h: 12, avgVelocity7d: 4, mentionCount: 80, ageDays: 10, detectedDaysAgo: 10 }).status, 'peaking');
    // 4 supera el promedio pero no llega al mínimo absoluto de 5
    assert.notEqual(computeLifecycleState({ ...base, velocity24h: 4, avgVelocity7d: 1, mentionCount: 80, ageDays: 10, detectedDaysAgo: 10 }).status, 'peaking');
  });

test('enteredPeaking sólo se marca en la TRANSICIÓN, no en cada corrida', () => {
    const args = { ...base, velocity24h: 12, avgVelocity7d: 4, mentionCount: 80, ageDays: 10, detectedDaysAgo: 10 };
    assert.equal(computeLifecycleState({ ...args, prevStatus: 'active' }).enteredPeaking, true);
    assert.equal(computeLifecycleState({ ...args, prevStatus: 'peaking' }).enteredPeaking, false);
  });

// ── autoEps
// Puntos 1-D: la distancia es la diferencia absoluta. Con dos grupos densos
// separados, la k-distancia dentro del grupo es pequeña.
const d = (a: number, b: number) => Math.abs(a - b);

test('deriva eps de la distribución en vez de usar una constante', () => {
  const pts = [0, 0.01, 0.02, 0.03, 0.04, 10, 10.01, 10.02, 10.03, 10.04];
    const r = autoEps(pts, d, 2, 0.25, 0.001, 5);
    // La 2-distancia dentro de cada grupo es ~0.02, muy por debajo del máximo.
    assert.ok((r.raw) < (0.1));
    assert.ok(Math.abs((r.eps) - (r.raw)) < 1e-5);
    assert.equal(r.clamped, false);
    assert.equal(r.sampled, pts.length);
  });

test('recorta a [min, max] para que una ventana degenerada no lo lleve a un extremo', () => {
    const disperso = [0, 100, 200, 300, 400, 500];
    const r = autoEps(disperso, d, 2, 0.25, 0.22, 0.34);
    assert.equal(r.eps, 0.34);
    assert.equal(r.clamped, true);
  });

test('devuelve el mínimo cuando no hay puntos suficientes, sin lanzar', () => {
    assert.deepEqual(autoEps([1, 2], d, 5, 0.25, 0.22, 0.34), { eps: 0.22, raw: 0.22, clamped: true, sampled: 0 });
    assert.equal(autoEps([], d, 3, 0.25, 0.22, 0.34).eps, 0.22);
  });

test('es determinista: la misma entrada da el mismo eps', () => {
  const pts = [0, 0.1, 0.15, 0.2, 0.9, 1.0, 1.05, 1.1];
    const a = autoEps(pts, d, 3, 0.25, 0.05, 0.9);
    const b = autoEps(pts, d, 3, 0.25, 0.05, 0.9);
    assert.deepEqual(a, b);
  });

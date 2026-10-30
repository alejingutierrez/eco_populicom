// Prefijos de prompt caching del asesor (spec §5.5). Breakpoints explícitos.
// Regla: el prefijo es estable. Fechas, IDs de corrida y JSON sin orden no entran aquí.

import { createHash } from 'node:crypto';
import type { AdvisorContentBlock, AdvisorMessage, AdvisorTool } from './llm';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Huella del arreglo `tools`: cualquier cambio de orden o definición invalida la caché (spec §6.1). */
export function toolsFingerprint(tools: AdvisorTool[]): string {
  return createHash('sha256').update(JSON.stringify(tools)).digest('hex');
}

/** Falla si el texto del prefijo trae un UUID (proxy de ID de corrida). */
function assertStable(label: string, text: string): void {
  if (UUID.test(text)) throw new Error(`advisor: ${label} contiene un UUID; no va en el prefijo cacheado`);
}

/**
 * Familia A · con herramientas (camino 1, ronda 0).
 * Orden: tools (fijo) → constitución → manual. BP1 al final del manual (1 h).
 * El BP2 (último bloque de cada turno, 5 min) lo pone `withTurnBreakpoint`.
 */
export function buildFamilyASystem(opts: { constitution: string; manual: string }): AdvisorContentBlock[] {
  assertStable('constitución', opts.constitution);
  assertStable('manual', opts.manual);
  return [
    { type: 'text', text: opts.constitution },
    { type: 'text', text: opts.manual, cache_control: { type: 'ephemeral', ttl: '1h' } },
  ];
}

/**
 * Familia B · asientos (rondas 1 a 5, panel, contención).
 * constitución → manual (BP1, 1 h) → hoja de hechos (BP2, 5 min).
 * El rol del asiento va después del prefijo, en el turno del usuario.
 */
export function buildFamilyBSystem(opts: { constitution: string; manual: string; factSheet: string; roundContext?: string }): AdvisorContentBlock[] {
  assertStable('constitución', opts.constitution);
  assertStable('manual', opts.manual);
  assertStable('hoja de hechos', opts.factSheet);
  const blocks: AdvisorContentBlock[] = [
    { type: 'text', text: opts.constitution },
    { type: 'text', text: opts.manual, cache_control: { type: 'ephemeral', ttl: '1h' } },
    { type: 'text', text: opts.factSheet, cache_control: { type: 'ephemeral', ttl: '5m' } },
  ];
  // BP3 (ronda 4): «caminos + ataques» al final, para que los seis asientos de la réplica lo compartan.
  if (opts.roundContext) {
    assertStable('contexto de la ronda', opts.roundContext);
    blocks.push({ type: 'text', text: opts.roundContext, cache_control: { type: 'ephemeral', ttl: '5m' } });
  }
  return blocks;
}

/**
 * Pone el breakpoint de 5 min en el último bloque del último mensaje de usuario
 * (o del último mensaje). Devuelve copias: no edita turnos anteriores (append-only).
 */
export function withTurnBreakpoint(messages: AdvisorMessage[]): AdvisorMessage[] {
  if (messages.length === 0) return messages;
  const idx = messages.length - 1;
  const last = messages[idx];
  const blocks: AdvisorContentBlock[] =
    typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : [...last.content];
  if (blocks.length === 0) return messages;
  const tail = blocks[blocks.length - 1];
  blocks[blocks.length - 1] = { ...tail, cache_control: { type: 'ephemeral', ttl: '5m' } } as AdvisorContentBlock;
  return [...messages.slice(0, idx), { ...last, content: blocks }];
}

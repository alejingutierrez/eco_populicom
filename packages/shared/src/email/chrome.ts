/**
 * Identidad compartida de TODOS los correos ECO: el tipo de correo
 * (EmailKind) con su etiqueta, tag de asunto y nota de pie; el asunto
 * estándar `[Tag] SIGLAS · detalle`; el mapeo `template_key` → tipo del
 * histórico de envíos; y dos utilidades de texto.
 *
 * El CROMO (paleta, documento, piezas de layout) vive en `instrument.ts`
 * desde el rediseño «Instrumento» (sep 2026). Este archivo tenía también la
 * paleta de marca azul/amarillo, el documento con barra y badge de color y
 * los tiles de indicador; se retiraron cuando los seis correos migraron.
 */

import type { DeltaDisplay, MetricDisplay } from '../format/metrics-display';

// ------------------------------------------------------------
// Tipo de correo — la señal de identidad que pidió el cliente
// ------------------------------------------------------------

export type EmailKind = 'daily' | 'weekly' | 'alert' | 'crisis' | 'appointment' | 'welcome';

export interface EmailKindMeta {
  /** Texto del badge del header, p.ej. "Reporte diario". */
  label: string;
  /** Prefijo del asunto, p.ej. "Diario" → "[Diario] DDEC · …". */
  subjectTag: string;
  /** Línea del footer que explica por qué llega este correo. */
  footerNote: string;
}

export const EMAIL_KIND_META: Record<EmailKind, EmailKindMeta> = {
  daily: {
    label: 'Reporte diario',
    subjectTag: 'Diario',
    footerNote: 'Recibes el reporte diario cada mañana con la conversación de los últimos 7 días. Los conteos cubren menciones pertinentes (se excluye la pertinencia baja) — la misma base que el dashboard.',
  },
  weekly: {
    label: 'Reporte semanal',
    subjectTag: 'Semanal',
    footerNote: 'Recibes el reporte semanal los viernes con la comparación de la semana vs la anterior. Los conteos cubren menciones pertinentes (se excluye la pertinencia baja) — la misma base que el dashboard.',
  },
  alert: {
    label: 'Alerta',
    subjectTag: 'Alerta',
    footerNote: 'Recibes esta alerta automática porque estás en la lista de notificación de tu agencia.',
  },
  crisis: {
    label: 'Alerta de crisis',
    subjectTag: 'Crisis',
    footerNote: 'Recibes esta alerta automática porque estás en la lista de notificación de crisis de tu agencia.',
  },
  appointment: {
    label: 'Nombramiento',
    subjectTag: 'Nombramiento',
    footerNote: 'Recibes este correo una sola vez, cuando se registra un nombramiento nuevo en una agencia monitoreada. El periodo cubre desde el nombramiento hasta hoy, así que incluye el día en curso (parcial) — a diferencia del diario y el semanal, que cierran en ayer.',
  },
  welcome: {
    label: 'Bienvenida',
    subjectTag: 'Bienvenida',
    footerNote: 'Recibes este correo una sola vez, porque acabas de activar tu cuenta en ECO. Si crees que es un error, respóndelo y lo atendemos.',
  },
};

/** Asunto estándar: "[Tag] SIGLAS · detalle". El tag SIEMPRE va primero para
 *  que el tipo de correo sea lo primero que se lee en el inbox. */
export function buildSubject(tag: string, agencyShort: string, detail: string): string {
  return `[${tag}] ${agencyShort} · ${detail}`;
}

/**
 * `report_send_log.template_key` → tipo de correo. ÚNICA fuente de verdad del
 * mapeo, compartida por el lambda que escribe el log y por la UI de admin que
 * lo lee.
 *
 * Existe porque la tabla de historial resolvía el tipo con un ternario
 * (`key === 'weekly-comparison-v1' ? Semanal : Diario`), así que **cualquier
 * tipo nuevo se etiquetaba como Diario en silencio** — los dos envíos de
 * nombramiento del 12-ago aparecían como reportes diarios. Un mapa explícito
 * convierte ese fallo silencioso en un `null` que la UI puede mostrar como
 * desconocido.
 */
export const TEMPLATE_KEY_TO_KIND: Record<string, EmailKind> = {
  'daily-sentiment-summary': 'daily',
  /** Legado: nombraba "semanal" a un correo que en realidad es diario. */
  'weekly-sentiment-summary': 'daily',
  'weekly-comparison-v1': 'weekly',
  'appointment-summary-v1': 'appointment',
  'welcome-v1': 'welcome',
};

/** Tipo de correo de un template_key, o null si no está registrado. */
export function kindFromTemplateKey(key: string | null | undefined): EmailKind | null {
  if (!key) return null;
  return TEMPLATE_KEY_TO_KIND[key] ?? null;
}

// ------------------------------------------------------------
// Helpers de texto/números
// ------------------------------------------------------------

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function fmtInt(n: number): string {
  return n.toLocaleString('es-PR');
}

// ------------------------------------------------------------
// Métrica formateada para email — display numérico + delta opcional
// ------------------------------------------------------------

export interface EmailMetric {
  display: MetricDisplay;
  /** Delta vs el período previo de igual duración, ya formateado. */
  delta?: DeltaDisplay | null;
  /** Hint alternativo cuando no hay delta (aclaración de escala/fuente). */
  hint?: string;
}

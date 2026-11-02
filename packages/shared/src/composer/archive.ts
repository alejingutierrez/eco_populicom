/**
 * Archivo de cada envío (spec 5.2 y 10.1 etapa 6). El motor arma la fila;
 * escribirla es del caller (el lambda la inserta en `report_send_log` junto
 * al resto del envío) o de un `ComposerArchiveSink` inyectado.
 */
import { buildSubject } from '../email/chrome';
import type { FactPackage } from './facts';
import type { RoleCallRecord } from './roles/call';
import type { SafetyNetLogEntry } from './safety-net';
import type { AnnotatedSampleSet, CodeDefect, ComposerInput, Draft, Fact, Findings, QaDefect, RoleModels } from './types';

export interface Composition {
  composerVersion: string;
  promptVersion: string;
  vetoedVersion: string;
  profile: string;
  dryRun: boolean;
  agency: ComposerInput['agency'];
  window: ComposerInput['window'];
  startedAt: string;
  finishedAt: string;
  facts: Record<string, Fact>;
  prevTotalsSource: FactPackage['prevTotalsSource'] | null;
  samples: AnnotatedSampleSet | null;
  findings: Findings | null;
  draft1Raw: Draft | null;
  draft1: Draft | null;
  qa: { agentRan: boolean; agent: QaDefect[]; code: CodeDefect[] };
  correctorRan: boolean;
  draft2Raw: Draft | null;
  draft2: Draft | null;
  final: Draft;
  safetyNetLog: SafetyNetLogEntry[];
  /** Defectos duros que quedan en el texto final (debe ser vacío). */
  residualCodeProblems: CodeDefect[];
  /** Avisos blandos que quedan (p. ej. titular de más de 16 palabras). */
  warnings: CodeDefect[];
  models: Partial<RoleModels>;
  calls: RoleCallRecord[];
  stageSeconds: Record<string, number>;
  /** true si alguna etapa cayó a su alternativa (sin analista, sin QA, texto determinista…). */
  degraded: boolean;
  errors: string[];
}

export interface SendLogArchiveRow {
  subject: string | null;
  headline: string;
  composition: Composition;
  composer_version: string;
}

export interface ComposerArchiveSink {
  write(row: SendLogArchiveRow): Promise<void>;
}

/**
 * Asunto tipado: `[Diario] SIGLAS · <titular validado>` (spec 9.1 regla 7),
 * con el mismo `buildSubject` del chrome de correos. Null si el perfil no es
 * un correo.
 */
export function composeSubject(tag: string | null, shortName: string | null | undefined, headline: string): string | null {
  if (!tag) return null;
  const sig = (shortName ?? '').trim();
  return sig ? buildSubject(tag, sig, headline) : `[${tag}] ${headline}`;
}

export function toSendLogArchive(subject: string | null, composition: Composition): SendLogArchiveRow {
  return { subject, headline: composition.final.headline, composition, composer_version: composition.composerVersion };
}

/**
 * eco-weekly-report Lambda — envía los REPORTES por correo (diario y semanal).
 *
 * (El nombre del lambda es histórico; desde jul 2026 maneja DOS tipos de
 * correo. No se renombra el recurso para no recrear la función en CDK.)
 *
 * Tipos de correo:
 *  - DIARIO ("[Diario] …"): todos los días a la hora local configurada
 *    (report_configs.send_hour_local, default 6 AM). Ventana rolante de 7
 *    días cerrados terminando ayer.
 *  - SEMANAL ("[Semanal] …"): solo el día configurado
 *    (report_configs.weekly_send_dow, default 5 = viernes) a SU propia hora
 *    (weekly_send_hour_local, default 15 = 3:00 PM). Compara la semana
 *    cerrada (7 días terminando ayer) contra la anterior.
 *
 * Disparador 1 — EventBridge (cada hora, minuto 0): itera report_configs
 * activos, calcula la hora local de cada agencia según su timezone, y envía
 * si la hora coincide con send_hour_local (+ gate de día para el semanal).
 *
 * Disparador 2 — invocación manual/API (payload con agencySlug): envía
 * inmediatamente para esa agencia, ignorando hora y día. `reportType`
 * ('daily' | 'weekly', default 'daily') elige el correo. Se usa para
 * "Enviar prueba" desde el dashboard admin y para dryRun.
 *
 * Cada envío (o skip/fail) se registra en report_send_log; el semanal se
 * distingue por template_key = 'weekly-comparison-v1'.
 *
 * Motor de redacción (interpretación v1, WP-6): `report_configs.composer_mode`
 * por agencia (legacy | shadow | agentic; ver composer-mode.ts). Con `legacy`
 * (default) el correo sale exactamente como antes. Con los otros modos:
 *  - el barrido horario, 2 h antes de `send_hour_local`, invoca este mismo
 *    lambda de forma ASÍNCRONA con `{action:'compose', agencySlug}` por
 *    agencia; esa corrida compone y guarda en `report_compositions`;
 *  - el envío lee la composición guardada del periodo; si falta y quedan más
 *    de 420 s de ejecución, compone en el momento; si no, sale el legacy.
 *    Nunca se retiene un correo.
 */
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import {
  INSIGHTS_SYSTEM_PROMPT,
  buildSentimentInsightsPrompt,
  coerceBulletList,
  buildDailySummaryPrompt,
  buildWeeklySummaryPrompt,
  buildAppointmentSummaryPrompt,
  renderDailyReportHtml,
  renderWeeklySummaryHtml,
  renderAppointmentReportHtml,
  buildSentimentReport,
  buildSubject,
  closedWindowYmdInTZ,
  loadAgencyCoverage,
  reportWindowNow,
  type AgencyCoverage,
  ymdInTimeZone,
  hourInTimeZone,
  dowInTimeZone,
  addDaysYmd,
  formatPeriodLabel,
  formatShortDay,
  formatLongDay,
  formatDayLabel,
  formatUpdatedAtLabel,
  loadMetricsForWindow,
  formatMetric,
  formatDelta,
  formatVelocity,
  fetchOgImage,
  isArticlePageType,
  isGenericImageUrl,
  validateImageUrl,
  type EmailMetric,
  type MentionSample,
  type WeeklyAggregates,
  type DailyReportRenderData,
  type WeeklySummaryRenderData,
  type AppointmentRenderData,
  type PgClientLike,
  type SentimentReport,
  type WindowMetrics,
  buildDailyMethodologyNote,
  FACT_MIN_DELTA_BASE,
  type Composition,
  type ComposerLlm,
  type DailyInterpretation,
} from '@eco/shared';
import { createBedrockComposerLlm } from '@eco/shared/src/composer/bedrock-llm';
import {
  composeDeadlineMs,
  isComposeAheadDue,
  normalizeComposerMode,
  planDailyText,
  resolveComposerMode,
  type ComposerMode,
} from './composer-mode';
import {
  buildDailyComposerInput,
  composeWithDeadline,
  draftToDailyText,
  evaluateStoredComposition,
  isSendableComposition,
  type DailyComposerInputResult,
  type DeliveryRecord,
  type StoredEvaluation,
} from './daily-composer';
import { compositionStatus, loadStoredComposition, saveComposition, type StoredComposition } from './compositions-store';

const bedrock = new BedrockRuntimeClient({});
const sm = new SecretsManagerClient({});
const ses = new SESClient({});
const lambdaClient = new LambdaClient({});

/** Cliente LLM del motor (mismo cliente Bedrock del lambda; modelos por rol en el motor). */
let composerLlm: ComposerLlm | null = null;
function getComposerLlm(): ComposerLlm {
  if (!composerLlm) composerLlm = createBedrockComposerLlm(bedrock);
  return composerLlm;
}

const DB_SECRET_ARN = process.env.DB_SECRET_ARN!;
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-opus-4-6-v1';
const BEDROCK_FALLBACK_MODEL_ID = process.env.BEDROCK_FALLBACK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6';
const DASHBOARD_BASE_URL = process.env.DASHBOARD_BASE_URL ?? 'https://citizenecho.com';

/** template_key con el que el SEMANAL se registra en report_send_log. El
 *  diario usa el template_key de la config ('daily-sentiment-summary'). */
const WEEKLY_TEMPLATE_KEY = 'weekly-comparison-v1';

/** template_key del correo de NOMBRAMIENTO en report_send_log. */
const APPOINTMENT_TEMPLATE_KEY = 'appointment-summary-v1';

/**
 * TZ para todo cálculo de "día calendario" del reporte. Puerto Rico es AST
 * (UTC-4) sin DST. La config por agencia (report_configs.timezone) sigue
 * siendo configurable; esta constante es solo el default usado cuando un
 * cálculo necesita "el día PR" sin pasar por la fila de config.
 */
const REPORT_TIMEZONE = 'America/Puerto_Rico';

let dbUrl: string | null = null;
let schemaEnsured = false;

/** Timeout del lambda (CDK: 900 s). Solo se usa si la invocación no trae `context`. */
const DEFAULT_TIMEOUT_MS = 900_000;

/** Lo que el handler sabe del tiempo de ejecución que le queda. */
interface RunClock {
  remainingMs: () => number;
}

/** Contexto mínimo de Lambda que usa el handler. */
interface LambdaContextLike {
  functionName?: string;
  getRemainingTimeInMillis?: () => number;
}

type ReportType = 'daily' | 'weekly' | 'appointment';

interface InvokePayload {
  /** Si se especifica, ejecuta solo para esa agencia e ignora hora/día (tests manuales). */
  agencySlug?: string;
  /** Tipo de correo a generar en invocación dirigida. Default: 'daily'. */
  reportType?: ReportType;
  /**
   * Nombramiento concreto a renderizar (solo con reportType='appointment').
   * Si se omite, se toma el más reciente de la agencia. En invocación dirigida
   * el correo se envía SIN estampar notified_at, para poder repetir la prueba.
   */
  appointmentId?: string;
  /** Override de destinatarios (solo si viene agencySlug). Si no, usa los de report_configs. */
  recipients?: string[];
  /** True = renderiza y devuelve HTML sin enviar y sin logear. */
  dryRun?: boolean;
  /** "scheduled" (default), "manual", "test" — se guarda en report_send_log.trigger. */
  trigger?: 'scheduled' | 'manual' | 'test';
  /** uuid del usuario que disparó (solo manual/test). */
  triggeredBy?: string;
  /**
   * `compose`: solo compone el diario de `agencySlug` y lo guarda en
   * report_compositions (la dispara el barrido 2 h antes del envío; también
   * manual). Sin `action`: el comportamiento de siempre.
   */
  action?: 'compose';
  /** Fuerza el modo del motor. SOLO con dryRun (un envío real usa report_configs). */
  composerMode?: ComposerMode;
  /** Instante «ahora» (ISO) para vistas previas. SOLO con dryRun. */
  asOf?: string;
}

interface RunResult {
  ok: boolean;
  agency?: string;
  reportType?: ReportType;
  status?: 'sent' | 'skipped' | 'failed' | 'no_recipients' | 'no_data' | 'compose_dispatched';
  sent?: number;
  messageId?: string;
  html?: string;
  subject?: string;
  error?: string;
  /** Motor de redacción (solo modos distintos de legacy). */
  composerMode?: ComposerMode;
  /** dryRun con motor: composición completa (con el bloque `delivery`). */
  composition?: Record<string, unknown> | null;
}

export const handler = async (
  event: InvokePayload = {},
  context?: LambdaContextLike,
): Promise<{ ok: boolean; runs?: RunResult[]; results?: RunResult[] } | RunResult | ComposeActionResult> => {
  const startedAt = Date.now();
  const clock: RunClock = {
    remainingMs: () => (typeof context?.getRemainingTimeInMillis === 'function'
      ? context.getRemainingTimeInMillis()
      : DEFAULT_TIMEOUT_MS - (Date.now() - startedAt)),
  };
  if (!dbUrl) dbUrl = await getDatabaseUrl();

  const pg = await import('pg');
  const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    if (!schemaEnsured) {
      await ensureReportsSchema(client);
      schemaEnsured = true;
    }

    // Modo: composición anticipada (la dispara el barrido horario, asíncrona).
    if (event.action === 'compose') {
      console.log(`[weekly-report] compose · agency=${event.agencySlug ?? '—'} · type=${event.reportType ?? 'daily'} · dryRun=${event.dryRun === true}`);
      return await runComposeAction(client, event, clock);
    }

    // Modo: invocación dirigida (manual/send-test desde UI)
    if (event.agencySlug) {
      console.log(`[weekly-report] targeted run · agency=${event.agencySlug} · type=${event.reportType ?? 'daily'} · dryRun=${event.dryRun === true}`);
      const result = await runForAgencyBySlug(client, event, clock);
      return result;
    }

    // Modo: scheduled (EventBridge cada hora). Itera configs activas y
    // decide cuáles corresponden a esta hora local (y, para el semanal,
    // a este día local).
    const nowUtc = new Date();
    console.log(`[weekly-report] scheduled sweep · now=${nowUtc.toISOString()}`);

    const configs = await client.query(
      `SELECT rc.agency_id, rc.send_hour_local, rc.timezone, rc.template_key,
              rc.recipients, rc.from_email, rc.from_name,
              rc.weekly_enabled, rc.weekly_send_dow, rc.weekly_send_hour_local,
              a.slug, a.name
         FROM report_configs rc
         JOIN agencies a ON a.id = rc.agency_id
        WHERE rc.is_active = true
          AND a.is_active = true`,
    );
    console.log(`[weekly-report] ${configs.rows.length} active configs`);
    // Modo del motor por agencia: consulta aparte para que una base sin la
    // columna (o cualquier fallo) deje a todas en legacy sin tumbar el barrido.
    const composerModes = await loadComposerModes(client);

    const runs: RunResult[] = [];
    for (const cfg of configs.rows) {
      const localHour = hourInTimeZone(nowUtc, cfg.timezone);
      const localDow = dowInTimeZone(nowUtc, cfg.timezone);
      const composerMode = composerModes.get(cfg.agency_id) ?? 'legacy';

      // Composición anticipada del diario: 2 h antes de send_hour_local, solo
      // con el motor encendido. Se dispara asíncrona (un lambda por agencia)
      // para no consumir el tiempo de este barrido.
      if (isComposeAheadDue(localHour, cfg.send_hour_local, composerMode)
        && Array.isArray(cfg.recipients) && cfg.recipients.length > 0) {
        runs.push(await dispatchComposeAhead(client, cfg, context));
      }

      // Diario: todos los días a send_hour_local. Semanal: SOLO el día
      // configurado (default viernes) a SU propia hora (default 15 = 3 PM),
      // independiente de la hora del diario.
      const dailyDue = localHour === cfg.send_hour_local;
      const weeklyDue = cfg.weekly_enabled === true
        && localDow === (cfg.weekly_send_dow ?? 5)
        && localHour === (cfg.weekly_send_hour_local ?? 15);

      if (!dailyDue && !weeklyDue) {
        console.log(`[weekly-report] skip ${cfg.slug} · localHour=${localHour}/dow=${localDow} vs daily=${cfg.send_hour_local} weekly=${cfg.weekly_send_hour_local ?? 15}@dow${cfg.weekly_send_dow ?? 5} (${cfg.timezone})`);
        continue;
      }
      if (!Array.isArray(cfg.recipients) || cfg.recipients.length === 0) {
        console.warn(`[weekly-report] ${cfg.slug} — no recipients configured`);
        await logSend(client, cfg.agency_id, {
          recipients: [], fromEmail: cfg.from_email, templateKey: cfg.template_key,
          trigger: 'scheduled', status: 'no_recipients',
        });
        runs.push({ ok: false, agency: cfg.slug, status: 'no_recipients' });
        continue;
      }
      const inputs: AgencyRunInputs = {
        agencyId: cfg.agency_id,
        agencySlug: cfg.slug,
        agencyName: cfg.name,
        recipients: cfg.recipients as string[],
        fromEmail: cfg.from_email,
        fromName: cfg.from_name,
        templateKey: cfg.template_key,
        trigger: 'scheduled',
        triggeredBy: null,
      };

      // Agencia que entra por exportes (DF): el reporte sale solo si llegó un
      // exporte desde el último envío de ese tipo. Sin exporte nuevo, la
      // ventana sería la misma o tendría días sin cargar (que contaban como
      // 0: el Diario del 18-oct de DF reportó 271 menciones de 382).
      const coverage = await loadAgencyCoverage(client as PgClientLike, cfg.agency_id);
      for (const [due, type, key] of [
        [dailyDue, 'daily', cfg.template_key],
        [weeklyDue, 'weekly', WEEKLY_TEMPLATE_KEY],
      ] as Array<[boolean, ReportType, string]>) {
        if (!due) continue;
        if (coverage.importFed && !(await hasImportSinceLastSend(client, cfg.agency_id, key, coverage))) {
          console.log(`[weekly-report] skip ${cfg.slug} (${type}) · sin exporte nuevo desde el último envío (último exporte ${coverage.lastIngestedAt?.toISOString() ?? '—'})`);
          runs.push({ ok: true, agency: cfg.slug, reportType: type, status: 'skipped' });
          continue;
        }
        runs.push(await runForAgency(client, inputs, type, null, { mode: type === 'daily' ? composerMode : 'legacy', dryRun: false, clock }));
      }
    }

    // Nombramientos pendientes: NO dependen de la hora ni de report_configs
    // (un cambio de titular no espera a las 6 AM), así que se evalúan en cada
    // barrido y salen en el primer tick tras el alta.
    runs.push(...await dispatchPendingAppointments(client));

    return { ok: true, runs };
  } finally {
    await client.end();
  }
};

// ============================================================
// Targeted run (manual from UI)
// ============================================================

async function runForAgencyBySlug(client: any, event: InvokePayload, clock: RunClock): Promise<RunResult> {
  const agencyRow = await client.query(
    `SELECT a.id, a.slug, a.name,
            rc.recipients, rc.from_email, rc.from_name, rc.template_key
       FROM agencies a
       LEFT JOIN report_configs rc ON rc.agency_id = a.id
      WHERE a.slug = $1 AND a.is_active = true
      LIMIT 1`,
    [event.agencySlug],
  );
  if (!agencyRow.rows.length) {
    return { ok: false, error: `agency '${event.agencySlug}' not found` };
  }
  const a = agencyRow.rows[0];
  const reportType: ReportType = event.reportType === 'weekly' ? 'weekly'
    : event.reportType === 'appointment' ? 'appointment'
    : 'daily';

  // El correo de nombramiento necesita SU fila; sin nombramiento registrado no
  // hay nada que renderizar (y no tiene sentido inventar uno para la prueba).
  let appointment: AppointmentRow | null = null;
  if (reportType === 'appointment') {
    appointment = await loadAppointment(client, a.id, event.appointmentId);
    if (!appointment) {
      return {
        ok: false, agency: a.slug, reportType, status: 'no_data',
        error: event.appointmentId
          ? `appointment '${event.appointmentId}' not found for agency '${a.slug}'`
          : `agency '${a.slug}' has no rows in agency_appointments`,
      };
    }
  }

  const recipients = event.recipients
    ?? (reportType === 'appointment' ? await resolveAppointmentRecipients(client, appointment!) : null)
    ?? (a.recipients as string[] | null)
    ?? [];
  const fromEmail = a.from_email ?? 'agutierrez@populicom.com';
  const fromName = a.from_name ?? 'ECO Radar';
  const templateKey = a.template_key ?? 'daily-sentiment-summary';
  const trigger = event.trigger ?? 'manual';

  // Motor de redacción: solo el diario. El modo sale de report_configs; en
  // dryRun el payload puede forzarlo (`composerMode`) sin tocar la base.
  const dryRun = event.dryRun === true;
  const composerMode: ComposerMode = reportType === 'daily'
    ? resolveComposerMode(await loadComposerMode(client, a.id), event.composerMode, dryRun)
    : 'legacy';
  const asOf = dryRun && event.asOf ? new Date(event.asOf) : null;
  const daily: DailyBuildOptions = {
    mode: composerMode,
    dryRun,
    clock,
    nowUtc: asOf && !Number.isNaN(asOf.getTime()) ? asOf : undefined,
  };

  if (dryRun) {
    const built = await buildEmail(client, { id: a.id, slug: a.slug, name: a.name }, reportType, appointment, daily);
    if (composerMode === 'legacy') {
      return { ok: true, agency: a.slug, reportType, html: built.html, subject: built.subject, status: 'sent' };
    }
    return {
      ok: true, agency: a.slug, reportType, html: built.html, subject: built.subject, status: 'sent',
      composerMode, composition: built.archive?.composition ?? null,
    };
  }

  if (recipients.length === 0) {
    await logSend(client, a.id, {
      recipients: [], fromEmail, templateKey, trigger, status: 'no_recipients',
      triggeredBy: event.triggeredBy,
    });
    return { ok: false, agency: a.slug, reportType, status: 'no_recipients', error: 'no recipients configured' };
  }

  return runForAgency(client, {
    agencyId: a.id,
    agencySlug: a.slug,
    agencyName: a.name,
    recipients,
    fromEmail,
    fromName,
    templateKey,
    trigger,
    triggeredBy: event.triggeredBy ?? null,
  }, reportType, appointment, daily);
}

// ============================================================
// Motor de redacción: modo por agencia y composición anticipada
// ============================================================

/** `composer_mode` de una agencia. Cualquier fallo (columna ausente, sin fila) → legacy. */
async function loadComposerMode(client: any, agencyId: string): Promise<ComposerMode> {
  try {
    const r = await client.query(`SELECT composer_mode FROM report_configs WHERE agency_id = $1 LIMIT 1`, [agencyId]);
    return normalizeComposerMode(r.rows[0]?.composer_mode);
  } catch (err) {
    console.warn('[weekly-report] composer_mode no disponible; se usa legacy:', (err as Error)?.message ?? err);
    return 'legacy';
  }
}

/** `composer_mode` de todas las configs activas (agency_id → modo). Fallo → mapa vacío (todas legacy). */
async function loadComposerModes(client: any): Promise<Map<string, ComposerMode>> {
  const out = new Map<string, ComposerMode>();
  try {
    const r = await client.query(`SELECT agency_id, composer_mode FROM report_configs WHERE is_active = true`);
    for (const row of r.rows) out.set(row.agency_id, normalizeComposerMode(row.composer_mode));
  } catch (err) {
    console.warn('[weekly-report] composer_mode no disponible; todas las agencias en legacy:', (err as Error)?.message ?? err);
  }
  return out;
}

/**
 * Invoca ESTE lambda de forma asíncrona (InvocationType Event) para componer
 * el diario de una agencia. Nunca lanza.
 */
async function invokeComposeAsync(agencySlug: string, functionName?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await lambdaClient.send(new InvokeCommand({
      FunctionName: functionName || process.env.AWS_LAMBDA_FUNCTION_NAME || 'eco-weekly-report',
      InvocationType: 'Event',
      Payload: new TextEncoder().encode(JSON.stringify({ action: 'compose', agencySlug, reportType: 'daily', trigger: 'scheduled' })),
    }));
    return { ok: true };
  } catch (err) {
    const error = String((err as Error)?.message ?? err);
    console.warn(`[weekly-report] no se pudo invocar la composición de ${agencySlug}: ${error}`);
    return { ok: false, error };
  }
}

/**
 * Composición anticipada desde el barrido: una invocación asíncrona por
 * agencia. Una agencia por exportes (DF) sin exporte nuevo no tendrá envío,
 * así que no se compone.
 */
async function dispatchComposeAhead(client: any, cfg: any, context?: LambdaContextLike): Promise<RunResult> {
  try {
    const coverage = await loadAgencyCoverage(client as PgClientLike, cfg.agency_id);
    if (coverage.importFed && !(await hasImportSinceLastSend(client, cfg.agency_id, cfg.template_key, coverage))) {
      console.log(`[weekly-report] compose ${cfg.slug} · sin exporte nuevo: no se compone`);
      return { ok: true, agency: cfg.slug, reportType: 'daily', status: 'skipped', error: 'compose: sin exporte nuevo desde el último envío' };
    }
  } catch (err) {
    console.warn(`[weekly-report] compose ${cfg.slug} · cobertura no disponible, se compone igual:`, (err as Error)?.message ?? err);
  }
  const r = await invokeComposeAsync(cfg.slug, context?.functionName);
  console.log(`[weekly-report] compose ${cfg.slug} · ${r.ok ? 'invocación asíncrona enviada' : `falló: ${r.error}`}`);
  return { ok: r.ok, agency: cfg.slug, reportType: 'daily', status: r.ok ? 'compose_dispatched' : 'failed', ...(r.error ? { error: r.error } : {}) };
}

interface ComposeActionResult {
  ok: boolean;
  action: 'compose';
  agency?: string;
  reportType?: ReportType;
  status: 'composed' | 'degraded' | 'timeout' | 'no_data' | 'failed' | 'unsupported';
  periodEnd?: string;
  saved?: boolean;
  seconds?: number;
  /** Llamadas al modelo (intentos incluidos) por rol. */
  bedrockCalls?: number;
  headline?: string;
  error?: string;
  /** Solo en dryRun: la composición completa. */
  composition?: Composition;
}

/**
 * Acción `compose`: compone el diario de una agencia para la ventana que
 * enviaría ahora y lo guarda en report_compositions (dryRun: no guarda y
 * devuelve la composición). NUNCA lanza: una invocación asíncrona que falla
 * se reintenta sola (2 veces) y cada reintento gastaría el motor otra vez.
 */
async function runComposeAction(client: any, event: InvokePayload, clock: RunClock): Promise<ComposeActionResult> {
  const reportType: ReportType = event.reportType ?? 'daily';
  if (reportType !== 'daily') {
    return { ok: false, action: 'compose', reportType, status: 'unsupported', error: 'la composición anticipada existe solo para el diario (el semanal llega con WP-7)' };
  }
  if (!event.agencySlug) return { ok: false, action: 'compose', reportType, status: 'failed', error: 'agencySlug requerido' };
  const dryRun = event.dryRun === true;
  try {
    const r = await client.query(`SELECT id, slug, name FROM agencies WHERE slug = $1 AND is_active = true LIMIT 1`, [event.agencySlug]);
    const a = r.rows[0];
    if (!a) return { ok: false, action: 'compose', reportType, status: 'failed', error: `agency '${event.agencySlug}' not found` };
    const asOf = dryRun && event.asOf ? new Date(event.asOf) : null;
    const nowUtc = asOf && !Number.isNaN(asOf.getTime()) ? asOf : new Date();
    const coverage = await loadAgencyCoverage(client as PgClientLike, a.id);
    const win = closedWindowYmdInTZ(7, reportWindowNow(coverage, nowUtc), REPORT_TIMEZONE);
    const w = { startYmd: win.startYmd, endYmd: win.endYmd, prevStartYmd: win.prevStartYmd, prevEndYmd: win.prevEndYmd };
    const report = await buildSentimentReport(client as PgClientLike, a.id, w.startYmd, w.endYmd, w.prevStartYmd, w.prevEndYmd);
    if (report.totals.total === 0) {
      return { ok: true, action: 'compose', agency: a.slug, reportType, status: 'no_data', periodEnd: w.endYmd };
    }
    const input = await buildDailyComposerInput(client, { id: a.id, slug: a.slug, name: a.name, shortName: agencyShortName(a.slug) }, w, report);
    const timed = await composeWithDeadline(input.input, {
      llm: getComposerLlm(),
      dryRun,
      deadlineMs: Math.max(0, clock.remainingMs() - 30_000),
      log: (m) => console.log(m),
    });
    if (!timed.result) {
      return { ok: false, action: 'compose', agency: a.slug, reportType, status: 'timeout', periodEnd: w.endYmd, seconds: timed.seconds };
    }
    const composition = { ...timed.result.composition, adapter: { parentStats: input.parentStats, contextError: input.contextError } } as Composition;
    const status = compositionStatus(composition);
    const saved = dryRun ? false : await saveComposition(client, { agencyId: a.id, reportType: 'daily', periodEnd: w.endYmd, composition, status });
    const bedrockCalls = composition.calls.reduce((n, c) => n + c.attempts, 0);
    console.log(`[weekly-report] compose ${a.slug} ${w.endYmd} · ${status} · ${timed.seconds}s · ${bedrockCalls} llamadas · guardada=${saved}`);
    return {
      ok: status === 'complete',
      action: 'compose',
      agency: a.slug,
      reportType,
      status: status === 'complete' ? 'composed' : 'degraded',
      periodEnd: w.endYmd,
      saved,
      seconds: timed.seconds,
      bedrockCalls,
      headline: timed.result.final.headline,
      ...(dryRun ? { composition } : {}),
    };
  } catch (err) {
    console.error('[weekly-report] compose FAILED:', err);
    return { ok: false, action: 'compose', agency: event.agencySlug, reportType, status: 'failed', error: String((err as Error)?.message ?? err) };
  }
}

// ============================================================
// Full per-agency run (DB → Bedrock → render → SES → log)
// ============================================================

interface AgencyRunInputs {
  agencyId: string;
  agencySlug: string;
  agencyName: string;
  recipients: string[];
  fromEmail: string;
  fromName: string;
  templateKey: string;
  trigger: 'scheduled' | 'manual' | 'test';
  triggeredBy: string | null;
}

async function runForAgency(
  client: any,
  i: AgencyRunInputs,
  reportType: ReportType,
  appointment: AppointmentRow | null = null,
  daily: DailyBuildOptions = LEGACY_DAILY,
): Promise<RunResult> {
  const logTemplateKey = reportType === 'weekly' ? WEEKLY_TEMPLATE_KEY
    : reportType === 'appointment' ? APPOINTMENT_TEMPLATE_KEY
    : i.templateKey;
  try {
    const built = await buildEmail(client, {
      id: i.agencyId, slug: i.agencySlug, name: i.agencyName,
    }, reportType, appointment, daily);

    if (!built.hasData) {
      console.warn(`[weekly-report] ${i.agencySlug} (${reportType}) — no mentions in period, skipping send`);
      await logSend(client, i.agencyId, {
        recipients: i.recipients, fromEmail: i.fromEmail, templateKey: logTemplateKey,
        trigger: i.trigger, status: 'no_data', stats: built.stats, triggeredBy: i.triggeredBy ?? undefined,
      });
      return { ok: false, agency: i.agencySlug, reportType, status: 'no_data' };
    }

    // Enviar por destinatario individual: en SES sandbox, una dirección no
    // verificada tumba el mensaje entero si va en TO compartido. Individual
    // permite que los verificados reciban aunque otros fallen.
    const sent: string[] = [];
    const failed: { email: string; error: string }[] = [];
    let firstMessageId: string | undefined;
    for (const recipient of i.recipients) {
      try {
        const result = await ses.send(new SendEmailCommand({
          Source: `${i.fromName} <${i.fromEmail}>`,
          Destination: { ToAddresses: [recipient] },
          Message: {
            Subject: { Data: built.subject, Charset: 'UTF-8' },
            Body: { Html: { Data: built.html, Charset: 'UTF-8' } },
          },
        }));
        sent.push(recipient);
        if (!firstMessageId) firstMessageId = result.MessageId;
        console.log(`[weekly-report] ${i.agencySlug} (${reportType}) sent to=${recipient} messageId=${result.MessageId}`);
      } catch (err: any) {
        failed.push({ email: recipient, error: String(err?.message ?? err) });
        console.warn(`[weekly-report] ${i.agencySlug} (${reportType}) SKIPPED ${recipient}: ${err?.message ?? err}`);
      }
    }

    const status = sent.length > 0 ? 'sent' : 'failed';
    await logSend(client, i.agencyId, {
      recipients: sent, fromEmail: i.fromEmail, templateKey: logTemplateKey,
      trigger: i.trigger, status, messageId: firstMessageId,
      error: failed.length > 0 ? `partial: ${failed.map((f) => f.email).join(',')}` : undefined,
      stats: built.stats, triggeredBy: i.triggeredBy ?? undefined,
      // Solo con el motor (shadow/agentic): asunto, titular y composición enviados.
      archive: built.archive,
    });
    return {
      ok: sent.length > 0,
      agency: i.agencySlug,
      reportType,
      status,
      sent: sent.length,
      messageId: firstMessageId,
      ...(failed.length > 0 && { error: `${failed.length} recipient(s) failed: ${failed.map((f) => f.email).join(', ')}` }),
    };
  } catch (err: any) {
    console.error(`[weekly-report] ${i.agencySlug} (${reportType}) FAILED:`, err);
    await logSend(client, i.agencyId, {
      recipients: i.recipients, fromEmail: i.fromEmail, templateKey: logTemplateKey,
      trigger: i.trigger, status: 'failed', error: String(err?.message ?? err),
      triggeredBy: i.triggeredBy ?? undefined,
    });
    return { ok: false, agency: i.agencySlug, reportType, status: 'failed', error: String(err?.message ?? err) };
  }
}

// ============================================================
// Build email (dispatch por tipo)
// ============================================================

interface BuiltEmail {
  html: string;
  subject: string;
  stats: { negative: number; neutral: number; positive: number; total: number };
  /** false → no se envía (status no_data). */
  hasData: boolean;
  /** Archivo del envío en report_send_log (solo con el motor; legacy = undefined). */
  archive?: SendArchive;
}

/** Columnas de archivo de report_send_log (0013; spec 5.2). */
interface SendArchive {
  subject: string;
  headline: string;
  composition: Record<string, unknown>;
  composerVersion: string | null;
}

/** Cómo se arma el diario: modo del motor y reloj de la corrida. */
interface DailyBuildOptions {
  mode: ComposerMode;
  dryRun: boolean;
  clock?: RunClock;
  /** «Ahora» de la corrida (solo vistas previas con dryRun). */
  nowUtc?: Date;
}

const LEGACY_DAILY: DailyBuildOptions = { mode: 'legacy', dryRun: false };

async function buildEmail(
  client: any,
  agency: { id: string; slug: string; name: string },
  reportType: ReportType,
  appointment: AppointmentRow | null = null,
  daily: DailyBuildOptions = LEGACY_DAILY,
): Promise<BuiltEmail> {
  if (reportType === 'appointment') {
    if (!appointment) throw new Error('buildEmail: reportType=appointment requiere una fila de agency_appointments');
    return buildAppointmentEmail(client, agency, appointment);
  }
  return reportType === 'weekly'
    ? buildWeeklySummaryEmail(client, agency)
    : buildDailyReportEmail(client, agency, daily);
}

/** "lun 7 jul" — día de envío para el asunto del diario. */
function fullDayEs(ymd: string): string {
  const monthPart = formatShortDay(ymd).split(' ')[1] ?? '';
  return `${formatDayLabel(ymd)} ${monthPart}`.trim();
}

function fmtIntEs(n: number): string {
  return n.toLocaleString('es-PR');
}

/** "lunes 10 de agosto de 2026" — fecha del nombramiento en la ficha del correo. */
function fullDateEs(ymd: string): string {
  return `${formatLongDay(ymd)} de ${ymd.slice(0, 4)}`;
}

/** Días naturales entre dos YYYY-MM-DD, ambos inclusive (mismo día = 1). */
function daysBetweenInclusive(startYmd: string, endYmd: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const diff = Math.round((toUtc(endYmd) - toUtc(startYmd)) / 86_400_000);
  return Math.max(1, diff + 1);
}

// ============================================================
// REPORTE DIARIO — ventana rolante de 7 días cerrados
// ============================================================

async function buildDailyReportEmail(
  client: any,
  agency: { id: string; slug: string; name: string },
  opts: DailyBuildOptions = LEGACY_DAILY,
): Promise<BuiltEmail> {
  // Periodo: últimos 7 días CERRADOS (terminando AYER) en America/Puerto_Rico.
  // El correo se envía 6 AM PR; ayer ya es un día completo. No incluimos hoy
  // parcial — eso sesgaría el termómetro y el delta vs. los 7 días previos.
  // En una agencia importada la ventana termina en el último día que cubre
  // entero el último exporte (coverage.ts), nunca en días sin cargar.
  const nowUtc = opts.nowUtc ?? new Date();
  const coverage = await loadAgencyCoverage(client as PgClientLike, agency.id);
  const window = closedWindowYmdInTZ(7, reportWindowNow(coverage, nowUtc), REPORT_TIMEZONE);
  const { startYmd: startDate, endYmd: endDate, prevStartYmd: prevStartDate, prevEndYmd: prevEndDate } = window;

  // 1) Agregados base (totales, daily series, tabla de tópicos) — fuente de
  //    verdad compartida con /api/overview a través de @eco/shared.
  const sentimentReport = await buildSentimentReport(
    client as PgClientLike, agency.id, startDate, endDate, prevStartDate, prevEndDate,
  );

  // 1b) Métricas compuestas recalculadas sobre la ventana actual y la previa.
  //     Misma fuente y mismos formatos de delta que /api/eco-data (el dash).
  const [winCur, winPrev] = await Promise.all([
    loadMetricsForWindow(client as PgClientLike, agency.id, startDate, endDate),
    loadMetricsForWindow(client as PgClientLike, agency.id, prevStartDate, prevEndDate),
  ]);

  // 2) Contexto extra para el LLM (top tópicos, municipios, autores, fuentes,
  //    emociones). Estas queries son específicas del prompt — no las usa el
  //    dashboard.
  const aggregates = await buildAggregates(client, agency, startDate, endDate, sentimentReport);
  const samples = await loadSamples(client, agency.id, startDate, endDate);
  const todaySamples = await loadTodaySamples(client, agency.id, endDate);

  // Motor de redacción (shadow/agentic): camino aparte. Con legacy, lo que
  // sigue es exactamente el correo de siempre.
  if (opts.mode !== 'legacy') {
    return buildDailyEmailWithComposer(client, agency, opts, {
      nowUtc, coverage, window, sentimentReport, winCur, winPrev, aggregates, samples, todaySamples,
    });
  }

  const [insights, dailySummary, heroImage] = await Promise.all([
    generateInsights(aggregates, samples),
    generateDailySummary(aggregates, todaySamples, endDate),
    loadHeroImage(client, agency.id, endDate, endDate),
  ]);

  const renderData: DailyReportRenderData = {
    agencyName: agency.name,
    agencyShortName: agencyShortName(agency.slug),
    agencyKicker: `${agencyShortName(agency.slug)} · ${agency.name}`,
    periodLabel: formatPeriodLabel(startDate, endDate),
    updatedAtLabel: updatedLabelFor(coverage, nowUtc),
    totals: sentimentReport.totals,
    deltaVsPrev: sentimentReport.deltaVsPrev,
    // Deltas de sentimiento formateados con formatDelta (% vs período previo)
    // — el KPI del termómetro los consume para hablar el mismo vocabulario
    // que el dashboard (sube/baja/estable + magnitud con signo tipográfico).
    deltaDisplay: {
      negative: formatDelta(winCur.totals.negative, winPrev.totals.negative, { kind: 'percent', decimals: 0 }),
      neutral: formatDelta(winCur.totals.neutral, winPrev.totals.neutral, { kind: 'percent', decimals: 0 }),
      positive: formatDelta(winCur.totals.positive, winPrev.totals.positive, { kind: 'percent', decimals: 0 }),
    },
    // La tendencia se dibuja con tablas HTML desde dailySeries (sin PNG).
    dailySeries: sentimentReport.dailySeries,
    topicsTable: sentimentReport.topicsTable,
    insights,
    heroImage,
    dailySummary: {
      label: `Resumen del día · ${formatShortDay(endDate)}`,
      headline: dailySummary.headline,
      paragraph: dailySummary.paragraph,
      highlights: dailySummary.highlights,
    },
    // Indicadores compuestos NUMÉRICOS — mismos valores y mismos deltas que
    // el dashboard (paridad con /api/eco-data deltaDisplay).
    metrics: buildEmailMetrics(winCur, winPrev),
    // CTA del Bloque 2: enlaza a la landing de Overview del dashboard.
    overviewUrl: `${DASHBOARD_BASE_URL}/overview?agency=${agency.slug}`,
  };

  // El asunto cuenta el hecho del día (el titular del resumen); las cifras
  // viajan en la vista previa del inbox. Sin titular, el asunto de siempre.
  const todayYmd = ymdInTimeZone(nowUtc, REPORT_TIMEZONE);
  const headline = (dailySummary.headline ?? '').trim();
  const subject = buildSubject(
    'Diario',
    agencyShortName(agency.slug),
    headline || `${fullDayEs(todayYmd)} · ${fmtIntEs(sentimentReport.totals.total)} menciones`,
  );

  return {
    html: renderDailyReportHtml(renderData),
    subject,
    stats: sentimentReport.totals,
    hasData: sentimentReport.totals.total > 0,
  };
}

// ============================================================
// REPORTE DIARIO con el motor de redacción (shadow / agentic)
// ============================================================

/** Lo que `buildDailyReportEmail` ya cargó (mismas consultas que el legacy). */
interface DailyLoaded {
  nowUtc: Date;
  coverage: AgencyCoverage;
  window: { startYmd: string; endYmd: string; prevStartYmd: string; prevEndYmd: string };
  sentimentReport: SentimentReport;
  winCur: WindowMetrics;
  winPrev: WindowMetrics;
  aggregates: WeeklyAggregates;
  samples: { negative: MentionSample[]; neutral: MentionSample[]; positive: MentionSample[] };
  todaySamples: MentionSample[];
}

interface DailyText {
  headline: string;
  paragraph: string;
  highlights: string[];
  insights: { negative: string[]; neutral: string[]; positive: string[] };
}

/**
 * Delta de conteo con base mínima (spec 10.2): porcentaje solo si la base
 * previa es ≥ 30 menciones; si no, la diferencia en menciones (sin «+1400 %»).
 */
function minBaseCountDelta(cur: number, prev: number) {
  return prev >= FACT_MIN_DELTA_BASE
    ? formatDelta(cur, prev, { kind: 'percent', decimals: 0 })
    : formatDelta(cur, prev, { kind: 'absolute', decimals: 0 });
}

function pctOf(part: number, whole: number): number {
  return whole > 0 ? (100 * part) / whole : 0;
}

/**
 * Diario con `composer_mode` shadow o agentic. Decide de dónde sale el texto
 * (`planDailyText`), compone si hace falta, y arma el archivo del envío.
 *   - shadow: SIEMPRE envía el texto legacy; archiva la composición (guardada,
 *     o pide una asíncrona si falta). El HTML es el legacy.
 *   - agentic: envía el texto del motor (guardado o compuesto ahora); si no
 *     hay a tiempo o el redactor falló, envía el legacy y lo registra.
 * Nunca lanza por culpa del motor: cualquier error del motor cae al legacy.
 */
async function buildDailyEmailWithComposer(
  client: any,
  agency: { id: string; slug: string; name: string },
  opts: DailyBuildOptions,
  L: DailyLoaded,
): Promise<BuiltEmail> {
  const mode = opts.mode === 'agentic' ? 'agentic' : 'shadow';
  const clock: RunClock = opts.clock ?? { remainingMs: () => DEFAULT_TIMEOUT_MS };
  const short = agencyShortName(agency.slug);
  const cAgency = { id: agency.id, slug: agency.slug, name: agency.name, shortName: short };
  const w = L.window;
  const endDate = w.endYmd;
  const hasData = L.sentimentReport.totals.total > 0;
  const heroP = loadHeroImage(client, agency.id, endDate, endDate);
  const legacyText = async (): Promise<DailyText> => {
    const [insights, lede] = await Promise.all([
      generateInsights(L.aggregates, L.samples),
      generateDailySummary(L.aggregates, L.todaySamples, endDate),
    ]);
    return { headline: lede.headline, paragraph: lede.paragraph, highlights: lede.highlights, insights };
  };
  const errMsg = (err: unknown) => String((err as Error)?.message ?? err).slice(0, 500);

  const delivery: DeliveryRecord = { mode, sentText: 'legacy', compositionSource: 'none', reason: '' };
  let composition: Composition | null = null;
  let composerText: DailyText | null = null;
  let legacy: DailyText | null = null;
  let fresh: DailyComposerInputResult | null = null;

  if (!hasData) {
    // Sin menciones el correo no sale (no_data): no se gasta el motor.
    delivery.reason = 'sin menciones en el periodo';
  } else {
    // 1) Composición guardada del periodo (dryRun no lee ni escribe la tabla).
    let stored: StoredComposition | null = null;
    let evaluation: StoredEvaluation = { state: 'missing', final: null, changed: {}, reason: opts.dryRun ? 'dryRun compone de cero' : 'sin composición guardada' };
    if (!opts.dryRun) {
      stored = await loadStoredComposition(client, agency.id, 'daily', endDate);
      if (stored) {
        try {
          fresh = await buildDailyComposerInput(client, cAgency, w, L.sentimentReport, { withSamples: false });
          evaluation = evaluateStoredComposition(stored, fresh.input, w);
        } catch (err) {
          evaluation = { state: 'missing', final: null, changed: {}, reason: `no se pudo evaluar la composición guardada: ${errMsg(err)}` };
        }
      }
    }
    const plan = planDailyText({ mode, dryRun: opts.dryRun, stored: evaluation.state, remainingMs: clock.remainingMs() });
    delivery.reason = `${plan.reason} (${evaluation.reason})`;
    if (Object.keys(evaluation.changed).length) delivery.changedFacts = evaluation.changed;
    console.log(`[weekly-report] ${agency.slug} diario · motor=${mode} · plan=${plan.compose}/${plan.text} · ${delivery.reason}`);

    if (plan.compose === 'stored' && stored) {
      composition = stored.composition;
      delivery.compositionSource = evaluation.state === 'refreshable' ? 'stored_refreshed' : 'stored';
      if (plan.text === 'composer' && evaluation.final) composerText = draftToDailyText(evaluation.final);
    } else if (plan.compose === 'now') {
      // En shadow (solo dryRun llega aquí) el legacy corre en paralelo: es lo que se envía.
      const legacyP = plan.text === 'legacy' ? legacyText() : null;
      try {
        fresh = await buildDailyComposerInput(client, cAgency, w, L.sentimentReport);
        delivery.parentStats = fresh.parentStats;
        delivery.contextError = fresh.contextError;
        const timed = await composeWithDeadline(fresh.input, {
          llm: getComposerLlm(),
          dryRun: opts.dryRun,
          deadlineMs: composeDeadlineMs(clock.remainingMs()),
          log: (m) => console.log(m),
        });
        delivery.composeSeconds = timed.seconds;
        if (timed.result) {
          composition = timed.result.composition;
          delivery.compositionSource = 'composed_now';
          if (!opts.dryRun) {
            await saveComposition(client, { agencyId: agency.id, reportType: 'daily', periodEnd: endDate, composition: { ...composition, adapter: { parentStats: fresh.parentStats, contextError: fresh.contextError } } as Composition });
          }
          if (plan.text === 'composer') {
            if (isSendableComposition(composition)) composerText = draftToDailyText(timed.result.final);
            else delivery.reason += ' · el redactor no produjo texto: va el legacy';
          }
        } else {
          delivery.reason += ' · el motor no terminó a tiempo: va el legacy';
        }
      } catch (err) {
        delivery.errors = [errMsg(err)];
        delivery.reason += ' · error del motor: va el legacy';
        console.error(`[weekly-report] ${agency.slug} motor falló:`, err);
      }
      if (legacyP) legacy = await legacyP;
    } else if (plan.compose === 'async' && !opts.dryRun) {
      // Shadow sin composición guardada: se pide una aparte (no retrasa el envío).
      const r = await invokeComposeAsync(agency.slug);
      delivery.reason += r.ok ? ' · composición asíncrona pedida' : ` · no se pudo pedir la composición: ${r.error}`;
    }
  }
  if (!composerText && !legacy) legacy = await legacyText();
  const heroImage = await heroP;

  const useComposer = composerText !== null;
  const text: DailyText = (composerText ?? legacy)!;
  delivery.sentText = useComposer ? 'composer' : 'legacy';
  if (legacy) delivery.legacyText = legacy;

  // Indicadores del motor: con base mínima. Si el texto es el legacy, el
  // correo es el legacy entero (mismos deltas, sin chip ni nota).
  const deltaDisplay = useComposer
    ? {
        negative: minBaseCountDelta(L.winCur.totals.negative, L.winPrev.totals.negative),
        neutral: minBaseCountDelta(L.winCur.totals.neutral, L.winPrev.totals.neutral),
        positive: minBaseCountDelta(L.winCur.totals.positive, L.winPrev.totals.positive),
      }
    : {
        negative: formatDelta(L.winCur.totals.negative, L.winPrev.totals.negative, { kind: 'percent', decimals: 0 }),
        neutral: formatDelta(L.winCur.totals.neutral, L.winPrev.totals.neutral, { kind: 'percent', decimals: 0 }),
        positive: formatDelta(L.winCur.totals.positive, L.winPrev.totals.positive, { kind: 'percent', decimals: 0 }),
      };
  let interpretation: DailyInterpretation | undefined;
  if (useComposer) {
    const share = fresh?.share ?? null;
    // El chip solo dice algo si hubo comentarios en alguna de las dos semanas
    // (DF no tiene canales propios: «0 % · previos 0 %» es ruido).
    const hasComments = !!share && share.week.total > 0
      && (Math.round(pctOf(share.week.comments, share.week.total)) > 0 || Math.round(pctOf(share.prevWeek.comments, share.prevWeek.total)) > 0);
    interpretation = {
      insightsWindowLabel: 'últimos 7 días',
      composition: share && hasComments
        ? { weekPct: pctOf(share.week.comments, share.week.total), prevWeekPct: share.prevWeek.total > 0 ? pctOf(share.prevWeek.comments, share.prevWeek.total) : null }
        : null,
      methodologyNote: buildDailyMethodologyNote({
        periodLabel: formatPeriodLabel(w.startYmd, endDate),
        dayLabel: formatLongDay(endDate),
        minDeltaBase: FACT_MIN_DELTA_BASE,
      }),
    };
  }

  const renderData: DailyReportRenderData = {
    agencyName: agency.name,
    agencyShortName: short,
    agencyKicker: `${short} · ${agency.name}`,
    periodLabel: formatPeriodLabel(w.startYmd, endDate),
    updatedAtLabel: updatedLabelFor(L.coverage, L.nowUtc),
    totals: L.sentimentReport.totals,
    deltaVsPrev: L.sentimentReport.deltaVsPrev,
    deltaDisplay,
    dailySeries: L.sentimentReport.dailySeries,
    topicsTable: L.sentimentReport.topicsTable,
    insights: text.insights,
    heroImage,
    dailySummary: {
      label: `Resumen del día · ${formatShortDay(endDate)}`,
      headline: text.headline,
      paragraph: text.paragraph,
      highlights: text.highlights,
    },
    metrics: buildEmailMetrics(L.winCur, L.winPrev),
    overviewUrl: `${DASHBOARD_BASE_URL}/overview?agency=${agency.slug}`,
    ...(interpretation ? { interpretation } : {}),
  };

  const todayYmd = ymdInTimeZone(L.nowUtc, REPORT_TIMEZONE);
  const headline = (text.headline ?? '').trim();
  const subject = buildSubject(
    'Diario',
    short,
    headline || `${fullDayEs(todayYmd)} · ${fmtIntEs(L.sentimentReport.totals.total)} menciones`,
  );

  return {
    html: renderDailyReportHtml(renderData),
    subject,
    stats: L.sentimentReport.totals,
    hasData,
    archive: {
      subject,
      headline,
      composition: { ...((composition ?? {}) as Record<string, unknown>), delivery },
      composerVersion: composition?.composerVersion ?? null,
    },
  };
}

/**
 * Indicadores compuestos como EmailMetric (display numérico + delta), con
 * EXACTAMENTE la misma semántica de escala/suffix/invert que el deltaDisplay
 * de /api/eco-data — la fuente del dashboard.
 */
function buildEmailMetrics(cur: WindowMetrics, prev: WindowMetrics): NonNullable<DailyReportRenderData['metrics']> {
  return {
    crisis: {
      display: formatMetric('crisis', cur.crisisRiskScore),
      delta: formatDelta(
        cur.crisisRiskScore != null ? cur.crisisRiskScore * 100 : null,
        prev.crisisRiskScore != null ? prev.crisisRiskScore * 100 : null,
        { kind: 'absolute', decimals: 0, suffix: ' pts', invert: true },
      ),
    },
    bhi: {
      display: formatMetric('bhi', cur.brandHealthIndex),
      delta: formatDelta(
        cur.brandHealthIndex != null ? 1 + cur.brandHealthIndex * 9 : null,
        prev.brandHealthIndex != null ? 1 + prev.brandHealthIndex * 9 : null,
        { kind: 'absolute', decimals: 1, suffix: '' },
      ),
    },
    nss: {
      display: formatMetric('nss', cur.nss),
      delta: formatDelta(cur.nss, prev.nss, { kind: 'absolute', decimals: 1 }),
    },
    polarization: {
      display: formatMetric('polarization', cur.polarizationIndex),
      delta: formatDelta(cur.polarizationIndex, prev.polarizationIndex, { kind: 'absolute', decimals: 0, suffix: ' pts' }),
    },
    velocity: {
      // Velocidad = ritmo de la conversación: cambio % del VOLUMEN de menciones
      // vs período previo (no engagement social) para que no colapse a 0 en
      // periodos noticiosos. Ya es un "cambio %" — no lleva delta adicional.
      display: formatVelocity(cur.totals.total, prev.totals.total),
      hint: 'volumen de menciones vs período previo',
    },
    engagementRate: {
      display: formatMetric('engagementRate', cur.engagementRate),
      delta: formatDelta(cur.engagementRate, prev.engagementRate, { kind: 'absolute', decimals: 1, suffix: ' pts' }),
    },
  };
}

// ============================================================
// RESUMEN SEMANAL — semana cerrada vs semana anterior (viernes)
// ============================================================

interface TopicWindowCount {
  topic: string;
  total: number;
  negative: number;
}

/**
 * Conteo COMPLETO de menciones por tópico principal en una ventana (sin el
 * truncado top-7 del topicsTable — necesario para que la comparación semanal
 * no marque como "nuevo" un tópico que la semana pasada quedó fuera del top).
 * Misma semántica que loadTopicsTable: top-confidence por mención, día
 * calendario en TZ PR, sin duplicados. Excluye "Sin clasificar".
 */
async function loadTopicCounts(
  client: any,
  agencyId: string,
  startYmd: string,
  endYmd: string,
): Promise<TopicWindowCount[]> {
  const r = await client.query(
    `SELECT t.name AS topic,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE pt.sentiment = 'negativo')::int AS negative
       FROM (
         SELECT m.id,
                COALESCE(m.nlp_sentiment, m.bw_sentiment) AS sentiment,
                (SELECT topic_id FROM mention_topics
                  WHERE mention_id = m.id
                  ORDER BY confidence DESC NULLS LAST, topic_id ASC LIMIT 1) AS topic_id
           FROM mentions m
          WHERE m.agency_id = $1
            AND m.is_duplicate = false
            AND (m.published_at AT TIME ZONE 'America/Puerto_Rico')::date >= $2::date
            AND (m.published_at AT TIME ZONE 'America/Puerto_Rico')::date <= $3::date
       ) pt
       JOIN topics t ON t.id = pt.topic_id
      GROUP BY t.name
      ORDER BY total DESC`,
    [agencyId, startYmd, endYmd],
  );
  return r.rows.map((row: any) => ({
    topic: row.topic,
    total: Number(row.total),
    negative: Number(row.negative),
  }));
}

async function buildWeeklySummaryEmail(
  client: any,
  agency: { id: string; slug: string; name: string },
): Promise<BuiltEmail> {
  // Semana cerrada: 7 días terminando AYER. Enviado el viernes ⇒ vie–jue.
  // Agencia importada: termina en el último día que cubre el exporte.
  const nowUtc = new Date();
  const coverage = await loadAgencyCoverage(client as PgClientLike, agency.id);
  const window = closedWindowYmdInTZ(7, reportWindowNow(coverage, nowUtc), REPORT_TIMEZONE);
  const { startYmd, endYmd, prevStartYmd, prevEndYmd } = window;
  // Ventana previa-previa: solo para satisfacer la firma de buildSentimentReport
  // al calcular la semana anterior (su deltaVsPrev no se usa aquí).
  const prevPrevEnd = addDaysYmd(prevStartYmd, -1);
  const prevPrevStart = addDaysYmd(prevPrevEnd, -6);

  const [curReport, prevReport, winCur, winPrev, curTopics, prevTopics] = await Promise.all([
    buildSentimentReport(client as PgClientLike, agency.id, startYmd, endYmd, prevStartYmd, prevEndYmd),
    buildSentimentReport(client as PgClientLike, agency.id, prevStartYmd, prevEndYmd, prevPrevStart, prevPrevEnd),
    loadMetricsForWindow(client as PgClientLike, agency.id, startYmd, endYmd),
    loadMetricsForWindow(client as PgClientLike, agency.id, prevStartYmd, prevEndYmd),
    loadTopicCounts(client, agency.id, startYmd, endYmd),
    loadTopicCounts(client, agency.id, prevStartYmd, prevEndYmd),
  ]);

  const totals = curReport.totals;
  const prevTotals = prevReport.totals;

  // Comparación de tópicos: unión de ambas semanas, orden por volumen actual.
  const prevTopicMap = new Map(prevTopics.map((t) => [t.topic, t]));
  const curTopicMap = new Map(curTopics.map((t) => [t.topic, t]));
  const curTopicNames = new Set(curTopics.map((t) => t.topic));
  const compare = [
    ...curTopics.map((t) => ({ topic: t.topic, cur: t.total, prev: prevTopicMap.get(t.topic)?.total ?? 0 })),
    ...prevTopics.filter((t) => !curTopicNames.has(t.topic)).map((t) => ({ topic: t.topic, cur: 0, prev: t.total })),
  ].sort((a, b) => b.cur - a.cur || b.prev - a.prev);
  const topicsCompare = compare.slice(0, 8).map((t) => {
    const negatives = curTopicMap.get(t.topic)?.negative ?? 0;
    return {
      ...t,
      delta: formatDelta(t.cur, t.prev, { kind: 'percent', decimals: 0 }),
      // Concentración negativa del tópico esta semana (columna "% neg.").
      negShare: t.cur > 0 ? Math.round((negatives / t.cur) * 100) : null,
    };
  });

  // Tópicos que salieron de la conversación: tenían volumen la semana anterior
  // y esta semana no registran. Se excluyen los que ya aparecen en la tabla
  // (con cur=0) para no decir lo mismo dos veces.
  const renderedTopics = new Set(topicsCompare.map((t) => t.topic));
  const goneTopics = prevTopics
    .filter((t) => t.total > 0 && !curTopicNames.has(t.topic) && !renderedTopics.has(t.topic))
    .sort((a, b) => b.total - a.total)
    .slice(0, 4)
    .map((t) => ({ topic: t.topic, prev: t.total }));

  // Contexto LLM de la semana actual (mismas queries que el diario).
  const aggregates = await buildAggregates(client, agency, startYmd, endYmd, curReport);
  const samples = await loadSamples(client, agency.id, startYmd, endYmd);

  const metrics = buildEmailMetrics(winCur, winPrev);
  // Exactamente los 4 indicadores que el lector VE en el correo (tiles del
  // Bloque 2) — así el LLM no comenta indicadores invisibles ni ignora los
  // visibles. Tasa de interacción y Velocidad quedaron fuera de los tiles
  // (ago 2026): la Velocidad duplica el delta de "Semana vs semana".
  const indicatorLines = [
    { label: 'Riesgo de crisis', cur: metrics.crisis.display.value ?? '—', prev: formatMetric('crisis', winPrev.crisisRiskScore).value ?? '—' },
    { label: 'Sentimiento neto', cur: metrics.nss.display.value ?? '—', prev: formatMetric('nss', winPrev.nss).value ?? '—' },
    { label: 'Salud de marca', cur: metrics.bhi.display.value ?? '—', prev: formatMetric('bhi', winPrev.brandHealthIndex).value ?? '—' },
    { label: 'Polarización', cur: metrics.polarization?.display.value ?? '—', prev: formatMetric('polarization', winPrev.polarizationIndex).value ?? '—' },
  ];

  const weekLabel = formatPeriodLabel(startYmd, endYmd);
  const prevWeekLabel = formatPeriodLabel(prevStartYmd, prevEndYmd);

  // Menciones con mayor engagement de la semana — aterrizan el reporte en
  // contenido concreto. Se toman de las mismas muestras que van al LLM
  // (pertinencia alta/media, ya ordenadas por engagement por sentimiento).
  const topSamples = [...samples.negative, ...samples.neutral, ...samples.positive]
    .filter((m) => typeof m.engagement === 'number' && m.engagement > 0)
    .sort((a, b) => (b.engagement ?? 0) - (a.engagement ?? 0))
    .slice(0, 5);
  const [thumbs, heroImage] = await Promise.all([
    loadMentionThumbnails(client, topSamples.map((m) => m.id)),
    loadHeroImage(client, agency.id, startYmd, endYmd),
  ]);
  const topMentions = topSamples
    .map((m) => ({
      sourceLabel: m.source ?? m.pageType ?? 'Fuente desconocida',
      title: null,
      snippet: m.text.length > 220 ? `${m.text.slice(0, 220)}…` : m.text,
      url: m.url ?? null,
      engagementLabel: `${(m.engagement ?? 0).toLocaleString('es-PR')} interacciones`,
      // Día en hora de PR: createdAt es un instante UTC y slice(0,10) corría
      // al día siguiente las menciones de la noche.
      publishedAtLabel: formatShortDay(ymdInTimeZone(new Date(m.createdAt), REPORT_TIMEZONE)),
      tone: m.sentiment,
      imageUrl: thumbs.get(m.id) ?? null,
    }));

  const ai = await generateWeeklyComparison({
    current: aggregates,
    prevTotals,
    prevByTopic: prevTopics.map((t) => ({ topic: t.topic, total: t.total, negative: t.negative })),
    indicatorLines,
    samples,
    weekLabel,
    prevWeekLabel,
  });

  const renderData: WeeklySummaryRenderData = {
    agencyName: agency.name,
    agencyShortName: agencyShortName(agency.slug),
    agencyKicker: `${agencyShortName(agency.slug)} · ${agency.name}`,
    weekLabel,
    prevWeekLabel,
    updatedAtLabel: updatedLabelFor(coverage, nowUtc),
    totals,
    prevTotals,
    totalDelta: formatDelta(totals.total, prevTotals.total, { kind: 'percent', decimals: 0 }),
    sentimentDelta: {
      negative: formatDelta(totals.negative, prevTotals.negative, { kind: 'percent', decimals: 0, invert: true }),
      neutral: formatDelta(totals.neutral, prevTotals.neutral, { kind: 'percent', decimals: 0 }),
      positive: formatDelta(totals.positive, prevTotals.positive, { kind: 'percent', decimals: 0 }),
    },
    metrics,
    // Ritmo diario en tablas HTML: cada día junto al mismo día de la semana
    // anterior (mismo índice: ambas ventanas son de 7 días consecutivos).
    dailyCompare: curReport.dailySeries.map((d, i) => {
      const p = prevReport.dailySeries[i];
      return {
        label: d.dayLabel,
        cur: d.negative + d.neutral + d.positive,
        prev: p ? p.negative + p.neutral + p.positive : 0,
      };
    }),
    heroImage,
    weeklyHeadline: ai.headline,
    weeklySummary: ai.summary,
    highlights: ai.highlights,
    topicsCompare,
    goneTopics,
    topMentions,
    // Misma URL que los CTAs del diario (paridad ago 2026): Overview de la agencia.
    dashboardUrl: `${DASHBOARD_BASE_URL}/overview?agency=${agency.slug}`,
  };

  // Como en el diario: el asunto es el titular de la semana; las cifras van
  // en la vista previa del inbox. Sin titular, el asunto de siempre.
  const weeklyHeadline = (ai.headline ?? '').trim();
  const subject = buildSubject('Semanal', agencyShortName(agency.slug), weeklyHeadline || `semana ${weekLabel}`);

  return {
    html: renderWeeklySummaryHtml(renderData),
    subject,
    stats: totals,
    // Enviamos también cuando la semana actual quedó en cero pero la anterior
    // tuvo volumen — "la conversación se apagó" ES señal semanal.
    hasData: totals.total > 0 || prevTotals.total > 0,
  };
}

// ============================================================
// CORREO DE NOMBRAMIENTO — desde el nombramiento hasta HOY
// ============================================================

interface AppointmentRow {
  id: string;
  agency_id: string;
  agency_slug: string;
  agency_name: string;
  person_name: string;
  position: string;
  predecessor: string | null;
  /** YYYY-MM-DD (columna DATE; pg la devuelve como string con este driver). */
  announced_on: string;
  coverage_start: string;
  recipients: string[] | null;
  notes: string | null;
  photo_url: string | null;
  notified_at: string | null;
}

/** Normaliza una columna DATE a 'YYYY-MM-DD' venga como string o como Date. */
function ymdOf(v: string | Date): string {
  return typeof v === 'string' ? v.slice(0, 10) : v.toISOString().slice(0, 10);
}

const APPOINTMENT_SELECT = `
  SELECT ap.id, ap.agency_id, ap.person_name, ap.position, ap.predecessor,
         ap.announced_on, ap.coverage_start, ap.recipients, ap.notes, ap.photo_url, ap.notified_at,
         a.slug AS agency_slug, a.name AS agency_name
    FROM agency_appointments ap
    JOIN agencies a ON a.id = ap.agency_id`;

function toAppointmentRow(r: any): AppointmentRow {
  return { ...r, announced_on: ymdOf(r.announced_on), coverage_start: ymdOf(r.coverage_start) };
}

/** Un nombramiento concreto (por id) o el más reciente de la agencia. */
async function loadAppointment(client: any, agencyId: string, id?: string): Promise<AppointmentRow | null> {
  const r = id
    ? await client.query(`${APPOINTMENT_SELECT} WHERE ap.id = $1 AND ap.agency_id = $2 LIMIT 1`, [id, agencyId])
    : await client.query(
        `${APPOINTMENT_SELECT} WHERE ap.agency_id = $1
          ORDER BY ap.announced_on DESC, ap.created_at DESC LIMIT 1`, [agencyId]);
  return r.rows.length ? toAppointmentRow(r.rows[0]) : null;
}

/**
 * Destinatarios del correo de nombramiento. La fila puede fijarlos (caso
 * "probar primero conmigo"); si no, se resuelven en el momento del envío desde
 * los usuarios ECO activos — así un usuario nuevo recibe el próximo
 * nombramiento sin que haya que tocar ninguna lista.
 */
async function resolveAppointmentRecipients(client: any, appointment: AppointmentRow): Promise<string[]> {
  if (Array.isArray(appointment.recipients) && appointment.recipients.length > 0) {
    return appointment.recipients;
  }
  const r = await client.query(
    `SELECT DISTINCT lower(email) AS email
       FROM users
      WHERE is_active = true AND email IS NOT NULL AND email <> ''
      ORDER BY 1`,
  );
  return r.rows.map((row: any) => row.email as string);
}

/**
 * Barrido de nombramientos pendientes: filas sin notified_at cuya ventana ya
 * arrancó. Estampa notified_at solo cuando SES aceptó al menos un destinatario,
 * de modo que un fallo transitorio lo reintenta en el tick siguiente.
 */
async function dispatchPendingAppointments(client: any): Promise<RunResult[]> {
  let pending: AppointmentRow[];
  try {
    const todayYmd = ymdInTimeZone(new Date(), REPORT_TIMEZONE);
    const r = await client.query(
      `${APPOINTMENT_SELECT}
        WHERE ap.notified_at IS NULL
          AND a.is_active = true
          AND ap.coverage_start <= $1::date
        ORDER BY ap.announced_on ASC, ap.created_at ASC`,
      [todayYmd],
    );
    pending = r.rows.map(toAppointmentRow);
  } catch (err: any) {
    // La tabla se crea en ensureReportsSchema; si por lo que sea no existe,
    // el barrido de nombramientos no debe tumbar el diario ni el semanal.
    console.error('[weekly-report] appointment sweep query failed:', err?.message ?? err);
    return [];
  }

  if (!pending.length) return [];
  console.log(`[weekly-report] ${pending.length} appointment(s) pending notification`);

  const runs: RunResult[] = [];
  for (const ap of pending) {
    const recipients = await resolveAppointmentRecipients(client, ap);
    if (!recipients.length) {
      console.warn(`[weekly-report] appointment ${ap.id} (${ap.agency_slug}) — no recipients resolved`);
      await logSend(client, ap.agency_id, {
        recipients: [], fromEmail: 'agutierrez@populicom.com',
        templateKey: APPOINTMENT_TEMPLATE_KEY, trigger: 'scheduled', status: 'no_recipients',
      });
      runs.push({ ok: false, agency: ap.agency_slug, reportType: 'appointment', status: 'no_recipients' });
      continue;
    }

    const cfg = await client.query(
      `SELECT from_email, from_name FROM report_configs WHERE agency_id = $1 LIMIT 1`, [ap.agency_id],
    );
    const result = await runForAgency(client, {
      agencyId: ap.agency_id,
      agencySlug: ap.agency_slug,
      agencyName: ap.agency_name,
      recipients,
      fromEmail: cfg.rows[0]?.from_email ?? 'agutierrez@populicom.com',
      fromName: cfg.rows[0]?.from_name ?? 'ECO Radar',
      templateKey: APPOINTMENT_TEMPLATE_KEY,
      trigger: 'scheduled',
      triggeredBy: null,
    }, 'appointment', ap);

    // 'no_data' también se marca: si no hubo ni una mención desde el
    // nombramiento, reintentar cada hora no va a cambiar el resultado y el
    // correo perdería sentido. Solo 'failed' se deja pendiente.
    if (result.status === 'sent' || result.status === 'no_data') {
      await client.query(`UPDATE agency_appointments SET notified_at = NOW() WHERE id = $1`, [ap.id]);
      console.log(`[weekly-report] appointment ${ap.id} (${ap.agency_slug}) marked notified · status=${result.status}`);
    }
    runs.push(result);
  }
  return runs;
}

async function buildAppointmentEmail(
  client: any,
  agency: { id: string; slug: string; name: string },
  ap: AppointmentRow,
): Promise<BuiltEmail> {
  // Ventana: nombramiento → HOY, incluyendo hoy (parcial). Es la diferencia
  // deliberada con el diario y el semanal, que cierran en ayer: aquí el pedido
  // es explícitamente "desde que ocurrió el nombramiento hasta hoy".
  const nowUtc = new Date();
  const todayYmd = ymdInTimeZone(nowUtc, REPORT_TIMEZONE);
  const startYmd = ap.coverage_start > todayYmd ? todayYmd : ap.coverage_start;
  const endYmd = todayYmd;
  const windowDays = daysBetweenInclusive(startYmd, endYmd);

  // Línea base: los MISMOS días inmediatamente anteriores al nombramiento. Así
  // el delta separa el efecto del anuncio del nivel normal de la agencia.
  const baselineEnd = addDaysYmd(startYmd, -1);
  const baselineStart = addDaysYmd(baselineEnd, -(windowDays - 1));

  const [curReport, winCur, winPrev, topicCounts] = await Promise.all([
    buildSentimentReport(client as PgClientLike, agency.id, startYmd, endYmd, baselineStart, baselineEnd),
    loadMetricsForWindow(client as PgClientLike, agency.id, startYmd, endYmd),
    loadMetricsForWindow(client as PgClientLike, agency.id, baselineStart, baselineEnd),
    loadTopicCounts(client, agency.id, startYmd, endYmd),
  ]);

  const totals = curReport.totals;
  const baselineTotals = winPrev.totals;

  const aggregates = await buildAggregates(client, agency, startYmd, endYmd, curReport);
  const samples = await loadSamples(client, agency.id, startYmd, endYmd);

  const metrics = buildEmailMetrics(winCur, winPrev);
  const indicatorLines = [
    { label: 'Riesgo de crisis', cur: metrics.crisis.display.value ?? '—', prev: formatMetric('crisis', winPrev.crisisRiskScore).value ?? '—' },
    { label: 'Sentimiento neto', cur: metrics.nss.display.value ?? '—', prev: formatMetric('nss', winPrev.nss).value ?? '—' },
    { label: 'Salud de marca', cur: metrics.bhi.display.value ?? '—', prev: formatMetric('bhi', winPrev.brandHealthIndex).value ?? '—' },
    { label: 'Polarización', cur: metrics.polarization?.display.value ?? '—', prev: formatMetric('polarization', winPrev.polarizationIndex).value ?? '—' },
  ];

  const windowLabel = formatPeriodLabel(startYmd, endYmd);
  const baselineLabel = formatPeriodLabel(baselineStart, baselineEnd);

  const topSamples = [...samples.negative, ...samples.neutral, ...samples.positive]
    .filter((m) => typeof m.engagement === 'number' && m.engagement > 0)
    .sort((a, b) => (b.engagement ?? 0) - (a.engagement ?? 0))
    .slice(0, 5);
  const [thumbs, heroImage] = await Promise.all([
    loadMentionThumbnails(client, topSamples.map((m) => m.id)),
    loadHeroImage(client, agency.id, startYmd, endYmd),
  ]);
  const topMentions = topSamples
    .map((m) => ({
      sourceLabel: m.source ?? m.pageType ?? 'Fuente desconocida',
      title: null,
      snippet: m.text.length > 220 ? `${m.text.slice(0, 220)}…` : m.text,
      url: m.url ?? null,
      engagementLabel: `${(m.engagement ?? 0).toLocaleString('es-PR')} interacciones`,
      // Día en hora de PR: createdAt es un instante UTC y slice(0,10) corría
      // al día siguiente las menciones de la noche.
      publishedAtLabel: formatShortDay(ymdInTimeZone(new Date(m.createdAt), REPORT_TIMEZONE)),
      tone: m.sentiment,
      imageUrl: thumbs.get(m.id) ?? null,
    }));

  const ai = await generateAppointmentSummary({
    facts: {
      personName: ap.person_name,
      position: ap.position,
      predecessor: ap.predecessor,
      announcedOn: ap.announced_on,
      notes: ap.notes,
    },
    current: aggregates,
    baselineTotals,
    baselineLabel,
    windowLabel,
    windowDays,
    indicatorLines,
    samples,
  });

  const renderData: AppointmentRenderData = {
    agencyName: agency.name,
    agencyShortName: agencyShortName(agency.slug),
    agencyKicker: `${agencyShortName(agency.slug)} · ${agency.name}`,
    appointment: {
      personName: ap.person_name,
      position: ap.position,
      predecessor: ap.predecessor,
      announcedOnLabel: fullDateEs(ap.announced_on),
      notes: ap.notes,
      photoUrl: ap.photo_url,
    },
    windowLabel,
    baselineLabel,
    windowDays,
    updatedAtLabel: formatUpdatedAtLabel(nowUtc, REPORT_TIMEZONE),
    totals,
    baselineTotals,
    totalDelta: formatDelta(totals.total, baselineTotals.total, { kind: 'percent', decimals: 0 }),
    sentimentDelta: {
      negative: formatDelta(totals.negative, baselineTotals.negative, { kind: 'percent', decimals: 0, invert: true }),
      neutral: formatDelta(totals.neutral, baselineTotals.neutral, { kind: 'percent', decimals: 0 }),
      positive: formatDelta(totals.positive, baselineTotals.positive, { kind: 'percent', decimals: 0 }),
    },
    metrics,
    // Ritmo diario en tablas HTML; el último día es HOY (parcial).
    dailySeries: curReport.dailySeries,
    heroImage,
    headline: ai.headline,
    summary: ai.summary,
    reception: ai.reception,
    highlights: ai.highlights,
    topics: topicCounts.slice(0, 8).map((t) => ({
      topic: t.topic,
      total: t.total,
      negShare: t.total > 0 ? Math.round((t.negative / t.total) * 100) : null,
    })),
    topMentions,
    dashboardUrl: `${DASHBOARD_BASE_URL}/overview?agency=${agency.slug}`,
  };

  // Como en el diario y el semanal: el asunto cuenta cómo cayó (titular del
  // LLM) y el volumen va en la vista previa. Sin titular, el de siempre.
  const appointmentHeadline = (ai.headline ?? '').trim();
  const subject = buildSubject(
    'Nombramiento',
    agencyShortName(agency.slug),
    appointmentHeadline
      ? `${ap.person_name}: ${appointmentHeadline}`
      : `${ap.person_name} · ${fmtIntEs(totals.total)} menciones desde el ${formatShortDay(startYmd)}`,
  );

  return {
    html: renderAppointmentReportHtml(renderData),
    subject,
    stats: totals,
    // Sin una sola mención el correo no dice nada; se logea no_data y se marca
    // notificado (reintentar por hora no cambiaría el resultado).
    hasData: totals.total > 0,
  };
}

async function generateAppointmentSummary(
  inputs: Parameters<typeof buildAppointmentSummaryPrompt>[0],
): Promise<{ headline: string; summary: string; reception: string[]; highlights: string[] }> {
  const fallback = { headline: '', summary: 'Resumen no disponible.', reception: [] as string[], highlights: [] as string[] };
  if (inputs.current.totals.total === 0) {
    return {
      headline: 'Sin conversación registrada desde el nombramiento',
      summary: `Sin menciones registradas desde el nombramiento de ${inputs.facts.personName} en los canales monitoreados.`,
      reception: [], highlights: [],
    };
  }
  const prompt = buildAppointmentSummaryPrompt(inputs);
  try {
    const parsed = await invokeClaudeWithTool<{ headline?: unknown; summary?: unknown; reception?: unknown; highlights?: unknown }>(
      INSIGHTS_SYSTEM_PROMPT,
      prompt,
      2400,
      {
        name: 'submit_appointment_summary',
        description: 'Entrega el titular, el resumen de cómo cayó el nombramiento, los ejes de recepción y lo que movió vs los días previos.',
        input_schema: {
          type: 'object',
          properties: {
            headline: { type: 'string', description: 'Titular de 8 a 18 palabras sobre CÓMO se recibió el nombramiento (no que ocurrió). Sin cifras, sin punto final.' },
            summary: { type: 'string', description: 'De 3 a 5 oraciones (80–120 palabras): de dónde salió el volumen, quién lo produjo y sobre qué gira la discusión. Máximo dos cifras.' },
            reception: {
              type: 'array', items: { type: 'string' },
              description: '2–4 viñetas, cada una un ángulo distinto de cómo se está recibiendo, contando qué se dijo en concreto. Incluye lo que NO se discute si es señal.',
            },
            highlights: {
              type: 'array', items: { type: 'string' },
              description: '2–4 viñetas sobre lo que el nombramiento movió frente a los días previos, contadas como hechos y no como cifras con etiqueta.',
            },
          },
          required: ['headline', 'summary', 'reception', 'highlights'],
          additionalProperties: false,
        },
      },
    );
    const strings = (arr: unknown, max: number): string[] => coerceBulletList(arr, max);
    return {
      headline: typeof parsed.headline === 'string' ? parsed.headline.trim() : '',
      summary: typeof parsed.summary === 'string' && parsed.summary.trim().length > 0 ? parsed.summary : fallback.summary,
      reception: strings(parsed.reception, 4),
      highlights: strings(parsed.highlights, 4),
    };
  } catch (err) {
    console.error('[weekly-report] appointment summary generation failed:', err);
    return fallback;
  }
}

// ============================================================
// Schema bootstrap (idempotent)
// ============================================================

async function ensureReportsSchema(client: any): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS report_configs (
      agency_id UUID PRIMARY KEY REFERENCES agencies(id) ON DELETE CASCADE,
      is_active BOOLEAN NOT NULL DEFAULT true,
      send_hour_local INTEGER NOT NULL DEFAULT 6,
      timezone VARCHAR(64) NOT NULL DEFAULT 'America/Puerto_Rico',
      template_key VARCHAR(64) NOT NULL DEFAULT 'daily-sentiment-summary',
      recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
      from_email VARCHAR(255) NOT NULL DEFAULT 'agutierrez@populicom.com',
      from_name VARCHAR(255) NOT NULL DEFAULT 'ECO Radar',
      weekly_enabled BOOLEAN NOT NULL DEFAULT true,
      weekly_send_dow INTEGER NOT NULL DEFAULT 5,
      weekly_send_hour_local INTEGER NOT NULL DEFAULT 15,
      updated_by UUID REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_report_configs_active ON report_configs(is_active);`);

  // Migración jul 2026 — correo semanal de los viernes:
  //  - weekly_enabled: on/off del semanal por agencia (default ON).
  //  - weekly_send_dow: día local de envío, convención JS getDay
  //    (0=domingo … 6=sábado). Default 5 = viernes.
  //  - weekly_send_hour_local: hora local (0–23) del semanal, independiente
  //    del diario. Default 15 = 3:00 PM (pedido del cliente jul 2026).
  await client.query(`ALTER TABLE report_configs ADD COLUMN IF NOT EXISTS weekly_enabled BOOLEAN NOT NULL DEFAULT true;`);
  await client.query(`ALTER TABLE report_configs ADD COLUMN IF NOT EXISTS weekly_send_dow INTEGER NOT NULL DEFAULT 5;`);
  await client.query(`ALTER TABLE report_configs ADD COLUMN IF NOT EXISTS weekly_send_hour_local INTEGER NOT NULL DEFAULT 15;`);

  // Self-heal jul 2026: el template_key histórico 'weekly-sentiment-summary'
  // describía un correo que en realidad es DIARIO. Se renombra una sola vez;
  // no-op cuando ya migró. (La API de settings acepta ambos valores.)
  await client.query(`
    UPDATE report_configs
       SET template_key = 'daily-sentiment-summary', updated_at = NOW()
     WHERE template_key = 'weekly-sentiment-summary';
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS report_send_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      recipients JSONB NOT NULL,
      from_email VARCHAR(255) NOT NULL,
      template_key VARCHAR(64) NOT NULL,
      trigger VARCHAR(32) NOT NULL,
      status VARCHAR(32) NOT NULL,
      message_id VARCHAR(255),
      error TEXT,
      stats JSONB,
      triggered_by UUID REFERENCES users(id)
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_report_send_log_agency_id ON report_send_log(agency_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_report_send_log_sent_at ON report_send_log(sent_at);`);

  // Migración ago 2026 — correo de NOMBRAMIENTO. Fuente de verdad del disparo:
  // el barrido horario busca filas con notified_at IS NULL y envía una vez.
  // Se registra a mano (no por NLP) porque un nombramiento es un hecho con
  // fecha, y este correo no puede dispararse con un rumor.
  await client.query(`
    CREATE TABLE IF NOT EXISTS agency_appointments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
      person_name VARCHAR(255) NOT NULL,
      position VARCHAR(255) NOT NULL,
      predecessor VARCHAR(255),
      announced_on DATE NOT NULL,
      coverage_start DATE NOT NULL,
      recipients JSONB,
      query_terms JSONB,
      notes TEXT,
      notified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by UUID REFERENCES users(id)
    );
  `);
  // Añadida después del CREATE original (ago 2026): retrato de la persona.
  await client.query(`ALTER TABLE agency_appointments ADD COLUMN IF NOT EXISTS photo_url TEXT;`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_agency_appointments_agency_id ON agency_appointments(agency_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_agency_appointments_pending ON agency_appointments(notified_at);`);

  // Seed default config: DDEC activo con destinatarios Populicom a las 6 AM
  // (America/Puerto_Rico). Otras agencias inactivas. El ON CONFLICT solo
  // sobreescribe si nadie ha editado la fila desde la UI (updated_by IS NULL).
  //
  // composer_mode (interpretación v1) NO está en este SET ni en ningún otro
  // self-heal de esta función: un cambio de modo por SQL no se revierte. Aun
  // así, al editar report_configs por SQL hay que dejar updated_by NOT NULL:
  // con updated_by NULL este UPSERT reescribe is_active (todas menos DDEC
  // quedarían inactivas), send_hour_local, timezone y recipients cada hora.
  const DDEC_RECIPIENTS = [
    'agutierrez@populicom.com',
    'gpaz@populicom.com',
    'csanchez@populicom.com',
    'asoto@populicom.com',
    'lquinones@populicom.com',
    'grosado@populicom.com',
  ];
  await client.query(`
    INSERT INTO report_configs (agency_id, is_active, send_hour_local, timezone, recipients, from_email, from_name)
    SELECT id,
           CASE WHEN slug = 'ddecpr' THEN true ELSE false END,
           6,
           'America/Puerto_Rico',
           CASE WHEN slug = 'ddecpr' THEN $1::jsonb ELSE '[]'::jsonb END,
           'agutierrez@populicom.com',
           'ECO Radar'
    FROM agencies
    WHERE is_active = true
    ON CONFLICT (agency_id) DO UPDATE SET
      is_active = EXCLUDED.is_active,
      send_hour_local = EXCLUDED.send_hour_local,
      timezone = EXCLUDED.timezone,
      recipients = EXCLUDED.recipients,
      updated_at = NOW()
    WHERE report_configs.updated_by IS NULL;
  `, [JSON.stringify(DDEC_RECIPIENTS)]);

  // Self-heal: una sola vez, migra la config DDEC de Bogotá a Puerto Rico aun
  // si la UI ya tocó la fila (updated_by NOT NULL). Detectamos el estado
  // antiguo por la timezone — si ya es 'America/Puerto_Rico', no hace nada.
  await client.query(`
    UPDATE report_configs rc
       SET timezone = 'America/Puerto_Rico',
           send_hour_local = CASE
             WHEN rc.send_hour_local IN (16, 17) THEN 6
             ELSE rc.send_hour_local
           END,
           updated_at = NOW()
      FROM agencies a
     WHERE rc.agency_id = a.id
       AND a.slug = 'ddecpr'
       AND rc.timezone = 'America/Bogota';
  `);

  // Self-heal from_name: migra filas con el branding viejo "Populicom Radar"
  // a "ECO Radar" sin tocar valores custom que la UI haya guardado.
  await client.query(`
    UPDATE report_configs
       SET from_name = 'ECO Radar', updated_at = NOW()
     WHERE from_name = 'Populicom Radar';
  `);

  // Self-heal recipients de DDEC: añade lquinones y grosado si faltan, sin
  // duplicar y sin tocar otros emails que el usuario haya configurado.
  await client.query(`
    UPDATE report_configs rc
       SET recipients = (
             SELECT COALESCE(jsonb_agg(DISTINCT email), '[]'::jsonb)
               FROM jsonb_array_elements_text(
                 COALESCE(rc.recipients, '[]'::jsonb)
                 || '["lquinones@populicom.com","grosado@populicom.com"]'::jsonb
               ) AS email
           ),
           updated_at = NOW()
      FROM agencies a
     WHERE rc.agency_id = a.id
       AND a.slug = 'ddecpr'
       AND NOT (
         rc.recipients @> '["lquinones@populicom.com"]'::jsonb
         AND rc.recipients @> '["grosado@populicom.com"]'::jsonb
       );
  `);

  console.log('[weekly-report] reports schema ensured');
}

// ============================================================
// DB queries for aggregates
// ============================================================

async function buildAggregates(
  client: any,
  agency: { id: string; slug: string; name: string },
  startDate: string,
  endDate: string,
  sentimentReport: SentimentReport,
): Promise<WeeklyAggregates> {
  // NOTA: las queries de métricas NO filtran por nlp_pertinence — cuentan todas
  // las menciones para mantener paridad con el dashboard. El filtro de pertinencia
  // se aplica solo en loadSamples()/loadTodaySamples() porque esas muestras van al
  // LLM, y queremos que el LLM solo describa señal de calidad.
  //
  // Totales, deltas, daily series y la tabla de tópicos vienen de
  // sentimentReport (ya computado por @eco/shared/buildSentimentReport — la
  // misma función que consume /api/overview). Aquí solo agregamos el contexto
  // que el LLM necesita y que NO se renderiza en el correo: top 10 tópicos
  // como array de subtopics, municipios, autores, fuentes, emociones.
  const byTopic = sentimentReport.topicsTable
    .filter((t) => !t.isOther && !t.isUnclassified)
    .slice(0, 10)
    .map((t) => ({
      topic: t.topic,
      subtopics: t.subtopics ? t.subtopics.split(' · ') : [],
      total: t.total,
      negative: t.negative,
      neutral: t.neutral,
      positive: t.positive,
    }));

  const byMuniRows = await client.query(
    `SELECT mu.name AS municipality,
            COUNT(DISTINCT m.id)::int AS total,
            COUNT(DISTINCT m.id) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) = 'negativo')::int AS negative
       FROM mentions m
       JOIN mention_municipalities mm ON mm.mention_id = m.id
       JOIN municipalities mu ON mu.id = mm.municipality_id
      WHERE m.agency_id = $1
        AND m.is_duplicate = false
        AND m.published_at >= ($2::date)
        AND m.published_at <  (($3::date) + INTERVAL '1 day')
      GROUP BY mu.id, mu.name
      ORDER BY negative DESC, total DESC
      LIMIT 10`,
    [agency.id, startDate, endDate],
  );
  const byMunicipality = byMuniRows.rows.map((r: any) => ({
    municipality: r.municipality, total: r.total, negative: r.negative,
  }));

  const topAuthorsRows = await client.query(
    `SELECT author, COUNT(*)::int AS mentions,
            (SELECT COALESCE(m2.nlp_sentiment, m2.bw_sentiment)
               FROM mentions m2
              WHERE m2.agency_id = $1 AND m2.author = m.author
                AND m2.is_duplicate = false
                AND m2.published_at >= ($2::date)
                AND m2.published_at <  (($3::date) + INTERVAL '1 day')
              GROUP BY 1
              ORDER BY COUNT(*) DESC
              LIMIT 1) AS dominant_sentiment
       FROM mentions m
      WHERE agency_id = $1
        AND is_duplicate = false
        AND author IS NOT NULL AND author <> ''
        AND published_at >= ($2::date)
        AND published_at <  (($3::date) + INTERVAL '1 day')
      GROUP BY author
      ORDER BY mentions DESC
      LIMIT 8`,
    [agency.id, startDate, endDate],
  );
  const topAuthors = topAuthorsRows.rows.map((r: any) => ({
    author: r.author,
    mentions: r.mentions,
    sentiment: (normalizeSentiment(r.dominant_sentiment) ?? 'neutral') as 'negative' | 'neutral' | 'positive',
  }));

  const topSourcesRows = await client.query(
    `SELECT COALESCE(content_source_name, domain) AS source, COUNT(*)::int AS mentions
       FROM mentions
      WHERE agency_id = $1
        AND is_duplicate = false
        AND published_at >= ($2::date)
        AND published_at <  (($3::date) + INTERVAL '1 day')
        AND COALESCE(content_source_name, domain) IS NOT NULL
      GROUP BY source
      ORDER BY mentions DESC
      LIMIT 8`,
    [agency.id, startDate, endDate],
  );
  const topSources = topSourcesRows.rows.map((r: any) => ({ source: r.source, mentions: r.mentions }));

  const emotionsRows = await client.query(
    `SELECT emo::text AS emotion, COUNT(*)::int AS cnt
       FROM mentions m, jsonb_array_elements_text(COALESCE(m.nlp_emotions, '[]'::jsonb)) AS emo
      WHERE m.agency_id = $1
        AND m.is_duplicate = false
        AND m.published_at >= ($2::date)
        AND m.published_at <  (($3::date) + INTERVAL '1 day')
      GROUP BY emo
      ORDER BY cnt DESC
      LIMIT 6`,
    [agency.id, startDate, endDate],
  );
  const topEmotions = emotionsRows.rows.map((r: any) => ({
    emotion: String(r.emotion).replace(/^"|"$/g, ''),
    count: r.cnt,
  }));

  return {
    periodStart: startDate,
    periodEnd: endDate,
    agencyName: agency.name,
    agencyShortName: agencyShortName(agency.slug),
    totals: sentimentReport.totals,
    deltaVsPrevWeek: sentimentReport.deltaVsPrev,
    dailySeries: sentimentReport.dailySeries.map((d) => ({
      date: d.date,
      negative: d.negative,
      neutral: d.neutral,
      positive: d.positive,
    })),
    byTopic,
    byMunicipality,
    topAuthors,
    topSources,
    topEmotions,
  };
}

async function loadSamples(
  client: any,
  agencyId: string,
  startDate: string,
  endDate: string,
): Promise<{ negative: MentionSample[]; neutral: MentionSample[]; positive: MentionSample[] }> {
  const result: Record<string, MentionSample[]> = { negative: [], neutral: [], positive: [] };
  const map: Record<string, 'negativo' | 'neutral' | 'positivo'> = {
    negative: 'negativo', neutral: 'neutral', positive: 'positivo',
  };
  for (const key of Object.keys(result) as Array<keyof typeof result>) {
    const r = await client.query(
      `SELECT m.id, m.published_at, m.title, m.snippet, m.author, m.content_source_name, m.url,
              m.page_type, m.engagement_score, m.nlp_pertinence, m.nlp_emotions,
              COALESCE(m.nlp_sentiment, m.bw_sentiment) AS sentiment,
              t.name AS topic, s.name AS subtopic, mu.name AS municipality
         FROM mentions m
         LEFT JOIN LATERAL (
           SELECT topic_id, subtopic_id FROM mention_topics WHERE mention_id = m.id ORDER BY confidence DESC NULLS LAST LIMIT 1
         ) mt ON true
         LEFT JOIN topics t ON t.id = mt.topic_id
         LEFT JOIN subtopics s ON s.id = mt.subtopic_id
         LEFT JOIN LATERAL (
           SELECT municipality_id FROM mention_municipalities WHERE mention_id = m.id LIMIT 1
         ) mm ON true
         LEFT JOIN municipalities mu ON mu.id = mm.municipality_id
        WHERE m.agency_id = $1
          AND m.is_duplicate = false
          AND m.published_at >= ($2::date)
          AND m.published_at <  (($3::date) + INTERVAL '1 day')
          AND COALESCE(m.nlp_sentiment, m.bw_sentiment) = $4
          AND m.nlp_pertinence IN ('alta','media')
        ORDER BY COALESCE(m.engagement_score, 0) DESC, m.published_at DESC
        LIMIT 20`,
      [agencyId, startDate, endDate, map[key]],
    );
    result[key] = r.rows.map((row: any) => ({
      id: row.id,
      createdAt: (row.published_at as Date).toISOString(),
      text: `${row.title ? row.title + ' — ' : ''}${row.snippet ?? ''}`.trim(),
      sentiment: key as 'negative' | 'neutral' | 'positive',
      topic: row.topic,
      subtopic: row.subtopic,
      municipality: row.municipality,
      author: row.author,
      source: row.content_source_name,
      url: row.url,
      pageType: row.page_type,
      engagement: row.engagement_score != null ? Number(row.engagement_score) : null,
      pertinence: (row.nlp_pertinence as 'alta' | 'media' | 'baja' | null) ?? null,
      emotions: Array.isArray(row.nlp_emotions) ? row.nlp_emotions : [],
    }));
  }
  return result as { negative: MentionSample[]; neutral: MentionSample[]; positive: MentionSample[] };
}

async function loadTodaySamples(client: any, agencyId: string, todayYmd: string): Promise<MentionSample[]> {
  const r = await client.query(
    `SELECT m.id, m.published_at, m.title, m.snippet, m.author, m.content_source_name,
            COALESCE(m.nlp_sentiment, m.bw_sentiment) AS sentiment,
            t.name AS topic, mu.name AS municipality
       FROM mentions m
       LEFT JOIN LATERAL (
         SELECT topic_id FROM mention_topics WHERE mention_id = m.id ORDER BY confidence DESC NULLS LAST LIMIT 1
       ) mt ON true
       LEFT JOIN topics t ON t.id = mt.topic_id
       LEFT JOIN LATERAL (
         SELECT municipality_id FROM mention_municipalities WHERE mention_id = m.id LIMIT 1
       ) mm ON true
       LEFT JOIN municipalities mu ON mu.id = mm.municipality_id
      WHERE m.agency_id = $1
        AND m.is_duplicate = false
        AND m.nlp_pertinence IN ('alta','media')
        AND m.published_at >= ($2::date)
        AND m.published_at <  (($2::date) + INTERVAL '1 day')
      ORDER BY COALESCE(m.engagement_score, 0) DESC, m.published_at DESC
      LIMIT 20`,
    [agencyId, todayYmd],
  );
  return r.rows.map((row: any) => ({
    id: row.id,
    createdAt: (row.published_at as Date).toISOString(),
    text: `${row.title ? row.title + ' — ' : ''}${row.snippet ?? ''}`.trim(),
    sentiment: (row.sentiment === 'negativo' ? 'negative' : row.sentiment === 'positivo' ? 'positive' : 'neutral') as 'negative' | 'neutral' | 'positive',
    topic: row.topic,
    municipality: row.municipality,
    source: row.content_source_name,
  }));
}

/**
 * Foto de portada de un correo: la noticia/blog/foro del rango (ayer en el
 * diario, la semana en el semanal) con pertinencia alta y más engagement que
 * tenga una imagen utilizable. Mismas dos reglas que la
 * foto del correo de crisis (#120): el og:image SOLO se pide a páginas de
 * tipo artículo —a un visitante sin sesión Instagram/Facebook/X le sirven su
 * logo— y se descartan las imágenes genéricas. Best-effort: 3s por URL; si
 * ninguna candidata tiene foto, el bloque no se emite.
 */
async function loadHeroImage(
  client: any,
  agencyId: string,
  startYmd: string,
  endYmd: string,
): Promise<{ url: string; caption: string } | null> {
  try {
    const r = await client.query(
      `SELECT m.id, m.url, m.page_type, m.resolved_image_url, m.content_source_name, m.published_at
         FROM mentions m
        WHERE m.agency_id = $1
          AND m.is_duplicate = false
          AND m.nlp_pertinence IN ('alta','media')
          AND m.published_at >= ($2::date)
          AND m.published_at <  (($3::date) + INTERVAL '1 day')
          AND lower(m.page_type) IN ('news','blog','forum')
        ORDER BY (m.nlp_pertinence = 'alta') DESC, COALESCE(m.engagement_score, 0) DESC, m.published_at DESC
        LIMIT 5`,
      [agencyId, startYmd, endYmd],
    );
    // El filtro va en SQL, no después del LIMIT: las redes dominan el
    // engagement y las noticias (engagement ~0) quedaban fuera del corte.
    const candidates = (r.rows as any[]).filter((row) => isArticlePageType(row.page_type));
    const images = await Promise.all(candidates.map(async (row) => {
      const stored: string | null = row.resolved_image_url;
      if (stored && /^https?:\/\//i.test(stored) && !isGenericImageUrl(stored) && await validateImageUrl(stored)) {
        return stored;
      }
      return row.url ? fetchOgImage(row.url) : null;
    }).map((p) => p.catch(() => null)));
    const idx = images.findIndex((img) => img != null);
    if (idx < 0) return null;
    const row = candidates[idx];
    // content_source_name es genérico ("Online News"): el pie nombra el medio.
    let source: string = row.content_source_name ?? 'fuente';
    try {
      if (row.url) source = new URL(row.url).hostname.replace(/^www\./, '');
    } catch { /* URL inválida: queda el nombre de la fuente */ }
    const day = formatShortDay(ymdInTimeZone(new Date(row.published_at), REPORT_TIMEZONE));
    return { url: images[idx]!, caption: `Foto: ${source} · ${day}` };
  } catch (err) {
    console.warn('[report] hero image lookup failed', err);
    return null;
  }
}

/**
 * Miniaturas de "Lo más resonante": la imagen del post que el processor ya
 * resolvió (`resolved_image_url`). Para noticias/blogs, si no hay, el
 * og:image de la nota; para redes NUNCA el og:image de la plataforma (sirve
 * su logo a un visitante sin sesión). Best-effort, 3s por URL.
 */
async function loadMentionThumbnails(client: any, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  try {
    const r = await client.query(
      `SELECT id, url, page_type, resolved_image_url FROM mentions WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    await Promise.all((r.rows as any[]).map(async (row) => {
      const stored: string | null = row.resolved_image_url;
      let img: string | null = null;
      if (stored && /^https?:\/\//i.test(stored) && !isGenericImageUrl(stored) && await validateImageUrl(stored)) {
        img = stored;
      } else if (isArticlePageType(row.page_type) && row.url) {
        img = await fetchOgImage(row.url);
      }
      if (img) out.set(row.id, img);
    }).map((p) => p.catch(() => undefined)));
  } catch (err) {
    console.warn('[report] thumbnails lookup failed', err);
  }
  return out;
}

// ============================================================
// Bedrock
// ============================================================

/**
 * Invoca Claude vía tool-use con `input_schema`. Devuelve el `input`
 * estructurado del bloque `tool_use` — no JSON crudo. Esto evita los fallos
 * por comillas o saltos de línea no escapados que rompen `JSON.parse` cuando
 * pedimos JSON en texto plano. Bedrock garantiza la forma del `tool_use`.
 */
async function invokeClaudeWithTool<T>(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  tool: { name: string; description: string; input_schema: Record<string, unknown> },
): Promise<T> {
  const models = [BEDROCK_MODEL_ID, BEDROCK_FALLBACK_MODEL_ID].filter((m, i, arr) => m && arr.indexOf(m) === i);
  let lastErr: unknown = null;
  for (const modelId of models) {
    try {
      const response = await bedrock.send(new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
          temperature: 0,
          tools: [tool],
          tool_choice: { type: 'tool', name: tool.name },
        }),
      }));
      const body = JSON.parse(new TextDecoder().decode(response.body));
      const content: Array<{ type: string; name?: string; input?: unknown }> = body.content ?? [];
      const toolUse = content.find((b) => b.type === 'tool_use' && b.name === tool.name);
      if (body.stop_reason && body.stop_reason !== 'end_turn' && body.stop_reason !== 'tool_use') {
        throw new Error(`Bedrock stopped with reason '${body.stop_reason}' (likely max_tokens/filter)`);
      }
      if (!toolUse || typeof toolUse.input !== 'object' || toolUse.input === null) {
        throw new Error(`No tool_use block for '${tool.name}' in model ${modelId} response`);
      }
      return toolUse.input as T;
    } catch (err) {
      lastErr = err;
      console.warn(`[weekly-report] model ${modelId} failed:`, (err as Error).message);
    }
  }
  throw lastErr ?? new Error('No Bedrock model produced a response');
}

async function generateInsights(
  aggregates: WeeklyAggregates,
  samples: { negative: MentionSample[]; neutral: MentionSample[]; positive: MentionSample[] },
): Promise<{ negative: string[]; neutral: string[]; positive: string[] }> {
  if (aggregates.totals.total === 0) {
    return { negative: [], neutral: [], positive: [] };
  }
  const prompt = buildSentimentInsightsPrompt(aggregates, samples);
  try {
    const parsed = await invokeClaudeWithTool<{ negative?: unknown; neutral?: unknown; positive?: unknown }>(
      INSIGHTS_SYSTEM_PROMPT,
      prompt,
      1500,
      {
        name: 'submit_weekly_insights',
        description: 'Entrega los insights por sentimiento como tres arrays de cadenas.',
        input_schema: {
          type: 'object',
          properties: {
            negative: { type: 'array', items: { type: 'string' }, description: '0–2 insights del bloque negativo.' },
            neutral:  { type: 'array', items: { type: 'string' }, description: '0–2 insights del bloque neutral.' },
            positive: { type: 'array', items: { type: 'string' }, description: '0–2 insights del bloque positivo.' },
          },
          required: ['negative', 'neutral', 'positive'],
          additionalProperties: false,
        },
      },
    );
    const onlyStrings = (arr: unknown): string[] => coerceBulletList(arr, 2);
    return {
      negative: onlyStrings(parsed.negative),
      neutral:  onlyStrings(parsed.neutral),
      positive: onlyStrings(parsed.positive),
    };
  } catch (err) {
    console.error('[weekly-report] insights generation failed:', err);
    return { negative: [], neutral: [], positive: [] };
  }
}

/**
 * El lede del correo diario. Desde ago 2026 son tres piezas (titular, párrafo
 * corto, viñetas) en vez de un párrafo único — ver `buildDailySummaryPrompt`.
 */
interface DailyLede {
  headline: string;
  paragraph: string;
  highlights: string[];
}

async function generateDailySummary(
  aggregates: WeeklyAggregates,
  todaySamples: MentionSample[],
  todayYmd: string,
): Promise<DailyLede> {
  if (aggregates.totals.total === 0) {
    return {
      headline: 'Sin menciones en el periodo',
      paragraph: 'Sin menciones registradas en los canales monitoreados durante el periodo.',
      highlights: [],
    };
  }
  const prompt = buildDailySummaryPrompt(aggregates, todaySamples, todayYmd);
  try {
    const parsed = await invokeClaudeWithTool<{ headline?: unknown; paragraph?: unknown; highlights?: unknown }>(
      INSIGHTS_SYSTEM_PROMPT,
      prompt,
      1500,
      {
        name: 'submit_daily_summary',
        description: 'Entrega el lede del correo diario: titular, párrafo que explica, y viñetas que también explican.',
        input_schema: {
          type: 'object',
          properties: {
            headline: { type: 'string', description: 'Titular de 8 a 16 palabras, con sujeto y verbo, sin cifras y sin punto final.' },
            paragraph: { type: 'string', description: 'De 3 a 4 oraciones (60–90 palabras) explicando qué pasó, a raíz de qué y quién lo dice. Máximo dos cifras.' },
            highlights: {
              type: 'array',
              items: { type: 'string' },
              description: '2 a 4 viñetas; cada una cuenta un hecho con su cifra de apoyo, nunca una cifra con etiqueta.',
            },
          },
          required: ['headline', 'paragraph', 'highlights'],
          additionalProperties: false,
        },
      },
    );
    const str = (v: unknown, fallback: string): string =>
      typeof v === 'string' && v.trim().length > 0 ? v.trim() : fallback;
    return {
      headline: str(parsed.headline, ''),
      paragraph: str(parsed.paragraph, 'Resumen no disponible.'),
      highlights: coerceBulletList(parsed.highlights, 4),
    };
  } catch (err) {
    console.error('[weekly-report] daily summary generation failed:', err);
    return { headline: '', paragraph: 'Resumen no disponible.', highlights: [] };
  }
}

async function generateWeeklyComparison(
  inputs: Parameters<typeof buildWeeklySummaryPrompt>[0],
): Promise<{ headline: string; summary: string; highlights: string[] }> {
  const fallback = {
    headline: '',
    summary: 'Resumen no disponible.',
    highlights: [] as string[],
  };
  if (inputs.current.totals.total === 0 && inputs.prevTotals.total === 0) {
    return { headline: 'Sin conversación registrada en las últimas dos semanas', summary: 'Sin menciones registradas en las últimas dos semanas en los canales monitoreados.', highlights: [] };
  }
  const prompt = buildWeeklySummaryPrompt(inputs);
  try {
    const parsed = await invokeClaudeWithTool<{ headline?: unknown; summary?: unknown; highlights?: unknown }>(
      INSIGHTS_SYSTEM_PROMPT,
      prompt,
      2000,
      {
        name: 'submit_weekly_comparison',
        description: 'Entrega el titular del cambio, el resumen de la semana y las viñetas de qué cambió vs la semana anterior.',
        input_schema: {
          type: 'object',
          properties: {
            headline: { type: 'string', description: 'Titular de 8 a 18 palabras nombrando el cambio central de la semana. Sin cifras, sin punto final.' },
            summary: { type: 'string', description: 'De 3 a 5 oraciones (80–130 palabras) explicando el cambio y qué lo produjo. Máximo dos cifras.' },
            highlights: {
              type: 'array',
              items: { type: 'string' },
              description: '2–4 viñetas, cada una contando un cambio concreto vs la semana anterior como hecho, no como cifra con etiqueta.',
            },
          },
          required: ['headline', 'summary', 'highlights'],
          additionalProperties: false,
        },
      },
    );
    const summary = typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
      ? parsed.summary
      : fallback.summary;
    const highlights = coerceBulletList(parsed.highlights, 4);
    const headline = typeof parsed.headline === 'string' ? parsed.headline.trim() : '';
    return { headline, summary, highlights };
  } catch (err) {
    console.error('[weekly-report] weekly comparison generation failed:', err);
    return fallback;
  }
}

// ============================================================
// Send log
// ============================================================

interface LogEntry {
  recipients: string[];
  fromEmail: string;
  templateKey: string;
  trigger: 'scheduled' | 'manual' | 'test';
  status: 'sent' | 'skipped' | 'failed' | 'no_recipients' | 'no_data';
  messageId?: string;
  error?: string;
  stats?: { negative: number; neutral: number; positive: number; total: number };
  triggeredBy?: string;
  /** Archivo del envío (solo con el motor). Sin él, el INSERT es el de siempre. */
  archive?: SendArchive;
}

async function logSend(client: any, agencyId: string, entry: LogEntry): Promise<void> {
  if (entry.archive) {
    try {
      await client.query(
        `INSERT INTO report_send_log
           (agency_id, recipients, from_email, template_key, trigger, status, message_id, error, stats, triggered_by,
            subject, headline, composition, composer_version)
         VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13::jsonb, $14)`,
        [
          agencyId,
          JSON.stringify(entry.recipients),
          entry.fromEmail,
          entry.templateKey,
          entry.trigger,
          entry.status,
          entry.messageId ?? null,
          entry.error ?? null,
          entry.stats ? JSON.stringify(entry.stats) : null,
          entry.triggeredBy ?? null,
          entry.archive.subject,
          entry.archive.headline,
          JSON.stringify(entry.archive.composition),
          entry.archive.composerVersion,
        ],
      );
      return;
    } catch (err) {
      // Sin las columnas de 0013 (o composición demasiado grande): se registra
      // el envío igual, sin archivo. El registro del envío nunca se pierde.
      console.error('[weekly-report] failed to write send log with archive; retrying without it:', err);
    }
  }
  try {
    await client.query(
      `INSERT INTO report_send_log
         (agency_id, recipients, from_email, template_key, trigger, status, message_id, error, stats, triggered_by)
       VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
      [
        agencyId,
        JSON.stringify(entry.recipients),
        entry.fromEmail,
        entry.templateKey,
        entry.trigger,
        entry.status,
        entry.messageId ?? null,
        entry.error ?? null,
        entry.stats ? JSON.stringify(entry.stats) : null,
        entry.triggeredBy ?? null,
      ],
    );
  } catch (err) {
    console.error('[weekly-report] failed to write send log:', err);
  }
}

/** ¿Entró un exporte después del último envío exitoso de este tipo de reporte? */
async function hasImportSinceLastSend(
  client: any,
  agencyId: string,
  templateKey: string,
  coverage: AgencyCoverage,
): Promise<boolean> {
  if (!coverage.lastIngestedAt) return false;
  const r = await client.query(
    `SELECT MAX(sent_at) AS last_sent FROM report_send_log
      WHERE agency_id = $1 AND template_key = $2 AND status = 'sent'`,
    [agencyId, templateKey],
  );
  const lastSent = r.rows[0]?.last_sent ? new Date(r.rows[0].last_sent) : null;
  return !lastSent || coverage.lastIngestedAt > lastSent;
}

/** «actualizado …» del encabezado: para una agencia importada, el corte del exporte. */
function updatedLabelFor(coverage: AgencyCoverage, nowUtc: Date): string {
  return coverage.importFed && coverage.lastPublishedAt
    ? `${formatUpdatedAtLabel(coverage.lastPublishedAt, REPORT_TIMEZONE)} (último exporte)`
    : formatUpdatedAtLabel(nowUtc, REPORT_TIMEZONE);
}

function agencyShortName(slug: string): string {
  const map: Record<string, string> = { aaa: 'AAA', ddecpr: 'DDEC' };
  return map[slug] ?? slug.toUpperCase();
}

// ============================================================
// Misc
// ============================================================

function normalizeSentiment(s: string | null): 'negative' | 'neutral' | 'positive' | null {
  if (!s) return null;
  const v = s.toLowerCase();
  if (v.startsWith('neg')) return 'negative';
  if (v.startsWith('pos')) return 'positive';
  if (v.startsWith('neu')) return 'neutral';
  return null;
}

async function getDatabaseUrl(): Promise<string> {
  const secret = await sm.send(new GetSecretValueCommand({ SecretId: DB_SECRET_ARN }));
  const parsed = JSON.parse(secret.SecretString!);
  return `postgresql://${parsed.username}:${encodeURIComponent(parsed.password)}@${parsed.host}:${parsed.port}/${parsed.dbname}`;
}

#!/usr/bin/env node
/*
 * Genera el contenedor de GTM (GTM-KXWF94VP) como JSON importable:
 *   node scripts/build-gtm-container.mjs > docs/analitica/gtm-container.json
 * Importar en GTM → Administrar → Importar contenedor → «Combinar / Sobrescribir
 * las etiquetas en conflicto».
 *
 * Diseño (ver docs/analitica-gtm.md): UNA etiqueta GA4 reenvía TODOS los
 * eventos `eco.*` del dataLayer con nombre = `eco_event` y parámetros =
 * `eco.<param>`. Añadir un parámetro nuevo = añadirlo a EVENT_PARAMS, regenerar
 * e importar. Añadir un evento nuevo no toca GTM.
 */

const ACCOUNT_ID = '6383788971';
const CONTAINER_ID = '267803991';
const PUBLIC_ID = 'GTM-KXWF94VP';
const MEASUREMENT_ID = 'G-78RZLQQJQY';

// Parámetros de evento que la app manda en `eco.*`.
export const EVENT_PARAMS = [
  // page_view virtual
  'page_location', 'page_path', 'page_title', 'nav_method',
  // contexto que cambia
  'from_agency', 'to_agency', 'from_period', 'to_period', 'range_days', 'mode',
  // auth
  'method',
  // búsqueda
  'search_term', 'search_source', 'search_filters', 'results_count',
  // aperturas
  'trigger',
  // menciones
  'mention_source', 'mention_sentiment', 'mention_domain', 'link_domain',
  // asistente
  'prompt_type', 'message_length', 'is_new_conversation',
  // exportar / alertas / reportes
  'export_format', 'alert_type', 'origin', 'metric', 'is_active',
  'report_type', 'result_status', 'recipients_count', 'target_agency',
  // administración de usuarios
  'assigned_role', 'assigned_all_agencies',
  // exploración
  'topic', 'municipality', 'narrative_name', 'drilldown_title', 'drilldown_filters',
  // errores
  'error_type', 'error_message',
];

// Contexto que viaja en todo evento (eco_ctx.*) e identidad (eco_user.*).
const CTX_PARAMS = ['agency_slug', 'period', 'screen_name'];
const USER_PROPS = ['role', 'home_agency', 'all_agencies', 'is_internal'];

let nextId = 1;
const id = () => String(nextId++);
const base = { accountId: ACCOUNT_ID, containerId: CONTAINER_ID };
const T = (key, value) => ({ type: 'TEMPLATE', key, value: String(value) });
const B = (key, value) => ({ type: 'BOOLEAN', key, value: value ? 'true' : 'false' });
const row = (k1, v1, k2, v2) => ({ type: 'MAP', map: [T(k1, v1), T(k2, v2)] });

const variables = [];
function dlv(name, path) {
  variables.push({
    ...base, variableId: id(), name, type: 'v',
    parameter: [{ type: 'INTEGER', key: 'dataLayerVersion', value: '2' }, B('setDefaultValue', false), T('name', path)],
    formatValue: {},
  });
  return `{{${name}}}`;
}

const vEvent = dlv('DLV - eco_event', 'eco_event');
const vParam = Object.fromEntries(EVENT_PARAMS.map((p) => [p, dlv(`DLV - eco.${p}`, `eco.${p}`)]));
const vCtx = Object.fromEntries(CTX_PARAMS.map((p) => [p, dlv(`DLV - eco_ctx.${p}`, `eco_ctx.${p}`)]));
const vUserId = dlv('DLV - eco_user.id', 'eco_user.id');
const vUser = Object.fromEntries(USER_PROPS.map((p) => [p, dlv(`DLV - eco_user.${p}`, `eco_user.${p}`)]));
const vDebug = dlv('DLV - eco_debug', 'eco_debug');

variables.push({
  ...base, variableId: id(), name: 'GA4 - Measurement ID', type: 'c',
  parameter: [T('value', MEASUREMENT_ID)], formatValue: {},
});

// Configuración compartida de eventos: contexto + identidad en cada hit.
const SETTINGS = 'GA4 - Configuración de eventos';
variables.push({
  ...base, variableId: id(), name: SETTINGS, type: 'gtes',
  parameter: [
    {
      type: 'LIST', key: 'eventSettingsTable',
      list: [
        ...CTX_PARAMS.map((p) => row('parameter', p, 'parameterValue', vCtx[p])),
        row('parameter', 'user_id', 'parameterValue', vUserId),
        row('parameter', 'debug_mode', 'parameterValue', vDebug),
      ],
    },
    {
      type: 'LIST', key: 'userProperties',
      list: USER_PROPS.map((p) => row('name', p === 'role' ? 'user_role' : p, 'value', vUser[p])),
    },
  ],
  formatValue: {},
});

const trigEco = id();
const triggers = [{
  ...base, triggerId: trigEco, name: 'CE - eco.* (todos los eventos ECO)', type: 'CUSTOM_EVENT',
  customEventFilter: [{
    type: 'MATCH_REGEX',
    parameter: [T('arg0', '{{_event}}'), T('arg1', '^eco\\..+')],
  }],
}];

const INIT_ALL_PAGES = '2147479573'; // Initialization - All Pages (integrado)

const tags = [
  {
    ...base, tagId: id(), name: 'GA4 - Google tag', type: 'googtag',
    parameter: [
      T('tagId', MEASUREMENT_ID),
      {
        type: 'LIST', key: 'configSettingsTable',
        list: [
          // La SPA manda su propio page_view (eco.page_view) por pantalla.
          row('parameter', 'send_page_view', 'parameterValue', 'false'),
          // Datos de gobierno: sin señales de Google ni personalización de anuncios.
          row('parameter', 'allow_google_signals', 'parameterValue', 'false'),
          row('parameter', 'allow_ad_personalization_signals', 'parameterValue', 'false'),
          row('parameter', 'user_id', 'parameterValue', vUserId),
        ],
      },
      T('eventSettingsVariable', `{{${SETTINGS}}}`),
    ],
    firingTriggerId: [INIT_ALL_PAGES],
    tagFiringOption: 'ONCE_PER_EVENT',
    monitoringMetadata: { type: 'MAP' },
    consentSettings: { consentStatus: 'NOT_SET' },
  },
  {
    ...base, tagId: id(), name: 'GA4 - Evento ECO (todos)', type: 'gaawe',
    parameter: [
      B('sendEcommerceData', false),
      T('eventName', vEvent),
      T('measurementIdOverride', MEASUREMENT_ID),
      {
        type: 'LIST', key: 'eventSettingsTable',
        list: EVENT_PARAMS.map((p) => row('parameter', p, 'parameterValue', vParam[p])),
      },
      T('eventSettingsVariable', `{{${SETTINGS}}}`),
    ],
    firingTriggerId: [trigEco],
    tagFiringOption: 'ONCE_PER_EVENT',
    monitoringMetadata: { type: 'MAP' },
    consentSettings: { consentStatus: 'NOT_SET' },
  },
];

const builtIn = [
  ['PAGE_URL', 'Page URL'], ['PAGE_HOSTNAME', 'Page Hostname'], ['PAGE_PATH', 'Page Path'],
  ['REFERRER', 'Referrer'], ['EVENT', 'Event'],
].map(([type, name]) => ({ ...base, type, name }));

const out = {
  exportFormatVersion: 2,
  exportTime: new Date().toISOString().replace('T', ' ').slice(0, 19),
  containerVersion: {
    path: `accounts/${ACCOUNT_ID}/containers/${CONTAINER_ID}/versions/0`,
    ...base,
    containerVersionId: '0',
    container: {
      path: `accounts/${ACCOUNT_ID}/containers/${CONTAINER_ID}`,
      ...base,
      name: 'citizenecho.com',
      publicId: PUBLIC_ID,
      usageContext: ['WEB'],
      fingerprint: '0',
      tagManagerUrl: `https://tagmanager.google.com/#/container/accounts/${ACCOUNT_ID}/containers/${CONTAINER_ID}/workspaces?apiLink=container`,
      features: {
        supportUserPermissions: true, supportEnvironments: true, supportWorkspaces: true,
        supportGtagConfigs: false, supportBuiltInVariables: true, supportClients: false,
        supportFolders: true, supportTags: true, supportTemplates: true, supportTriggers: true,
        supportVariables: true, supportVersions: true, supportZones: true, supportTransformations: false,
      },
      tagIds: [PUBLIC_ID],
    },
    tag: tags,
    trigger: triggers,
    variable: variables,
    builtInVariable: builtIn,
  },
};

process.stdout.write(JSON.stringify(out, null, 2) + '\n');

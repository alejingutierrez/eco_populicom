# Analítica: Google Tag Manager → GA4

Medición de uso del dashboard (citizenecho.com). Creado en oct-2026.

| Pieza | Valor |
|---|---|
| Cuenta GTM | **Populicom** (`6383788971`), cuenta Google `agutierrez@populicom.com` |
| Contenedor GTM | **citizenecho.com**, `GTM-KXWF94VP` (id interno `267803991`) |
| Propiedad GA4 | **Citizen Echo** (`p559826917`, cuenta `a412634754`) |
| Flujo web GA4 | `16168488730`, Measurement ID **`G-78RZLQQJQY`** |
| Código | `apps/web/public/eco-analytics.js` (cargador + `window.ecoTrack`) |
| Contenedor versionado | `docs/analitica/gtm-container.json`, generado por `scripts/build-gtm-container.mjs` |

## Cómo funciona

```
app (SPA / Next)  ──ecoTrack('evento', {params})──▶  dataLayer
   { event: 'eco.<evento>', eco_event: '<evento>', eco: {params} }
   + eco_ctx  {agency_slug, period, screen_name}   (contexto vigente)
   + eco_user {id, role, home_agency, all_agencies, is_internal}

GTM-KXWF94VP
   ├─ GA4 - Google tag (Initialization)  send_page_view=false, sin Google signals,
   │                                      user_id = eco_user.id
   └─ GA4 - Evento ECO (todos)           disparador: Custom Event ^eco\..+
                                          nombre = {{eco_event}}, parámetros = eco.*
                                          + «GA4 - Configuración de eventos»
                                            (eco_ctx.* en cada hit + propiedades de usuario)
```

- **Una sola etiqueta GA4 para todos los eventos.** Un evento nuevo NO toca GTM:
  basta con llamar `ecoTrack`. Solo un **parámetro** nuevo requiere añadirlo a
  `EVENT_PARAMS` en `scripts/build-gtm-container.mjs`, regenerar, importar en
  GTM (Administrar → Importar contenedor → Sobrescribir) y publicar, y después
  registrar su dimensión personalizada en GA4.
- **GTM solo carga en citizenecho.com / citizensecho.com.** En localhost, el ALB
  o el arnés, `ecoTrack` llena `dataLayer` pero no sale nada. Para probar en
  local: `localStorage.setItem('eco.analytics.debug','1')` → carga GTM en
  cualquier host, marca los hits con `debug_mode` (GA4 → Admin → DebugView) y
  los imprime en consola.
- **page_view es virtual**: la SPA lo manda en cada cambio de pantalla
  (`app.js`), las páginas Next en cada ruta (`PageViewTracker`). En el flujo de
  GA4 se apagaron «cambios de página por historial» y «búsqueda en el sitio» de
  la medición mejorada para no duplicar.
- **Iframes**: los paneles `/settings/*` que la SPA embebe no cargan GTM; sus
  eventos se reenvían al `ecoTrack` de la SPA (sin page_view propio).
- **Recargas**: cambiar de agencia o período recarga la página; el evento sale
  con `eventCallback` (máx. 800 ms) antes del `reload()`.
- **login / sign_up** los deja `/sign-in` en `sessionStorage`
  (`eco.analytics.pending`) y la SPA los emite al arrancar, ya con `user_id`.

### Privacidad

- Sin datos personales (lo prohíben GTM y GA4): ni correo, ni nombre, ni el
  texto que se le escribe al asistente. `user_id` = `sub` de Cognito (UUID).
  `ecoTrack` además reemplaza por `[redactado]` cualquier valor con forma de
  correo o teléfono y corta todo a 100 caracteres.
- Google signals y personalización de anuncios: apagados en el Google tag.
- Retención de datos GA4: 14 meses (máximo de la versión gratuita).
- `is_internal` (usuario @populicom.com) es propiedad de usuario: filtra el
  tráfico del equipo en los informes sin borrarlo.

## Eventos

Todo evento lleva además `agency_slug`, `period`, `screen_name` (contexto) y,
con sesión, `user_id` + propiedades de usuario.

| Evento | Cuándo | Parámetros |
|---|---|---|
| `page_view` | cambio de pantalla de la SPA; cada ruta Next | `page_location`, `page_path`, `page_title`, `nav_method` (`landing`, `sidebar`, `keyboard`, `command_palette`, `mention_drawer`, `back_forward`, `redirect`, `in_page`) |
| `login` | sesión iniciada (emitido en la SPA) | `method` (`password`, `invitation`) |
| `sign_up` | invitación activada (contraseña creada) | `method=invitation` |
| `activation_start` | la cuenta pide crear contraseña | — |
| `login_error` / `activation_error` | falla al entrar / al activar | `error_message` |
| `password_reset_request` / `password_reset_complete` | flujo de recuperar contraseña | — |
| `logout` | cerrar sesión | — |
| `agency_change` | cambio de agencia | `from_agency`, `to_agency` |
| `period_change` | cambio de período (incluye rango personalizado) | `from_period`, `to_period`, `range_days` |
| `theme_change` | modo claro/oscuro | `mode` |
| `command_palette_open` | ⌘K o botón Buscar | `trigger` (`keyboard`, `button`) |
| `search` | búsqueda desde ⌘K o en /search (una por búsqueda asentada) | `search_term`, `search_source` (`command_palette`, `search_page`), `results_count`, `search_filters` |
| `mention_open` | se abre el panel de una mención | `mention_source`, `mention_sentiment`, `mention_domain` |
| `mention_outbound_click` | «Ver original» | `link_domain`, `mention_source` |
| `drilldown_open` | se abre un desglose de menciones (cualquier gráfico clicable) | `drilldown_title`, `drilldown_filters`, `topic`, `municipality`, `mention_sentiment`, `mention_source` |
| `metric_insight_open` | modal de explicación de un índice | `metric` |
| `topic_open` | entrar al detalle de un tópico | `topic` |
| `narrative_select` | elegir una narrativa | `narrative_name` |
| `municipality_select` | elegir un municipio en Geografía | `municipality` |
| `chat_open` | abrir el asistente | `trigger` |
| `chat_message_send` | enviar pregunta al asistente | `prompt_type` (`typed`, `suggestion`), `message_length`, `is_new_conversation` |
| `chat_error` | el asistente falló | `error_message` |
| `chat_conversation_delete` | borrar una conversación | — |
| `report_export` | botón Exportar (PDF) | `export_format`, `to_period` |
| `alert_rule_create` | alerta creada (editor o desde un desglose) | `alert_type`, `origin` (`editor`, `drilldown`), `metric` |
| `alert_rule_toggle` | activar/desactivar regla | `is_active` |
| `crisis_settings_save` | guardar umbrales de crisis | `target_agency` |
| `report_settings_save` | guardar configuración de correos | `target_agency`, `recipients_count` |
| `report_test_send` | enviar correo de prueba | `report_type`, `result_status` |
| `user_invite` / `user_update` / `user_suspend` | administración de usuarios | `assigned_role`, `assigned_all_agencies` |
| `app_error` | error JS o pantalla que no se pudo dibujar | `error_type` (`js`, `render`), `error_message` |
| `api_error` | el arranque no pudo leer `/api/eco-data` | `error_type=boot`, `error_message` |

GA4 añade solo, por la medición mejorada: `scroll`, `click` (salientes),
`form_start`/`form_submit`, `file_download`, `video_*`, `user_engagement`.

## Configuración en GA4 (hecha)

- **Dimensiones personalizadas de evento (37)**: una por parámetro de la
  tabla, con nombre en español (p. ej. `nav_method` → «Método de navegación»,
  `drilldown_title` → «Desglose»: GA4 no acepta guiones en el nombre).
- **Dimensiones de usuario (4)**: `user_role` «Rol del usuario», `home_agency`
  «Agencia base», `all_agencies` «Acceso a todas las agencias», `is_internal`
  «Usuario interno Populicom».
- **Métricas personalizadas (4)**: `results_count`, `message_length`,
  `range_days`, `recipients_count`.
- Medición mejorada: sin page_view por historial ni búsqueda en el sitio.
- Retención: 14 meses.

### Pendiente: eventos clave

GA4 solo deja marcar como evento clave un evento que **ya recibió** (aparece
en Admin → Eventos en ≤24 h tras el primer hit). Cuando haya tráfico, marcar
con la estrella: `login`, `sign_up`, `report_export`, `alert_rule_create`,
`chat_message_send`, `user_invite`.

## Cómo añadir un evento

```js
// SPA (public/eco-prototype/*.js): usar el helper del archivo
ecoTrackScreen('mi_evento', { topic: slug });      // screens.js
ecoTrackShell('mi_evento', { metric });            // shell.js
ecoTrackApp('mi_evento', { ... });                 // app.js
```
```ts
// Next (src/app/**)
import { track } from '@/lib/analytics';
track('mi_evento', { report_type: 'weekly' });
```

Nombres en `snake_case`, ≤40 caracteres. Reusar parámetros existentes antes
de crear uno nuevo (cada uno cuesta una de las 50 dimensiones de evento).

⚠️ En los JS de la SPA, **nunca** declares un `const ecoTrack` de nivel
superior: Babel lo compila a `var`, que pisa `window.ecoTrack` y lo vuelve
recursivo (pasó en el primer intento: «Maximum call stack size exceeded»).

## Verificar

1. Local: `localStorage.setItem('eco.analytics.debug','1')`, recargar,
   y en consola ver `[eco-analytics] <evento>`; en GA4 → DebugView.
2. Prod: GTM → Vista previa (Tag Assistant) contra https://citizenecho.com,
   o GA4 → Informes → Tiempo real.

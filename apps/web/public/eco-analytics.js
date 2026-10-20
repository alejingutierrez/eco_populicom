/*
 * Analítica de ECO: Google Tag Manager (GTM-KXWF94VP) → GA4 (G-78RZLQQJQY).
 *
 * Único punto de entrada para medir. La SPA (/eco-prototype/index.html) y las
 * páginas Next (layout.tsx) cargan este archivo; el código llama
 * `window.ecoTrack(nombre, params)` y nada más. GTM reenvía cada evento a GA4
 * con UNA sola etiqueta (nombre = `eco_event`, parámetros = `eco.*`), así que un
 * evento nuevo solo necesita la llamada en el código (y, para verlo en los
 * informes, su dimensión personalizada en GA4). Plan completo de eventos:
 * docs/analitica-gtm.md.
 *
 * Reglas:
 *  - NUNCA datos personales: GTM/GA4 lo prohíben. Sin correos, nombres ni
 *    teléfonos. El usuario se identifica con el `sub` de Cognito (UUID opaco).
 *  - GTM solo carga en los dominios de producción (citizenecho.com y
 *    citizensecho.com). En localhost/ALB `ecoTrack` sigue llenando dataLayer
 *    pero no sale nada, salvo que `localStorage['eco.analytics.debug'] = '1'`:
 *    eso carga GTM en cualquier host y marca los hits con debug_mode (GA4 →
 *    DebugView) y los imprime en consola.
 *  - Dentro de un iframe del mismo origen (los paneles /settings/* que la SPA
 *    embebe) no se carga GTM: los eventos se reenvían al `ecoTrack` del padre,
 *    para no duplicar sesiones ni page_views.
 */
(function () {
  'use strict';
  if (window.ecoTrack) return;

  var GTM_ID = 'GTM-KXWF94VP';
  var PROD_HOST = /(^|\.)citizens?echo\.com$/;
  var USER_KEY = 'eco.analytics.user';

  var debug = false;
  try { debug = localStorage.getItem('eco.analytics.debug') === '1'; } catch (_) {}

  // Iframe del mismo origen: todo va al padre.
  var parentTrack = null;
  try {
    if (window.top !== window.self && window.parent && window.parent.ecoTrack) parentTrack = window.parent.ecoTrack;
  } catch (_) { /* padre de otro origen: se mide aquí mismo */ }

  var dl = (window.dataLayer = window.dataLayer || []);

  // GA4 corta los valores de texto a 100 caracteres; se corta aquí para no
  // mandar basura y se descartan valores con forma de dato personal.
  var EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
  var PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;
  function clean(v) {
    if (v === undefined || v === null || v === '') return undefined;
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return isFinite(v) ? v : undefined;
    var s = String(v).trim();
    if (!s) return undefined;
    if (EMAIL_RE.test(s)) return '[redactado]';
    if (PHONE_RE.test(s) && s.replace(/\D/g, '').length >= 9) return '[redactado]';
    return s.slice(0, 100);
  }
  function cleanParams(p) {
    var out = {};
    if (!p) return out;
    for (var k in p) {
      if (!Object.prototype.hasOwnProperty.call(p, k)) continue;
      var v = clean(p[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  // Contexto persistente (agencia, período, pantalla): viaja en CADA evento vía
  // la variable de configuración de eventos de GTM (eco_ctx.*).
  var ctx = {};
  function setContext(next) {
    var changed = false;
    var c = cleanParams(next);
    for (var k in c) { if (ctx[k] !== c[k]) { ctx[k] = c[k]; changed = true; } }
    if (changed) dl.push({ eco_ctx: null }, { eco_ctx: Object.assign({}, ctx) });
  }

  // Identidad. Se cachea en sessionStorage para que los eventos que salen antes
  // de que /api/auth/me responda (page_view inicial, recargas por cambio de
  // agencia o período) ya lleven user_id.
  function pushUser(u) {
    dl.push({ eco_user: null }, { eco_user: u });
  }
  function setUser(session) {
    if (!session || !session.sub) return;
    var email = String(session.email || '').toLowerCase();
    var u = cleanParams({
      id: session.sub,
      role: session.role,
      home_agency: session.agencySlug,
      all_agencies: session.allAgencies === true ? true : session.allAgencies === false ? false : undefined,
      is_internal: /@populicom\.com$/.test(email),
    });
    try { sessionStorage.setItem(USER_KEY, JSON.stringify(u)); } catch (_) {}
    pushUser(u);
  }
  function clearUser() {
    try { sessionStorage.removeItem(USER_KEY); } catch (_) {}
    dl.push({ eco_user: null });
  }
  try {
    var cached = JSON.parse(sessionStorage.getItem(USER_KEY) || 'null');
    if (cached && cached.id) pushUser(cached);
  } catch (_) {}

  // ecoTrack(evento, params, { callback }) — `callback` corre cuando GTM
  // terminó de despachar las etiquetas del evento (o a los 800 ms, lo que
  // ocurra primero). Usarlo antes de recargar o navegar fuera de la página para
  // que el hit no se pierda.
  function ecoTrack(name, params, opts) {
    var cb = opts && typeof opts.callback === 'function' ? opts.callback : null;
    if (parentTrack) {
      try { return parentTrack(name, params, opts); } catch (_) { /* padre desmontado: sigue aquí */ }
    }
    var event = String(name || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40);
    if (!event) { if (cb) cb(); return; }
    var payload = { event: 'eco.' + event, eco_event: event, eco: cleanParams(params) };
    if (cb) {
      var done = false;
      var finish = function () { if (!done) { done = true; cb(); } };
      payload.eventCallback = finish;
      payload.eventTimeout = 800;
      // Sin GTM (dev, bloqueador) eventCallback nunca llega.
      setTimeout(finish, loaded ? 900 : 0);
    }
    if (debug) try { console.info('[eco-analytics]', event, payload.eco, Object.assign({}, ctx)); } catch (_) {}
    // `eco: null` primero: dataLayer MEZCLA objetos entre pushes, y sin el
    // reset los parámetros de un evento se colarían en el siguiente.
    dl.push({ eco: null }, payload);
  }

  function pageView(extra) {
    var p = Object.assign({
      page_location: location.origin + location.pathname,
      page_path: location.pathname,
      page_title: document.title,
    }, extra || {});
    ecoTrack('page_view', p);
  }

  window.ecoTrack = ecoTrack;
  window.ecoAnalytics = {
    track: ecoTrack,
    pageView: pageView,
    setContext: setContext,
    setUser: setUser,
    clearUser: clearUser,
    embedded: !!parentTrack,
  };

  // Carga de GTM: solo producción (o debug explícito) y nunca dentro del iframe.
  var loaded = false;
  if (!parentTrack && (PROD_HOST.test(location.hostname) || debug)) {
    loaded = true;
    if (debug) dl.push({ eco_debug: true });
    dl.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtm.js?id=' + GTM_ID;
    var first = document.getElementsByTagName('script')[0];
    if (first && first.parentNode) first.parentNode.insertBefore(s, first);
    else document.head.appendChild(s);
  }

  // Errores JS no capturados: un evento por mensaje distinto por página, para
  // no inundar GA4 si algo entra en bucle.
  var seenErrors = {};
  window.addEventListener('error', function (e) {
    var msg = (e && e.message) || 'error';
    if (seenErrors[msg]) return;
    seenErrors[msg] = 1;
    // Errores de scripts de terceros (extensiones, CDN) llegan como "Script error."
    if (msg === 'Script error.') return;
    ecoTrack('app_error', { error_type: 'js', error_message: msg });
  });
})();

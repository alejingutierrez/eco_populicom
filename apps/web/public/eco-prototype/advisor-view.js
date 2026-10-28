// Modo Asesor del chat drawer (spec §3.1–§3.2). Fase 0: selector Descriptivo | Asesor,
// progreso del camino 1 y pie con citas y revisión. Se carga antes de chat-drawer.js y
// expone window.ECO_ADVISOR; el drawer sigue funcionando sin él (modo descriptivo intacto).
(function () {
  const h = React.createElement;

  /** ¿El usuario ve el selector? Capacidad `advise` con la sesión cargada (spec §3.1). */
  function canAdvise() {
    return typeof window.ecoHasCap === 'function' && !!window.ecoHasCap('advise');
  }

  /** Selector de dos modos en la cabecera del drawer. */
  function ModeSelector(props) {
    const { mode, onChange } = props;
    const opt = (key, label) => h('button', {
      key,
      className: 'chat-mode-btn' + (mode === key ? ' active' : ''),
      'aria-pressed': mode === key,
      onClick: () => onChange(key),
      style: {
        padding: '3px 9px', fontSize: 'var(--fs-caption)', borderRadius: 'var(--r-pill, 999px)',
        border: '1px solid var(--hairline)',
        background: mode === key ? 'var(--accent-fill)' : 'transparent',
        color: mode === key ? 'var(--text)' : 'var(--text-2)', cursor: 'pointer',
      },
    }, label);
    return h('div', { role: 'group', 'aria-label': 'Modo del chat', style: { display: 'flex', gap: 4 } }, [
      opt('descriptive', 'Descriptivo'),
      opt('advisor', 'Asesor'),
    ]);
  }

  /** Notas de progreso del camino 1 mientras no hay texto. */
  function Progress(props) {
    const items = props.items || [];
    if (items.length === 0) return null;
    return h('ul', { style: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 3 } },
      items.map((t, i) => h('li', {
        key: i,
        style: { fontSize: 'var(--fs-caption)', color: 'var(--text-3)', display: 'flex', gap: 6, alignItems: 'center' },
      }, [
        h('span', { key: 'd', 'aria-hidden': true, style: { width: 5, height: 5, borderRadius: 3, background: 'var(--accent)', display: 'inline-block' } }),
        h('span', { key: 't' }, t),
      ])));
  }

  /** Pie del memorando/respuesta: citas y revisión automática (spec §3.3, paso 8). */
  function Footer(props) {
    const meta = props.meta;
    if (!meta) return null;
    const c = meta.citations || { total: 0, invalid: 0 };
    const alertas = (meta.revision && meta.revision.alertas) || 0;
    return h('div', {
      style: { marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--hairline)', fontSize: 'var(--fs-caption)', color: 'var(--text-3)' },
    },
      'Citas: ' + c.total + (c.invalid ? ' · ' + c.invalid + ' sin respaldo' : '') +
      ' · Revisión: ' + (alertas ? alertas + ' alerta' + (alertas === 1 ? '' : 's') : 'sin alertas') +
      ' · El asesor aconseja; la agencia decide.');
  }

  /** Elementos extra de una burbuja del asistente en modo Asesor. */
  function renderExtras(m) {
    if (!m || m.role !== 'assistant') return null;
    const parts = [];
    if (!m.content && m.progress && m.progress.length) {
      parts.push(h(Progress, { key: 'p', items: m.progress }));
    }
    if (m.meta) parts.push(h(Footer, { key: 'f', meta: m.meta }));
    return parts.length ? parts : null;
  }

  /** Mensaje legible para una respuesta HTTP no válida del asesor. */
  function httpErrorText(status, body) {
    const reason = body && body.reason;
    if (status === 401) return 'Sesión expirada. Recarga la página.';
    if (status === 403 && reason === 'staff_only') return 'El asesor está disponible solo para el equipo de Populicom.';
    if (status === 403 && reason === 'agency_not_enabled') return 'El asesor todavía no está habilitado para esta agencia.';
    if (status === 403) return 'Tu cuenta no tiene acceso al asesor.';
    if (status === 429 && body && body.error === 'daily_limit') return 'Llegaste al límite diario de consultas al asesor.';
    if (status === 429) return 'Demasiadas consultas seguidas. Espera un minuto.';
    if (status === 503) return 'El asesor no está disponible en este momento.';
    return 'Error ' + status + '.';
  }

  window.ECO_ADVISOR = {
    canAdvise,
    ModeSelector,
    renderExtras,
    httpErrorText,
  };
})();

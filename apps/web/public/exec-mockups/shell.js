/* ============================================================
   ECO — Shell compartido (sidebar + header). window.ECOShell.
   Uso en cada mockup:
     document.getElementById('app').innerHTML = ECOShell.frame({
       active: 'gobierno',
       title: 'Tabla de Posiciones',
       eyebrow: 'Vista ejecutiva · Multi-agencia',
       content: '<...html del contenido...>'
     });
   ============================================================ */
(function () {
  const M = window.MOCK || {};
  const fmt = (M.fmt) || { compact: (n) => String(n) };

  // ---- iconos (Feather-ish, stroke=currentColor) ----
  const P = {
    gobierno: '<path d="M3 9 L12 4 L21 9"/><path d="M4 9.5 V19 M9 9.5 V19 M15 9.5 V19 M20 9.5 V19"/><path d="M3 19 H21"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    dashboard: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9 H21 M9 9 V21"/>',
    mentions: '<path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
    mappin: '<path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    building: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h2M9 11h2M9 15h2M13 7h2M13 11h2M13 15h2"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
  };
  function icon(name, size) {
    size = size || 16;
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;
  }

  // marca ECO (arcos de eco) — réplica del shell real
  const MARK = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <path d="M 7 19 A 7 7 0 0 1 7 5" stroke="var(--accent-2)" stroke-width="1.6" stroke-linecap="round" opacity="0.35"/>
    <path d="M 10 17 A 5 5 0 0 1 10 7" stroke="var(--accent-2)" stroke-width="1.6" stroke-linecap="round" opacity="0.6"/>
    <path d="M 13 15 A 3 3 0 0 1 13 9" stroke="var(--accent-2)" stroke-width="1.6" stroke-linecap="round" opacity="0.9"/>
    <circle cx="16.5" cy="12" r="1.8" fill="var(--accent-2)"/>
  </svg>`;

  const EXEC_NAV = [
    { key: 'gobierno', icon: 'gobierno', label: 'Gobierno PR' },
  ];
  const ANALISIS_NAV = [
    { key: 'overview', icon: 'grid', label: 'Overview' },
    { key: 'dashboard', icon: 'dashboard', label: 'Scorecard' },
    { key: 'mentions', icon: 'mentions', label: 'Menciones', badge: '179K' },
    { key: 'sentiment', icon: 'activity', label: 'Sentimiento' },
    { key: 'topics', icon: 'hash', label: 'Tópicos' },
    { key: 'geography', icon: 'mappin', label: 'Geografía' },
    { key: 'alerts', icon: 'bell', label: 'Alertas', badge: '6', urgent: true },
  ];
  const SYSTEM_NAV = [{ key: 'settings', icon: 'settings', label: 'Configuración' }];

  function navItem(it, active) {
    const isActive = it.key === active;
    const badge = it.badge
      ? `<span class="eco-nav-badge${it.urgent ? ' urgent' : ''}">${it.badge}</span>`
      : '';
    return `<button class="eco-nav-item${isActive ? ' active' : ''}">${icon(it.icon)}<span class="lbl">${it.label}</span>${badge}</button>`;
  }

  function sidebar({ active }) {
    return `
    <aside class="eco-rail">
      <div class="eco-rail-logo">
        <div class="eco-mark">${MARK}<span class="eco-mark-live"></span></div>
        <div style="min-width:0;flex:1">
          <div style="display:flex;align-items:baseline;gap:6px">
            <span class="eco-word">Eco</span>
            <span class="eco-badge-v">v2.3</span>
          </div>
          <div class="eco-sub">Operations Console</div>
        </div>
      </div>
      <button class="eco-search">${icon('search', 13)}<span>Buscar, ir a…</span><span class="kbd">⌘K</span></button>
      <div class="eco-navlabel">Ejecutivo</div>
      <nav class="eco-nav">${EXEC_NAV.map((n) => navItem(n, active)).join('')}</nav>
      <div class="eco-navlabel mt">Análisis</div>
      <nav class="eco-nav">${ANALISIS_NAV.map((n) => navItem(n, active)).join('')}</nav>
      <div class="eco-navlabel mt">Sistema</div>
      <nav class="eco-nav">${SYSTEM_NAV.map((n) => navItem(n, active)).join('')}</nav>
      <div class="eco-rail-spacer"></div>
      <div class="eco-rail-status">
        <span class="pulse" style="width:6px;height:6px;border-radius:50%;background:var(--pos)"></span>
        <span>Ingesta en vivo</span>
        <span class="mono">6:00 AM</span>
      </div>
      <div class="eco-rail-user">
        <div class="eco-avatar">AG</div>
        <div style="overflow:hidden;flex:1">
          <div class="eco-user-name">A. Gutiérrez</div>
          <div class="eco-user-role">Admin · La Fortaleza</div>
        </div>
      </div>
    </aside>`;
  }

  function header({ title, eyebrow, period }) {
    const PERIODS = ['1D', '5D', '7D', '30D', '90D', '3M', '6M', '1A', 'Max'];
    const active = period || '7D';
    return `
    <header class="eco-header">
      <div class="eco-header-titles">
        <div class="eco-eyebrow-row">
          ${eyebrow ? `<div class="section-eyebrow" style="margin-bottom:0">${eyebrow}</div>` : ''}
          <div class="eco-live"><span class="pulse dot"></span><span class="mono">En vivo</span></div>
        </div>
        <h1 class="eco-h1">${title || ''}</h1>
      </div>
      <div class="eco-agency">
        <span style="color:var(--accent);display:flex">${icon('building', 13)}</span>
        <span>Todas las agencias</span>
        <span class="count">13</span>
        <span style="color:var(--text-3);display:flex">${icon('chevron', 13)}</span>
      </div>
      <div class="eco-periodbag">
        ${PERIODS.map((p) => `<button class="eco-period${p === active ? ' active' : ''}">${p}</button>`).join('')}
      </div>
      <button class="eco-icon-btn">${icon('calendar', 12)}<span>Fechas</span></button>
      <button class="eco-icon-btn">${icon('search', 13)}<span style="color:var(--text-3)">Buscar</span><span class="kbd">⌘K</span></button>
      <button class="eco-icon-btn" title="Modo claro">${icon('sun', 14)}</button>
    </header>`;
  }

  function frame({ active, title, eyebrow, period, content }) {
    return `
    <div class="eco-app">
      ${sidebar({ active: active || 'gobierno' })}
      <div class="eco-main">
        ${header({ title, eyebrow, period })}
        <main class="eco-page">
          ${content || ''}
          <div class="eco-page-foot">${(M.meta && M.meta.disclaimer) || 'Datos ilustrativos · mockup de diseño'}</div>
        </main>
      </div>
    </div>`;
  }

  window.ECOShell = { sidebar, header, frame, icon };
})();

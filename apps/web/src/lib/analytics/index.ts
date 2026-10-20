/**
 * Puente tipado hacia `window.ecoTrack` (public/eco-analytics.js, que carga
 * GTM-KXWF94VP → GA4). Las páginas Next usan esto; la SPA llama a
 * `window.ecoTrack` directo. Plan de eventos: docs/analitica-gtm.md.
 */

type Params = Record<string, string | number | boolean | null | undefined>;

interface EcoAnalytics {
  pageView: (extra?: Params) => void;
  embedded: boolean;
}

declare global {
  interface Window {
    ecoTrack?: (name: string, params?: Params | null, opts?: { callback?: () => void }) => void;
    ecoAnalytics?: EcoAnalytics;
  }
}

export function track(name: string, params?: Params): void {
  if (typeof window === 'undefined') return;
  window.ecoTrack?.(name, params);
}

/** page_view de una ruta Next. Los paneles embebidos en la SPA no cuentan como página. */
export function trackPageView(): void {
  if (typeof window === 'undefined') return;
  const a = window.ecoAnalytics;
  if (!a || a.embedded) return;
  a.pageView();
}

/**
 * Deja un evento para que la SPA lo emita al arrancar, cuando ya conoce al
 * usuario (user_id). Para login / sign_up: el router navega a la SPA en el
 * mismo instante y el hit se perdería, o saldría sin identidad.
 */
export function trackAfterLogin(name: string, params?: Params): void {
  if (typeof window === 'undefined') return;
  try {
    const key = 'eco.analytics.pending';
    const list = JSON.parse(sessionStorage.getItem(key) || '[]');
    list.push({ event: name, params: params ?? {} });
    sessionStorage.setItem(key, JSON.stringify(list.slice(-5)));
  } catch {
    track(name, params);
  }
}

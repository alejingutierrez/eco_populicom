/**
 * WP-9b (spec interpretación v1, 11.5 y 11.7): tripwires del front (SPA
 * JSX → dist). Los componentes viven en scripts de navegador, así que aquí se
 * prueba lo que puede romperse sin que nadie lo vea: que compilen, que se
 * exporten, que haya UN solo toggle de pertinencia baja y que el cache-bust
 * suba (si no, el navegador sirve el bundle viejo).
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const DIR = path.resolve(__dirname, '../../public/eco-prototype');
const read = (f: string) => fs.readFileSync(path.join(DIR, f), 'utf8');

describe('front de interpretación v1 (WP-9b)', () => {
  it('shell.js y screens.js compilan con Babel (JSX)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const babel = require('@babel/core');
    for (const f of ['shell.js', 'screens.js']) {
      const out = babel.transformSync(read(f), {
        filename: f,
        presets: [['@babel/preset-env', { targets: { esmodules: true }, modules: false }], ['@babel/preset-react']],
        sourceType: 'script',
        compact: false,
      });
      expect(typeof out.code).toBe('string');
    }
  });

  it('shell.js exporta las piezas compartidas y screens.js las consume', () => {
    const shell = read('shell.js');
    const screens = read('screens.js');
    for (const name of ['MentionKindTag', 'MentionAdverseChip', 'MentionParent', 'PertinenceToggle', 'CompositionBar', 'BaseDeltaBadge', 'ecoBaseDeltaInfo', 'ecoSentTip']) {
      expect(shell).toMatch(new RegExp(`function ${name}\\b`));
      expect(shell.slice(shell.indexOf('window.ECO_SHELL = {'))).toContain(name);
      // La línea de desestructuración de screens.js (no una ventana fija de caracteres).
      const line = screens.split('\n').find((l) => /=\s*window\.ECO_SHELL;/.test(l) && l.includes(name));
      expect({ name, consumed: !!line }).toEqual({ name, consumed: true });
    }
  });

  it('hay un solo toggle de pertinencia baja: el chip suelto del modal ya no existe', () => {
    const shell = read('shell.js');
    expect(shell).not.toContain('+ Incluir baja pertinencia');
    expect(shell).toContain('<PertinenceToggle');
    expect(read('screens.js')).toContain('<PertinenceToggle');
  });

  it('con una API anterior los controles nuevos de Menciones no se pintan', () => {
    expect(read('screens.js')).toContain('const apiV2 = !!data.universe;');
  });

  it('el chip «con hecho adverso» solo se ofrece con la rúbrica v2 (adverseAvailable), no con solo `universe`', () => {
    const screens = read('screens.js');
    expect(screens).toContain('data.adverseAvailable === true || adverse');
    // El estado de la lista tiene que CONSERVAR el campo que manda la API (si no, el chip nunca aparece).
    expect(screens).toContain('adverseAvailable: j.adverseAvailable === true');
    expect(screens).toMatch(/\{adverseOffer && <button/);
    expect(screens).not.toMatch(/\{apiV2 && <button[^\n]*adverse/);
  });

  it('el tipo de mención usa las cuatro etiquetas del spec', () => {
    const shell = read('shell.js');
    for (const label of ['Comentario', 'Publicación de la agencia', 'Nota de prensa', 'Tercero']) expect(shell).toContain(`label: '${label}'`);
    expect(shell).toContain('reacción tardía');
    expect(shell).toContain('postura crítica hacia la agencia');
  });

  it('el cache-bust del prototipo es prodc103 o mayor', () => {
    const m = read('index.html').match(/\?v=prodc(\d+)'/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(103);
  });

  it('tokens.css declara los estilos de WP-9b sin colores literales', () => {
    const css = read('tokens.css');
    const sec = css.slice(css.indexOf('9 · INTERPRETACIÓN v1'));
    expect(sec).toContain('.eco-kind');
    expect(sec).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(sec).not.toMatch(/rgba?\(/);
  });

  it('el panel de calidad pide sus datos a /api/admin/quality y ya no depende de ECO_DATA.QUALITY', () => {
    const screens = read('screens.js');
    expect(screens).toContain('/api/admin/quality?');
    expect(screens).not.toContain('D.QUALITY');
    // Se muestra con la MISMA capacidad que exige el endpoint.
    expect(screens).toMatch(/k: 'calidad'[^\n]*cap: 'manage_users'/);
  });
});

/**
 * /api/admin/quality: sesión + manage_users, en las dos listas del middleware y
 * en el handler (feedback RBAC: el gate va en los dos lados).
 */
describe('/api/admin/quality — gate en los dos lados', () => {
  const root = path.resolve(__dirname, '../..');
  const mw = fs.readFileSync(path.join(root, 'src/middleware.ts'), 'utf8');
  const route = fs.readFileSync(path.join(root, 'src/app/api/admin/quality/route.ts'), 'utf8');

  it('está en PROTECTED_PATHS (exige sesión) y en config.matcher (invoca el middleware)', () => {
    const block = mw.slice(mw.indexOf('const PROTECTED_PATHS'), mw.indexOf('function isProtected'));
    expect(block).toContain('/^\\/api\\/admin\\/quality(\\/.*)?$/');
    const matcher = mw.slice(mw.indexOf('export const config'));
    expect(matcher).toContain("'/api/admin/quality'");
    expect(matcher).toContain("'/api/admin/quality/:path*'");
  });

  it('el handler exige la capacidad manage_users antes de leer nada', () => {
    expect(route).toContain("requireCapability('manage_users')");
    expect(route.indexOf("requireCapability('manage_users')")).toBeLessThan(route.indexOf('await resolveAgencyId('));
  });
});

/**
 * Render REAL de las piezas compartidas (shell.js compilado con Babel y
 * ejecutado en un contexto sin navegador): lo que un tripwire de cadenas no ve.
 */
describe('render de las piezas compartidas (shell.js)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const babel = require('@babel/core');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { renderToStaticMarkup } = require('react-dom/server');

  const load = () => {
    const code = babel.transformSync(read('shell.js'), { filename: 'shell.js', presets: [['@babel/preset-react']], sourceType: 'script' }).code;
    const store: Record<string, string> = {};
    const win: Record<string, unknown> = {
      React, Icons: new Proxy({}, { get: () => () => null }), innerWidth: 1280,
      addEventListener() {}, removeEventListener() {}, requestAnimationFrame: () => 0,
      matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
      location: { search: '', pathname: '/' }, ECO_DATA: {},
      localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = String(v); }, removeItem: (k: string) => { delete store[k]; } },
      document: { addEventListener() {}, documentElement: { dataset: {} }, body: {} },
    };
    win.window = win;
    const ctx = vm.createContext(win);
    (ctx as Record<string, unknown>).React = React;
    vm.runInContext(code, ctx);
    return win.ECO_SHELL as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const html = (el: unknown) => renderToStaticMarkup(el as never);
  const kinds = (c: Record<string, number>, total: number) => ({ comment: 0, agency_post: 0, article: 0, third_party_post: 0, ...c, total });

  it('la barra de composición tiene UN tramo por tipo de mención, con su conteo y su drill-down', () => {
    const S = load();
    const out = html(React.createElement(S.CompositionBar, {
      composition: { universe: { label: 'solo pertinencia alta o media' }, byKind: { current: kinds({ comment: 578, agency_post: 20, article: 60, third_party_post: 40 }, 698), previous: kinds({ comment: 37, agency_post: 10, article: 40, third_party_post: 33 }, 120) } },
      onPick: () => undefined,
    }));
    for (const k of ['comment', 'agency_post', 'article', 'third_party_post']) expect(out).toContain(`data-seg="${k}"`);
    expect((out.match(/class="eco-comp-seg"/g) || []).length).toBe(4);
    for (const l of ['Comentarios de usuarios', 'Publicaciones de la agencia', 'Notas de prensa', 'Terceros']) expect(out).toContain(l);
    expect(out).toContain('82.8%');           // 578 / 698 (es-PR usa punto decimal)
    expect(out).toContain('▲ 52 pts');        // 82.8 vs 30.8 del periodo previo
    expect(out).toContain('solo pertinencia alta o media');
  });

  it('sin byKind (API anterior) cae a dos tramos con commentShare', () => {
    const S = load();
    const out = html(React.createElement(S.CompositionBar, {
      composition: { universe: { label: 'x' }, commentShare: { current: { comments: 6, total: 10, pct: 60 }, previous: { comments: 1, total: 10, pct: 10 }, deltaPts: 50 } },
    }));
    expect((out.match(/class="eco-comp-seg"/g) || []).length).toBe(2);
    expect(out).toContain('data-seg="rest"');
  });

  it('sin datos no pinta nada (ni ceros ni «sin dato»)', () => {
    const S = load();
    expect(html(React.createElement(S.CompositionBar, { composition: { universe: { label: 'x' }, byKind: { current: kinds({}, 0), previous: kinds({}, 0) } } }))).toBe('');
    expect(html(React.createElement(S.CompositionBar, { composition: null }))).toBe('');
  });

  it('el padre en fila (dentro de un <button>) es un <span>, nunca un <div>', () => {
    const S = load();
    const m = { mentionKind: 'comment', lateReaction: true, parentAgeDays: 6.1, parent: { author: 'Página', publishedAt: '2026-10-26T15:00:00.000Z', text: 'Texto del post' } };
    const row = html(React.createElement(S.MentionParent, { m, inline: true }));
    expect(row.startsWith('<span')).toBe(true);
    expect(row).not.toContain('<div');
    expect(row).toContain('reacción tardía');
    const full = html(React.createElement(S.MentionParent, { m }));
    expect(full).toContain('<details');
    expect(full).toContain('Responde a la publicación de');
  });
});

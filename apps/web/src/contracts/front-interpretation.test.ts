/**
 * WP-9b (spec interpretación v1, 11.5 y 11.7): tripwires del front (SPA
 * JSX → dist). Los componentes viven en scripts de navegador, así que aquí se
 * prueba lo que puede romperse sin que nadie lo vea: que compilen, que se
 * exporten, que haya UN solo toggle de pertinencia baja y que el cache-bust
 * suba (si no, el navegador sirve el bundle viejo).
 */
import fs from 'node:fs';
import path from 'node:path';

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
      expect(screens.slice(0, 1500)).toContain(name);
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

  it('el tipo de mención usa las cuatro etiquetas del spec', () => {
    const shell = read('shell.js');
    for (const label of ['Comentario', 'Publicación de la agencia', 'Nota de prensa', 'Tercero']) expect(shell).toContain(`label: '${label}'`);
    expect(shell).toContain('reacción tardía');
    expect(shell).toContain('postura crítica hacia la agencia');
  });

  it('el cache-bust del prototipo es prodc101 o mayor', () => {
    const m = read('index.html').match(/\?v=prodc(\d+)'/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(101);
  });

  it('tokens.css declara los estilos de WP-9b sin colores literales', () => {
    const css = read('tokens.css');
    const sec = css.slice(css.indexOf('9 · INTERPRETACIÓN v1'));
    expect(sec).toContain('.eco-kind');
    expect(sec).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(sec).not.toMatch(/rgba?\(/);
  });
});

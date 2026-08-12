/**
 * Tests de la hoja de estilo del reporte imprimible. Corre con:
 *   node_modules/.bin/tsx --test packages/shared/src/report/print-styles.test.ts
 *
 * POR QUÉ EXISTEN: la hoja vive dentro de un template literal, así que un
 * backtick escrito en un comentario CSS CIERRA la cadena y rompe el parseo del
 * módulo entero. Pasó dos veces durante el desarrollo (un comentario sobre
 * 'tabular-nums', otro sobre '.section > *') y el error que sale es
 * "Unexpected *" en una línea de CSS, que no apunta a la causa.
 *
 * Las demás pruebas fijan propiedades de impresión que, si se pierden en una
 * edición, degradan el PDF sin que nada falle visiblemente en pantalla.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPORT_STYLES, REPORT_FONT_LINK } from './print-styles';

// ---- integridad del template ----------------------------------------------

test('la hoja no contiene backticks', () => {
  assert.equal(
    REPORT_STYLES.includes('`'),
    false,
    'un backtick dentro de REPORT_STYLES cierra el template literal: usa comillas simples en los comentarios CSS',
  );
});

test('la hoja no contiene interpolaciones sin resolver', () => {
  assert.equal(REPORT_STYLES.includes('${'), false);
});

// ---- caja de página --------------------------------------------------------

test('declara la caja de página Letter con márgenes', () => {
  assert.match(REPORT_STYLES, /@page\s*\{[^}]*size:\s*Letter/);
  assert.match(REPORT_STYLES, /@page\s*\{[^}]*margin:/);
});

test('fuerza la impresión de color', () => {
  // Sin esto Chrome lava los rellenos y el documento sale gris.
  assert.ok(REPORT_STYLES.includes('print-color-adjust: exact'));
});

test('oculta la barra de acciones al imprimir', () => {
  assert.match(REPORT_STYLES, /@media print[\s\S]*\.toolbar[^}]*display:\s*none/);
});

// ---- control de saltos -----------------------------------------------------

test('deja partir los contenedores largos entre páginas', () => {
  // Una tabla de 52 filas o un análisis de cuatro párrafos NO pueden llevar
  // break-inside: avoid — el navegador deja media hoja en blanco intentándolo.
  assert.match(REPORT_STYLES, /\.section > table\.rp[\s\S]{0,120}break-inside:\s*auto/);
});

test('repite el encabezado de tabla en cada página impresa', () => {
  assert.ok(REPORT_STYLES.includes('display: table-header-group'));
});

test('protege las unidades atómicas de lectura', () => {
  for (const cls of ['.kpi', '.fig', '.topic-card', '.finding', '.signal', '.thesis']) {
    const re = new RegExp(`\\${cls}\\b[^{]*\\{[^}]*break-inside:\\s*avoid`);
    assert.match(REPORT_STYLES, re, `${cls} debería llevar break-inside: avoid`);
  }
});

test('los títulos de sección no quedan huérfanos al pie', () => {
  assert.match(REPORT_STYLES, /\.sec-head[^{]*\{[^}]*break-after:\s*avoid/);
});

// ---- tipografía ------------------------------------------------------------

test('carga las tres familias de la marca desde el host que permite el CSP', () => {
  // El CSP del middleware sólo autoriza fonts.googleapis.com / fonts.gstatic.com.
  assert.ok(REPORT_FONT_LINK.startsWith('https://fonts.googleapis.com/'));
  for (const family of ['Besley', 'Krub', 'IBM+Plex+Mono']) {
    assert.ok(REPORT_FONT_LINK.includes(family), `falta la familia ${family}`);
  }
});

test('el cuerpo de texto se declara en puntos, no en píxeles', () => {
  // El papel se mide en puntos; una escala en px imprime a un tamaño que depende
  // del DPI que asuma el navegador.
  assert.match(REPORT_STYLES, /--rp-fs-body:\s*[\d.]+pt/);
  assert.match(REPORT_STYLES, /--rp-fs-h1:\s*[\d.]+pt/);
});

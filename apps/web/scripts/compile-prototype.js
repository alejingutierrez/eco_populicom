#!/usr/bin/env node
/*
 * Pre-compiles the React+JSX prototype files into plain browser JavaScript so
 * the dashboard no longer pays a 2-3s Babel-in-browser cost on every load.
 *
 *  public/eco-prototype/{data,icons,charts,shell,screens,app}.js
 *   ->
 *  public/eco-prototype/dist/{same-name}.js
 *
 * Runs as a `prebuild` step. Safe to run multiple times.
 */
const fs = require('node:fs');
const path = require('node:path');
const babel = require('@babel/core');

const SRC_DIR = path.resolve(__dirname, '..', 'public', 'eco-prototype');
const OUT_DIR = path.resolve(SRC_DIR, 'dist');
const FILES = ['data.js', 'icons.js', 'charts.js', 'shell.js', 'screens.js', 'app.js'];

fs.mkdirSync(OUT_DIR, { recursive: true });

let failed = false;
for (const file of FILES) {
  const input = path.join(SRC_DIR, file);
  const output = path.join(OUT_DIR, file);
  try {
    const src = fs.readFileSync(input, 'utf8');
    const result = babel.transformSync(src, {
      filename: input,
      presets: [
        ['@babel/preset-env', { targets: { esmodules: true }, modules: false }],
        ['@babel/preset-react'],
      ],
      sourceType: 'script',
      compact: false,
    });
    if (!result || typeof result.code !== 'string') throw new Error('Babel returned no code');
    fs.writeFileSync(output, `/* ECO prototype — pre-compiled from ${file} */\n${result.code}\n`, 'utf8');
    const bytes = Buffer.byteLength(result.code);
    console.log(`[eco] compiled ${file.padEnd(12)} -> dist/${file} (${bytes} bytes)`);
  } catch (err) {
    console.error(`[eco] FAILED to compile ${file}:`, err.message);
    failed = true;
  }
}

if (failed) process.exit(1);

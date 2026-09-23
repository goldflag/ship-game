import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { StartupScreen } from './StartupScreen';

/** Tags and attributes as the browser reads them: no comments, no `<noscript>`, no layout whitespace. */
const normalized = (html: string) => html.replace(/<!--[\s\S]*?-->|<noscript>[\s\S]*?<\/noscript>/g, '').replace(/>\s+</g, '><').replace(/(--[\w-]+):\s*/g, '$1:').trim();

test('index.html draws the same loader React mounts over it, so the swap is invisible', () => {
  // The static loader stands until the bundle loads; startup measurements (scripts/diagnostics/measure-*.mjs) read `.startup-status`.
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const loader = /<section class="startup-screen"[\s\S]*?<\/section>/.exec(html)?.[0];
  expect(loader).toBeDefined();
  const label = /aria-valuetext="([^"]*)"/.exec(loader!)![1], progress = Number(/--p:\s*([\d.]+)/.exec(loader!)![1]);
  expect(normalized(renderToStaticMarkup(<StartupScreen label={label} progress={progress} />))).toBe(normalized(loader!));
  expect(loader).toContain(`<p class="startup-status" role="status">${label}…</p>`);
});

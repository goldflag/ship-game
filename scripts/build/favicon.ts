import type { Connect, Plugin } from 'vite';

/** Chromium asks every page it loads for `/favicon.ico`. Neither the game nor its diagnostics pages have one, so each load
 * logged "Failed to load resource: the server responded with a status of 404" on the console, which every script that
 * collects console errors reported as a page error (and `grep -v 404` then hid real results containing "404").
 * The dev and preview servers answer it with 204 No Content, which Chromium takes as "no icon" without a message. */
export function noFavicon(): Plugin {
  return {
    name: 'no-favicon',
    configureServer(server) { server.middlewares.use(answerFavicon(server.config.base)); },
    configurePreviewServer(server) { server.middlewares.use(answerFavicon(server.config.base)); },
  };
}

/** The middleware alone: `/favicon.ico` (and the same under the base path) gets 204; everything else passes on. */
export function answerFavicon(base = '/'): Connect.NextHandleFunction {
  const paths = new Set(['/favicon.ico', `${base.replace(/\/?$/, '/')}favicon.ico`]);
  return (request, response, next) => {
    if (!paths.has((request.url ?? '').split('?')[0])) return next();
    response.statusCode = 204;
    response.setHeader('Cache-Control', 'max-age=86400');
    response.end();
  };
}

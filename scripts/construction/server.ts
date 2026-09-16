import type { Plugin } from 'vite';
import { randomBytes } from 'node:crypto';
import { repositoryStore, readSource, constructionId } from './files';
import { compileConstruction } from './compiler';
import { applyConstructionBatch, type ConstructionBatch } from '../../src/ships/constructionCommands';

/** Local authoring only. Not installed in the production server or online protocol. */
export function constructionFiles(root: string): Plugin {
  const token = randomBytes(24).toString('hex'), store = repositoryStore(root);
  return {
    name: 'construction-files',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith('/__construction')) return next();
        const send = (status: number, value: unknown) => { response.statusCode = status; response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store'); response.end(JSON.stringify(value)); };
        const remote = request.socket.remoteAddress;
        const host = request.headers.host ?? '';
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote ?? '') || !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return send(403, { error: 'Repository authoring accepts loopback connections only.' });
        if (request.headers.origin && request.headers.origin !== 'http://' + host) return send(403, { error: 'Cross-origin authoring is disabled.' });
        try {
          const [, id, operation] = url.pathname.slice('/__construction'.length).split('/');
          if (!id && request.method === 'GET') return send(200, { token, designs: await store.list() });
          constructionId(id);
          if (request.method === 'GET') {
            if (operation === 'revisions') return send(200, await store.revisions(id));
            if (operation === 'compile') return send(200, await compileConstruction(root, (await readSource(root, id)).source));
            if (operation) return send(404, { error: 'Unknown construction endpoint.' });
            return send(200, await store.load(id));
          }
          if (request.method !== 'PUT' || request.headers['x-construction-token'] !== token || !request.headers['content-type']?.startsWith('application/json')) return send(403, { error: 'A same-origin authoring session is required.' });
          const chunks: Buffer[] = []; let size = 0;
          for await (const chunk of request) { size += chunk.length; if (size > 17 * 1024 * 1024) throw new Error('Source request exceeds 17 MB.'); chunks.push(Buffer.from(chunk)); }
          const input = JSON.parse(Buffer.concat(chunks).toString());
          if (operation === 'batch') {
            const current = await readSource(root, id);
            if (input.expectedRevisionId !== current.hash) return send(409, { code: 'conflict', error: 'Repository source changed. Inspect it before applying this batch.' });
            const source = applyConstructionBatch(current.source, input.batch as ConstructionBatch);
            return send(200, await store.save({ designId: id, source, name: source.name, schemaVersion: source.schemaVersion, catalogRevision: source.construction.catalogRevision, expectedRevisionId: input.expectedRevisionId }));
          }
          if (operation || input.designId !== id) throw new Error('Save ID and endpoint must agree.');
          return send(200, await store.save(input));
        } catch (cause) {
          const error = cause as Error & { code?: string };
          send(error.code === 'conflict' ? 409 : error.code === 'ENOENT' ? 404 : 400, { error: error.message, code: error.code });
        }
      });
    },
  };
}

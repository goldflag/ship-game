import { describe, expect, test } from 'bun:test';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { answerFavicon } from './favicon';

function request(handler: ReturnType<typeof answerFavicon>, url: string) {
  const response = { statusCode: 200, ended: false, setHeader() {}, end() { this.ended = true; } };
  let passed = false;
  handler({ url } as IncomingMessage, response as unknown as ServerResponse, () => { passed = true; });
  return { status: response.ended ? response.statusCode : undefined, passed };
}

describe('answerFavicon', () => {
  test('answers the favicon with 204 and passes everything else on', () => {
    const handler = answerFavicon('/');
    expect(request(handler, '/favicon.ico')).toEqual({ status: 204, passed: false });
    expect(request(handler, '/favicon.ico?v=2')).toEqual({ status: 204, passed: false });
    expect(request(handler, '/scripts/diagnostics/ocean-waves.html')).toEqual({ status: undefined, passed: true });
    expect(request(handler, '/models/favicon.ico.json')).toEqual({ status: undefined, passed: true });
  });
  test('answers it under a base path too', () => {
    const handler = answerFavicon('/naval/');
    expect(request(handler, '/naval/favicon.ico').status).toBe(204);
    expect(request(handler, '/favicon.ico').status).toBe(204);
  });
});

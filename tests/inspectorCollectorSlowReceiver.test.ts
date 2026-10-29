import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { request } from '../src/collector/metadata-sync';

test('collector receives an acknowledgement when processing takes longer than ten seconds', async () => {
  const server = createServer((incoming, outgoing) => {
    incoming.resume();
    incoming.on('end', () => {
      setTimeout(() => {
        outgoing.writeHead(200, { 'content-type': 'application/json' });
        outgoing.end(JSON.stringify({ acknowledgedSequence: '200' }));
      }, 11000);
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await request(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, '/v2/batches', { schemaVersion: '2' });
    assert.equal(result.acknowledgedSequence, '200');
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('collector receives successive acknowledgements when a tunnel closes reused sockets', async () => {
  const used = new Set<import('node:net').Socket>();
  const server = createServer((incoming, outgoing) => {
    if (used.has(incoming.socket)) { incoming.socket.destroy(); return; }
    used.add(incoming.socket);
    incoming.resume();
    incoming.on('end', () => {
      outgoing.writeHead(200, { 'content-type': 'application/json' });
      outgoing.end(JSON.stringify({ acknowledgedSequence: '200' }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (let i = 0; i < 4; i++) {
      const result = await request(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, '/v2/batches', { schemaVersion: '2' });
      assert.equal(result.acknowledgedSequence, '200');
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

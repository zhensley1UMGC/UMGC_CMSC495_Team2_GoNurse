import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { preview } from 'vite';
import config from '../vite.config.js';

let directory;
let backend;
let frontend;
let origin;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'gonurse-preview-'));
  await mkdir(join(directory, 'dist'));
  await writeFile(join(directory, 'dist', 'index.html'), 'main entry');
  await writeFile(join(directory, 'dist', 'tabbed.html'), 'tabbed entry');
  backend = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ path: request.url }));
  });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  expect(config.preview.proxy['/api']).toBe('http://127.0.0.1:8000');
  frontend = await preview({
    configFile: false,
    root: directory,
    preview: {
      ...config.preview,
      host: '127.0.0.1',
      port: 0,
      strictPort: true,
      proxy: { ...config.preview.proxy, '/api': `http://127.0.0.1:${backend.address().port}` },
    },
  });
  origin = `http://127.0.0.1:${frontend.httpServer.address().port}`;
});

afterAll(async () => {
  if (frontend) await new Promise((resolve, reject) => frontend.httpServer.close(error => error ? reject(error) : resolve()));
  if (backend) await new Promise((resolve, reject) => backend.close(error => error ? reject(error) : resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
});

it('serves both built entry points and forwards API requests', async () => {
  expect(await (await fetch(`${origin}/`)).text()).toBe('main entry');
  expect(await (await fetch(`${origin}/tabbed.html`)).text()).toBe('tabbed entry');
  expect(await (await fetch(`${origin}/api/v1/profile`)).json()).toEqual({ path: '/api/v1/profile' });
});

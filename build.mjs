// Build and preview, using esbuild directly (no framework).
//   node build.mjs           → production build in dist/
//   node build.mjs serve     → build, then serve dist/ at http://localhost:4173 (rebuilds on change)
import * as esbuild from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, watch, writeFileSync } from 'node:fs';
import http from 'node:http';
import { extname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const mode = process.argv[2] ?? 'build';
const OUT = 'dist';

async function build() {
  const t0 = Date.now();
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, 'assets'), { recursive: true });
  cpSync('public', OUT, { recursive: true });

  // browser bundles
  const res = await esbuild.build({
    entryPoints: { main: 'src/main.ts', align: 'src/align.ts' },
    bundle: true,
    format: 'esm',
    splitting: true,
    outdir: join(OUT, 'assets'),
    entryNames: '[name]-[hash]',
    chunkNames: 'chunk-[hash]',
    assetNames: '[name]-[hash]',
    loader: { '.woff': 'file', '.png': 'file' },
    target: ['es2020', 'safari15'],
    minify: true,
    sourcemap: false,
    metafile: true,
    legalComments: 'none',
    logLevel: 'warning',
  });
  const outs = Object.entries(res.metafile.outputs);
  const rel = (f) => relative(OUT, f).split('\\').join('/');
  const entry = (name) => rel(outs.find(([, o]) => o.entryPoint === `src/${name}.ts`)[0]);
  const cssOf = (name) => {
    const o = outs.find(([, x]) => x.entryPoint === `src/${name}.ts`);
    return o && o[1].cssBundle ? rel(o[1].cssBundle) : null;
  };
  const font = rel(outs.find(([f]) => f.endsWith('.woff'))[0]);

  // static HTML from content.ts (bundled for node, then executed)
  const tmp = join(OUT, '.page.mjs');
  await esbuild.build({ entryPoints: ['src/render-html.ts'], bundle: true, platform: 'node', format: 'esm', outfile: tmp, logLevel: 'warning' });
  const { html, alignHtml } = await import(pathToFileURL(join(process.cwd(), tmp)).href + `?t=${Date.now()}`);
  writeFileSync(join(OUT, 'index.html'), html({ js: entry('main'), css: cssOf('main'), font }));
  writeFileSync(join(OUT, 'align.html'), alignHtml({ js: entry('align'), css: cssOf('main'), font }));
  rmSync(tmp);

  // a body-only copy of the page, for hosts that wrap pages in their own document
  if (mode === 'artifact') {
    const full = readFileSync(join(OUT, 'index.html'), 'utf8');
    const pick = (re) => (full.match(re) || [''])[0];
    const body = full.slice(full.indexOf('<body>') + 6, full.lastIndexOf('</body>'));
    const page = [
      '<title>Behind the Armor</title>',
      '<meta name="claude:viewport-fit-sides" content="cover">',
      pick(/<meta name="description"[^>]*>/),
      '<meta name="theme-color" content="#080808">',
      pick(/<link rel="preload"[^>]*>/),
      pick(/<link rel="stylesheet"[^>]*>/),
      pick(/<script>document[\s\S]*?<\/script>/),
      body,
    ].join('\n');
    writeFileSync(join(OUT, 'index.html'), page);
  }

  let bytes = 0;
  for (const [f, o] of outs) if (!f.endsWith('.map')) bytes += o.bytes;
  console.log(`built in ${Date.now() - t0} ms; JS+CSS+font+grain ${(bytes / 1024).toFixed(1)} KB`);
}

await build();

if (mode === 'serve') {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.txt': 'text/plain',
  };
  const port = Number(process.env.PORT || 4173);
  http
    .createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const f = join(OUT, p);
      if (!f.startsWith(OUT) || !existsSync(f) || !statSync(f).isFile()) {
        res.writeHead(404).end('Not found');
        return;
      }
      const size = statSync(f).size;
      const type = types[extname(f)] || 'application/octet-stream';
      // byte ranges, so video seeks and Safari playback work
      const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
      if (range) {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Number(range[2]) : size - 1;
        res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
        res.end(readFileSync(f).subarray(start, end + 1));
        return;
      }
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
      res.end(readFileSync(f));
    })
    .listen(port, () => console.log(`serving dist/ at http://localhost:${port}`));
  let timer;
  for (const dir of ['src', 'public']) {
    watch(dir, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => build().catch((e) => console.error(e.message)), 120);
    });
  }
}

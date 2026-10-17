// Bundles the XBT Live client into dist/. jam-core comes straight from this
// repo's ui/ (Corny Chat's fork of Jam), so the audio protocol always matches
// what cornychat.com runs.
import * as esbuild from 'esbuild';
import {cpSync, mkdirSync, readdirSync, rmSync} from 'node:fs';

const serve = process.argv.includes('--serve');
mkdirSync('dist', {recursive: true});
// keep dist/.vercel, the Vercel project link, across builds
for (const f of readdirSync('dist')) if (f !== '.vercel') rmSync(`dist/${f}`, {recursive: true, force: true});
cpSync('public', 'dist', {recursive: true});

const options = {
  entryPoints: ['src/app.js'],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  outdir: 'dist/js',
  splitting: true,
  minify: !serve,
  sourcemap: serve,
  define: {'process.env.NODE_ENV': '"production"', global: 'window'},
  nodePaths: ['node_modules', '../ui/node_modules'],
  logLevel: 'info',
};

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const {port} = await ctx.serve({servedir: 'dist', port: 8830});
  console.log(`http://localhost:${port}`);
} else {
  await esbuild.build(options);
}

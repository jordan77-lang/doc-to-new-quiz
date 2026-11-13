// Optional: bundles src/ into a single dist/bundle.js (IIFE) for hosting without ES modules.
// index.html loads src/main.js directly, so this is only needed if you switch it to the bundle.
// PapaParse, SheetJS, JSZip and FileSaver stay as CDN <script> globals.
import * as esbuild from 'esbuild';

try {
  await esbuild.build({
    entryPoints: ['src/main.js'],
    bundle: true,
    outfile: 'dist/bundle.js',
    format: 'iife',
    minify: true,
    target: ['es2020'],
  });
  console.log('Build complete: dist/bundle.js');
} catch (err) {
  console.error('Build failed:', err);
  process.exit(1);
}

import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const embeddedFonts = new Set([
  '/assets/fonts/source-sans-3-normal-latin.woff2',
  '/assets/fonts/source-serif-4-normal-latin.woff2'
]);
const pageAssets = {
  'index.html': {
    styles: ['/assets/cookie-consent.css'],
    scripts: ['/assets/cookie-consent.js', '/assets/configurator.js']
  },
  'mobil.html': {
    styles: ['/assets/configurator-mobile.css', '/assets/mobile.css', '/assets/cookie-consent.css'],
    scripts: ['/assets/cookie-consent.js', '/assets/configurator.js', '/assets/mobile.js']
  }
};

function localAsset(reference, source) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference)) return null;
  const resource = reference.split(/[?#]/)[0];
  if (!resource) return null;
  const resolved = path.posix.resolve('/', path.posix.dirname(source), resource);
  return resolved;
}

async function requireAsset(reference, source) {
  const asset = localAsset(reference, source);
  if (!asset) return;
  const info = await stat(path.join(root, asset.slice(1))).catch(() => null);
  if (!info?.isFile()) throw new Error('Missing resource in ' + source + ': ' + reference);
}

async function validateCss(css, source) {
  for (const match of css.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)) {
    await requireAsset(match[2], source);
  }
}

async function walk(directory) {
  const result = [];
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const name = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(name));
    else if (entry.isFile()) result.push(name);
  }
  return result;
}

const topLevel = (await readdir(root)).filter(name => /\.html$/.test(name) || ['robots.txt', 'sitemap.xml'].includes(name));
const publicFiles = [...topLevel, ...await walk('assets'), ...await walk('news')];

// Stop deployment if an HTML or CSS resource is absent from the repository.
for (const file of publicFiles) {
  if (!/\.(html|css)$/.test(file)) continue;
  const source = '/' + file;
  const content = await readFile(path.join(root, file), 'utf8');
  if (file.endsWith('.css')) {
    await validateCss(content, source);
    continue;
  }
  for (const match of content.matchAll(/<(script|img|source|link)\b[^>]*>/gi)) {
    const tag = match[0];
    if (match[1].toLowerCase() === 'link' && !/\brel=["'](?:stylesheet|preload)["']/i.test(tag)) continue;
    const reference = tag.match(/\b(?:src|href)=["']([^"']+)["']/i)?.[1];
    if (reference) await requireAsset(reference, source);
    const srcset = tag.match(/\bsrcset=["']([^"']+)["']/i)?.[1];
    if (srcset) {
      for (const candidate of srcset.split(',')) await requireAsset(candidate.trim().split(/\s+/)[0], source);
    }
  }
  for (const style of content.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    await validateCss(style[1], source);
  }
}

async function inlineCss(asset, embedFonts) {
  let css = await readFile(path.join(root, asset.slice(1)), 'utf8');
  const matches = [...css.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)];
  for (const match of matches) {
    const reference = localAsset(match[2], asset);
    if (!reference) continue;
    let target = reference;
    if (embedFonts && embeddedFonts.has(reference)) {
      const font = await readFile(path.join(root, reference.slice(1)));
      if (font.subarray(0, 4).toString() !== 'wOF2') throw new Error('Invalid WOFF2 font: ' + reference);
      target = 'data:font/woff2;base64,' + font.toString('base64');
    }
    css = css.replace(match[0], 'url("' + target + '")');
  }
  return css.replace(/<\/style/gi, '<\\/style');
}

async function bundlePage(file, options) {
  let html = await readFile(path.join(root, file), 'utf8');
  for (const asset of options.styles) {
    const escaped = asset.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp('<link\\b(?=[^>]*\\brel=["\']stylesheet["\'])(?=[^>]*\\bhref=["\']' + escaped + '["\'])[^>]*>', 'i');
    if (!pattern.test(html)) throw new Error('Missing stylesheet reference: ' + file + ' ' + asset);
    html = html.replace(pattern, () => '<style data-inline-source="' + asset + '">\n' + cssCache.get(file + asset) + '\n</style>');
  }
  const scripts = [];
  for (const asset of options.scripts) {
    const escaped = asset.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp('<script\\b(?=[^>]*\\bsrc=["\']' + escaped + '["\'])[^>]*>\\s*</script>', 'i');
    if (!pattern.test(html)) throw new Error('Missing script reference: ' + file + ' ' + asset);
    html = html.replace(pattern, '');
    const js = (await readFile(path.join(root, asset.slice(1)), 'utf8')).replace(/<\/script/gi, '<\\/script');
    scripts.push('<script data-inline-source="' + asset + '">\n' + js + '\n</script>');
  }
  if (file === 'mobil.html') {
    html = html.replace(/<link\b(?=[^>]*\brel=["']preload["'])(?=[^>]*\bas=["']font["'])[^>]*>/gi, '');
  }
  // Run after the form exists, preserving the order of the original deferred scripts.
  html = html.replace(/<\/body>/i, () => scripts.join('\n') + '\n</body>');
  return html;
}

const cssCache = new Map();
for (const [file, options] of Object.entries(pageAssets)) {
  for (const asset of options.styles) cssCache.set(file + asset, await inlineCss(asset, file === 'mobil.html'));
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of publicFiles) {
  const destination = path.join(output, file);
  await mkdir(path.dirname(destination), { recursive: true });
  if (pageAssets[file]) await writeFile(destination, await bundlePage(file, pageAssets[file]));
  else await cp(path.join(root, file), destination);
}
console.log('Validated ' + publicFiles.length + ' public files. Homepage assets bundled for reliable rendering.');

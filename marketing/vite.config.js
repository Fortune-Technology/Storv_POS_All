import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

// SEO routes for the marketing site. Used to build sitemap.xml when indexing
// is allowed. Update this list when public marketing pages are added/removed.
const SEO_ROUTES = [
  { path: '/',         changefreq: 'weekly',  priority: '1.0' },
  { path: '/features', changefreq: 'monthly', priority: '0.9' },
  { path: '/pricing',  changefreq: 'monthly', priority: '0.9' },
  { path: '/about',    changefreq: 'monthly', priority: '0.7' },
  { path: '/contact',  changefreq: 'monthly', priority: '0.7' },
  { path: '/careers',  changefreq: 'weekly',  priority: '0.6' },
  { path: '/support',  changefreq: 'monthly', priority: '0.6' },
  { path: '/shop',     changefreq: 'weekly',  priority: '0.5' },
];

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Default to BLOCKED. A missing/typoed env var must never accidentally
  // expose a staging deploy to crawlers — operators have to opt in explicitly.
  const allowIndexing = env.VITE_ALLOW_INDEXING === 'true';
  const siteUrl = (env.VITE_SITE_URL || 'https://storeveu.com').replace(/\/+$/, '');

  // Cashier installer source — served as /downloads/StoreVeu-POS-Setup.exe
  // by both the dev server (middleware) and the production build (copied at
  // closeBundle). Whatever .exe currently lives in cashier-app/dist-electron
  // is the one that gets served — rebuild the cashier app and the marketing
  // site picks up the new file automatically on next dev refresh / build.
  const cashierDistDir = path.resolve(__dirname, '..', 'cashier-app', 'dist-electron');
  const findLatestExe = () => {
    try {
      const entries = fs.readdirSync(cashierDistDir);
      const exes = entries.filter(f => f.toLowerCase().endsWith('.exe'));
      if (!exes.length) return null;
      // Prefer files matching "StoreVeu POS Setup *.exe" (electron-builder
      // NSIS output). Fall back to any .exe if none match.
      const setup = exes.find(f => /StoreVeu.*Setup.*\.exe$/i.test(f));
      return path.join(cashierDistDir, setup || exes[0]);
    } catch {
      return null;
    }
  };

  return {
    plugins: [
      react(),
      {
        name: 'cashier-installer-passthrough',
        // Dev mode — serve the latest installer at /downloads/StoreVeu-POS-Setup.exe
        configureServer(server) {
          server.middlewares.use('/downloads/StoreVeu-POS-Setup.exe', (req, res, next) => {
            const exePath = findLatestExe();
            if (!exePath) { res.statusCode = 404; res.end('Installer not found — build cashier-app first'); return; }
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Disposition', 'attachment; filename="StoreVeu-POS-Setup.exe"');
            fs.createReadStream(exePath).pipe(res);
          });
        },
        // Build mode — copy the latest installer into dist/downloads/
        closeBundle() {
          const distDir = path.resolve(__dirname, 'dist');
          if (!fs.existsSync(distDir)) return;
          const exePath = findLatestExe();
          if (!exePath) {
            console.warn('[marketing] No cashier installer found in cashier-app/dist-electron — /downloads/StoreVeu-POS-Setup.exe will 404 in production');
            return;
          }
          const dlDir = path.join(distDir, 'downloads');
          if (!fs.existsSync(dlDir)) fs.mkdirSync(dlDir, { recursive: true });
          fs.copyFileSync(exePath, path.join(dlDir, 'StoreVeu-POS-Setup.exe'));
          console.info(`[marketing] Bundled installer: ${path.basename(exePath)} → dist/downloads/StoreVeu-POS-Setup.exe`);
        },
      },
      {
        name: 'seo-robots-and-sitemap',
        // Inject the robots meta tag into index.html at build + dev time.
        // This is the definitive signal for Google "noindex" — robots.txt
        // alone won't deindex pages discovered via backlinks.
        transformIndexHtml(html) {
          const metaRobots = allowIndexing
            ? '<meta name="robots" content="index, follow" />'
            : '<meta name="robots" content="noindex, nofollow" />';
          // Add canonical only when indexing is on; canonical on a noindex
          // page can confuse crawlers.
          const canonical = allowIndexing
            ? `\n    <link rel="canonical" href="${siteUrl}/" />`
            : '';
          return html.replace(
            '</head>',
            `    ${metaRobots}${canonical}\n  </head>`
          );
        },
        // Emit robots.txt + sitemap.xml into the build output.
        closeBundle() {
          const distDir = path.resolve(__dirname, 'dist');
          if (!fs.existsSync(distDir)) return;

          if (allowIndexing) {
            const robots = [
              'User-agent: *',
              'Allow: /',
              '',
              `Sitemap: ${siteUrl}/sitemap.xml`,
              '',
            ].join('\n');
            fs.writeFileSync(path.join(distDir, 'robots.txt'), robots);

            const urls = SEO_ROUTES.map(
              (r) =>
                `  <url><loc>${siteUrl}${r.path}</loc>` +
                `<changefreq>${r.changefreq}</changefreq>` +
                `<priority>${r.priority}</priority></url>`
            ).join('\n');
            const sitemap =
              '<?xml version="1.0" encoding="UTF-8"?>\n' +
              '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
              urls +
              '\n</urlset>\n';
            fs.writeFileSync(path.join(distDir, 'sitemap.xml'), sitemap);
          } else {
            // Block everything. No sitemap on a non-indexed deploy.
            const robots = ['User-agent: *', 'Disallow: /', ''].join('\n');
            fs.writeFileSync(path.join(distDir, 'robots.txt'), robots);
            // Remove a stale sitemap if a prior build wrote one.
            const stale = path.join(distDir, 'sitemap.xml');
            if (fs.existsSync(stale)) fs.unlinkSync(stale);
          }
        },
      },
    ],
    server: {
      port: 5176,
    },
  };
});

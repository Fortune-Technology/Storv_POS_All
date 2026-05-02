import { useEffect } from 'react';

export default function SEO({ title, description, url, type = 'website', jsonLd }) {
  useEffect(() => {
    // Title
    document.title = title ? `${title} — Storeveu` : 'Storeveu — Modern POS & Retail Platform';

    // Meta description
    setMeta('description', description || 'Storeveu is the complete retail platform for convenience, grocery, and liquor stores.');

    // Open Graph
    setMeta('og:title', title || 'Storeveu', 'property');
    setMeta('og:description', description || '', 'property');
    setMeta('og:url', url || 'https://storeveu.com', 'property');
    setMeta('og:type', type, 'property');

    // Twitter
    setMeta('twitter:title', title || 'Storeveu');
    setMeta('twitter:description', description || '');

    // Canonical
    let link = document.querySelector('link[rel="canonical"]');
    if (!link) { link = document.createElement('link'); link.rel = 'canonical'; document.head.appendChild(link); }
    link.href = url || 'https://storeveu.com';

    // JSON-LD structured data
    let script = document.getElementById('storeveu-jsonld');
    if (jsonLd) {
      if (!script) { script = document.createElement('script'); script.id = 'storeveu-jsonld'; script.type = 'application/ld+json'; document.head.appendChild(script); }
      script.textContent = JSON.stringify(jsonLd);
    } else if (script) {
      script.remove();
    }

    return () => {
      // Cleanup JSON-LD on unmount
      const s = document.getElementById('storeveu-jsonld');
      if (s) s.remove();
    };
  }, [title, description, url, type, jsonLd]);

  return null;
}

function setMeta(name, content, attr = 'name') {
  let el = document.querySelector(`meta[${attr}="${name}"]`);
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, name); document.head.appendChild(el); }
  el.content = content;
}

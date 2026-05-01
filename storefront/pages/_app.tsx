import { useEffect } from 'react';
import type { AppProps } from 'next/app';
import '../styles/globals.css';
import '../styles/cart-drawer.css';
import '../styles/templates.css';
import '../styles/product-detail-templates.css';
import '../components/ConfirmModal.css';
import { StoreProvider } from '../lib/store';
import { CartProvider } from '../lib/cart';
import { AuthProvider } from '../lib/auth';
import { ConfirmDialogProvider } from '../lib/useConfirmDialog.jsx';
import type { Store } from '@storeveu/types';

/**
 * Apply store branding (colors, fonts) as CSS custom properties.
 * This makes portal branding changes reflect on the storefront.
 */
// Map font family CSS value → Google Fonts URL name
const GOOGLE_FONT_MAP: Record<string, string> = {
  "'Inter', sans-serif": 'Inter',
  "'Poppins', sans-serif": 'Poppins',
  "'DM Sans', sans-serif": 'DM+Sans',
  "'Playfair Display', serif": 'Playfair+Display',
};

interface BrandingInjectorProps {
  store?: Store | null;
}

function BrandingInjector({ store }: BrandingInjectorProps) {
  useEffect(() => {
    if (!store?.branding) return;
    const b = store.branding;
    const root = document.documentElement;

    if (typeof b.primaryColor === 'string') {
      root.style.setProperty('--sf-primary', b.primaryColor);
      root.style.setProperty('--sf-primary-dark', darken(b.primaryColor, 15));
      root.style.setProperty('--sf-primary-light', lighten(b.primaryColor, 90));
    }
    const fontFamily = typeof b.fontFamily === 'string' ? b.fontFamily : undefined;
    if (fontFamily) {
      root.style.setProperty('--sf-font', fontFamily);

      // Load Google Font dynamically
      const fontName = GOOGLE_FONT_MAP[fontFamily];
      if (fontName) {
        const linkId = 'storeveu-google-font';
        let link = document.getElementById(linkId) as HTMLLinkElement | null;
        if (!link) {
          link = document.createElement('link');
          link.id = linkId;
          link.rel = 'stylesheet';
          document.head.appendChild(link);
        }
        link.href = `https://fonts.googleapis.com/css2?family=${fontName}:wght@400;500;600;700;800&display=swap`;
      }
    }
  }, [store?.branding]);

  return null;
}

function darken(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, (num >> 16) - Math.round(2.55 * percent));
  const g = Math.max(0, ((num >> 8) & 0x00ff) - Math.round(2.55 * percent));
  const b = Math.max(0, (num & 0x0000ff) - Math.round(2.55 * percent));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function lighten(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (num >> 16) + Math.round(2.55 * percent));
  const g = Math.min(255, ((num >> 8) & 0x00ff) + Math.round(2.55 * percent));
  const b = Math.min(255, (num & 0x0000ff) + Math.round(2.55 * percent));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * Every page passes its store in `pageProps.store` via getServerSideProps.
 * Not type-enforced because each page defines its own pageProps shape.
 */
interface SharedPageProps {
  store?: Store | null;
  [key: string]: unknown;
}

export default function App({ Component, pageProps }: AppProps<SharedPageProps>) {
  return (
    <StoreProvider store={pageProps.store || null}>
      <BrandingInjector store={pageProps.store} />
      <AuthProvider>
        <CartProvider>
          <ConfirmDialogProvider>
            <Component {...pageProps} />
          </ConfirmDialogProvider>
        </CartProvider>
      </AuthProvider>
    </StoreProvider>
  );
}

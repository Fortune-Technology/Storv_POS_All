/**
 * Template Renderer — maps templateId to the correct layout component.
 */

import { ComponentType } from 'react';
import HomeCenteredHero from './HomeCenteredHero';
import HomeSplitHero from './HomeSplitHero';
import HomeMinimal from './HomeMinimal';
import HomeOverlay from './HomeOverlay';
import HomeTypography from './HomeTypography';
import AboutStoryMission from './AboutStoryMission';
import AboutTimeline from './AboutTimeline';
import AboutCards from './AboutCards';
import AboutOverlay from './AboutOverlay';
import AboutMultiSection from './AboutMultiSection';
import ContactSplit from './ContactSplit';
import ContactCards from './ContactCards';
import ContactMinimal from './ContactMinimal';
import ContactMapForm from './ContactMapForm';
import ContactFloating from './ContactFloating';
import ProductDetailClassicSplit from './ProductDetailClassicSplit';
import ProductDetailModernStacked from './ProductDetailModernStacked';
import ProductDetailMinimalCentered from './ProductDetailMinimalCentered';
import ProductDetailFloatingCard from './ProductDetailFloatingCard';
import ProductDetailGalleryFocus from './ProductDetailGalleryFocus';
import type { TemplateProps } from '@storeveu/types';

type TemplateComponent = ComponentType<TemplateProps>;

const TEMPLATE_MAP: Record<string, TemplateComponent> = {
  // Home (5)
  'centered-hero': HomeCenteredHero,
  'split-hero': HomeSplitHero,
  'minimal-home': HomeMinimal,
  'overlay-hero': HomeOverlay,
  'bold-typography': HomeTypography,
  // Legacy IDs
  'modern-grid': HomeCenteredHero,
  'classic-store': HomeSplitHero,
  'minimal': HomeMinimal,
  'bold-banner': HomeOverlay,
  'split-feature': HomeSplitHero,
  // About (5)
  'story-mission': AboutStoryMission,
  'about-timeline': AboutTimeline,
  'about-cards': AboutCards,
  'about-overlay': AboutOverlay,
  'about-multi': AboutMultiSection,
  // Legacy
  'story-timeline': AboutStoryMission,
  'team-focused': AboutTimeline,
  'simple-text': AboutCards,
  // Contact (5)
  'contact-split': ContactSplit,
  'contact-cards': ContactCards,
  'contact-minimal': ContactMinimal,
  'contact-map': ContactMapForm,
  'contact-floating': ContactFloating,
  // Legacy
  'map-form': ContactMapForm,
  'split-layout': ContactSplit,
  'card-layout': ContactCards,
  // Product Detail (5)
  'product-classic-split':    ProductDetailClassicSplit,
  'product-modern-stacked':   ProductDetailModernStacked,
  'product-minimal-centered': ProductDetailMinimalCentered,
  'product-floating-card':    ProductDetailFloatingCard,
  'product-gallery-focus':    ProductDetailGalleryFocus,
};

type PageType = 'home' | 'about' | 'contact' | 'product';

const FALLBACKS: Record<PageType, TemplateComponent> = {
  home: HomeCenteredHero,
  about: AboutStoryMission,
  contact: ContactSplit,
  product: ProductDetailClassicSplit,
};

interface TemplateRendererProps extends TemplateProps {
  templateId?: string | null;
  pageType?: PageType | string;
}

export default function TemplateRenderer({
  templateId,
  pageType,
  content,
  store,
  products,
  departments,
  storeSlug,
  product,
}: TemplateRendererProps) {
  const Component =
    (templateId && TEMPLATE_MAP[templateId]) ||
    FALLBACKS[pageType as PageType];
  if (!Component) return null;
  return (
    <Component
      content={content}
      store={store}
      products={products}
      departments={departments}
      storeSlug={storeSlug}
      product={product}
    />
  );
}

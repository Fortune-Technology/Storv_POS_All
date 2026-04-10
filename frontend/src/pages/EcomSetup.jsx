import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

import { toast } from 'react-toastify';
import {
  Settings, Palette, FileText, Truck, Search, RefreshCw, BarChart3,
  LayoutGrid, Store, Minus, Columns, PanelTop,
  BookOpen, Users, Type, Map, SplitSquareHorizontal, CreditCard,
  Upload, Trash2, Eye, EyeOff, ChevronDown, ChevronUp, DollarSign, ShoppingCart, TrendingUp, Globe,
} from 'lucide-react';
import EcomDomain from './EcomDomain';
import './EcomSetup.css';

const ECOM_API = '/api/ecom';
const ECOM_UPLOADS = import.meta.env.VITE_ECOM_URL || 'http://localhost:5005';

function getHeaders(json = true) {
  const u = JSON.parse(localStorage.getItem('user') || '{}');
  const storeId = localStorage.getItem('activeStoreId') || '';
  const h = { Authorization: `Bearer ${u.token}`, 'X-Store-Id': storeId, 'X-Org-Id': u.orgId || u.tenantId || '' };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function api(method, path, body) {
  const r = await fetch(`${ECOM_API}${path}`, { method, headers: getHeaders(), body: body ? JSON.stringify(body) : undefined });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function uploadImage(file) {
  const fd = new FormData();
  fd.append('image', file);
  const r = await fetch(`${ECOM_API}/manage/upload`, { method: 'POST', headers: getHeaders(false), body: fd });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Upload failed');
  return data.url;
}

/* ── Tab config ───────────────────────────────────────────────────── */
const TABS = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'branding', label: 'Branding', icon: Palette },
  { id: 'pages', label: 'Pages', icon: FileText },
  { id: 'fulfillment', label: 'Fulfillment', icon: Truck },
  { id: 'seo', label: 'SEO & Social', icon: Search },
  { id: 'domain', label: 'Custom Domain', icon: Globe },
];

/* ── Template definitions with Lucide icons ───────────────────────── */
/* IMPORTANT: Every field MUST have a non-empty default so the page looks good on first create */
const TEMPLATES = {
  home: [
    { id: 'centered-hero', name: 'Centered Hero', Icon: LayoutGrid, desc: 'Centered text over background image + departments + products', sections: [
      { key: 'hero', label: 'Hero Banner', fields: [{ name: 'heading', type: 'text', default: 'Welcome to Our Store' }, { name: 'subheading', type: 'text', default: 'Fresh groceries, snacks, and everyday essentials — delivered to your door or ready for pickup.' }, { name: 'ctaText', type: 'text', default: 'Shop Now' }, { name: 'image', type: 'image', default: 'https://images.unsplash.com/photo-1604719312566-8912e9227c6a?w=1200&q=80' }] },
      { key: 'departments', label: 'Department Grid', fields: [{ name: 'heading', type: 'text', default: 'Shop by Category' }] },
      { key: 'products', label: 'Featured Products', fields: [{ name: 'heading', type: 'text', default: 'Featured Products' }] },
    ]},
    { id: 'split-hero', name: 'Split Screen', Icon: Columns, desc: 'Left text + right image side-by-side', sections: [
      { key: 'hero', label: 'Hero Section', fields: [{ name: 'heading', type: 'text', default: 'Your Neighborhood Store' }, { name: 'subheading', type: 'text', default: 'Quality products at great prices, now available online for pickup and delivery.' }, { name: 'image', type: 'image', default: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=800&q=80' }] },
      { key: 'products', label: 'Featured Products', fields: [{ name: 'heading', type: 'text', default: 'Popular Items' }] },
    ]},
    { id: 'minimal-home', name: 'Minimal Clean', Icon: Minus, desc: 'Clean typography, products-focused', sections: [
      { key: 'hero', label: 'Header', fields: [{ name: 'heading', type: 'text', default: 'Everyday Essentials' }, { name: 'subheading', type: 'text', default: 'Shop our curated collection of fresh groceries and household items.' }] },
    ]},
    { id: 'overlay-hero', name: 'Image Overlay', Icon: PanelTop, desc: 'Full-width image with bottom text overlay + gradient', sections: [
      { key: 'hero', label: 'Hero Banner', fields: [{ name: 'heading', type: 'text', default: 'Fresh Products, Great Prices' }, { name: 'subheading', type: 'text', default: 'Order your favorites online for same-day pickup or delivery.' }, { name: 'badge', type: 'text', default: 'Now Online' }, { name: 'ctaText', type: 'text', default: 'Shop Now' }, { name: 'ctaLink', type: 'text', default: '/products' }, { name: 'secondaryCta', type: 'text', default: 'Learn More' }, { name: 'secondaryCtaLink', type: 'text', default: '/about' }, { name: 'image', type: 'image', default: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=1200&q=80' }] },
      { key: 'departments', label: 'Categories', fields: [{ name: 'heading', type: 'text', default: 'Browse Categories' }] },
      { key: 'products', label: 'Featured Products', fields: [{ name: 'heading', type: 'text', default: 'Featured Products' }] },
    ]},
    { id: 'bold-typography', name: 'Bold Typography', Icon: Type, desc: 'Strong headline, no hero image, text-first design', sections: [
      { key: 'hero', label: 'Hero Text', fields: [{ name: 'heading', type: 'text', default: 'Fresh. Local. Delivered.' }, { name: 'subheading', type: 'text', default: 'Your neighborhood store, now online. Shop hundreds of products for same-day pickup or delivery.' }, { name: 'badge', type: 'text', default: 'Order Online' }, { name: 'ctaText', type: 'text', default: 'Start Shopping' }, { name: 'ctaLink', type: 'text', default: '/products' }, { name: 'secondaryCta', type: 'text', default: 'About Us' }, { name: 'secondaryCtaLink', type: 'text', default: '/about' }] },
      { key: 'products', label: 'Products Section', fields: [{ name: 'heading', type: 'text', default: 'Popular Right Now' }] },
    ]},
  ],
  about: [
    { id: 'story-mission', name: 'Story + Mission', Icon: BookOpen, desc: 'Story with image + mission gradient card + values', sections: [
      { key: 'story', label: 'Our Story', fields: [{ name: 'heading', type: 'text', default: 'Our Story' }, { name: 'text', type: 'textarea', default: 'We started as a small family-owned store with a big dream: to bring quality products and genuine care to our neighborhood. Over the years, we have grown into a trusted community hub where families find everything they need — from fresh produce and pantry staples to household essentials. Our commitment to fair prices, friendly service, and supporting local suppliers has never changed.' }, { name: 'image', type: 'image', default: 'https://images.unsplash.com/photo-1604719312566-8912e9227c6a?w=600&q=80' }] },
      { key: 'mission', label: 'Mission', fields: [{ name: 'heading', type: 'text', default: 'Our Mission' }, { name: 'text', type: 'textarea', default: 'To provide our community with high-quality products at fair prices, delivered with genuine care and exceptional service. We believe every neighborhood deserves access to fresh, affordable essentials.' }] },
    ]},
    { id: 'about-timeline', name: 'Timeline Journey', Icon: Users, desc: 'Vertical timeline with company milestones', sections: [
      { key: 'about', label: 'About', fields: [{ name: 'heading', type: 'text', default: 'About Us' }, { name: 'text', type: 'textarea', default: 'We are a family-owned convenience store committed to serving our neighborhood with quality products, competitive prices, and friendly service. What started as a small shop has grown into a community favorite.' }] },
      { key: 'team', label: 'Team', fields: [{ name: 'heading', type: 'text', default: 'Meet Our Team' }, { name: 'image', type: 'image', default: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=600&q=80' }] },
    ]},
    { id: 'about-cards', name: 'Card Values', Icon: Type, desc: 'Clean heading + numbered feature cards', sections: [
      { key: 'content', label: 'Main Content', fields: [{ name: 'heading', type: 'text', default: 'About Us' }, { name: 'text', type: 'textarea', default: 'We are more than just a store — we are part of your community. For over a decade, we have been providing fresh products, friendly service, and everyday essentials to the families in our neighborhood. Our commitment to quality and fair pricing is at the heart of everything we do.' }] },
    ]},
    { id: 'about-overlay', name: 'Image + Stats', Icon: PanelTop, desc: 'Hero image overlay + stats row + mission', sections: [
      { key: 'story', label: 'About Header', fields: [{ name: 'heading', type: 'text', default: 'Our Story' }, { name: 'subheading', type: 'text', default: 'Serving our community since day one' }, { name: 'text', type: 'textarea', default: 'What started as a small corner shop has grown into a neighborhood institution. We take pride in offering the freshest products, the friendliest service, and prices that respect your budget.' }, { name: 'image', type: 'image', default: 'https://images.unsplash.com/photo-1604719312566-8912e9227c6a?w=1200&q=80' }] },
      { key: 'stats', label: 'Stats', fields: [{ name: 'years', type: 'text', default: '10+' }, { name: 'yearsLabel', type: 'text', default: 'Years Serving' }, { name: 'products', type: 'text', default: '500+' }, { name: 'productsLabel', type: 'text', default: 'Products' }, { name: 'customers', type: 'text', default: '1000+' }, { name: 'customersLabel', type: 'text', default: 'Happy Customers' }] },
      { key: 'mission', label: 'Mission', fields: [{ name: 'heading', type: 'text', default: 'Our Mission' }, { name: 'text', type: 'textarea', default: 'To be the most trusted neighborhood store — offering quality, convenience, and care in everything we do.' }] },
    ]},
    { id: 'about-multi', name: 'Multi-Section', Icon: Columns, desc: 'Alternating text + image storytelling sections', sections: [
      { key: 'story', label: 'Our Story', fields: [{ name: 'heading', type: 'text', default: 'About Us' }, { name: 'subheading', type: 'text', default: 'How We Started' }, { name: 'text', type: 'textarea', default: 'Our journey began with a simple idea: every neighborhood deserves a store that feels like home. We opened our doors with a small selection and a big heart, and our community embraced us from day one.' }, { name: 'image', type: 'image', default: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=600&q=80' }] },
      { key: 'mission', label: 'Mission', fields: [{ name: 'heading', type: 'text', default: 'Our Mission' }, { name: 'text', type: 'textarea', default: 'We are committed to providing fresh, high-quality products at prices that work for every family. We support local suppliers and believe in building lasting relationships with our customers.' }] },
      { key: 'vision', label: 'Vision', fields: [{ name: 'heading', type: 'text', default: 'Our Vision' }, { name: 'text', type: 'textarea', default: 'To become the go-to neighborhood store for every family — a place where quality meets convenience, and every customer feels valued.' }, { name: 'image', type: 'image', default: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=600&q=80' }] },
    ]},
  ],
  contact: [
    { id: 'contact-split', name: 'Split Layout', Icon: SplitSquareHorizontal, desc: 'Contact info left + form right', sections: [
      { key: 'info', label: 'Contact Info', fields: [{ name: 'phone', type: 'text', default: '(555) 123-4567' }, { name: 'email', type: 'text', default: 'hello@mystore.com' }, { name: 'address', type: 'text', default: '123 Main Street, Anytown, USA' }] },
      { key: 'hours', label: 'Store Hours', fields: [{ name: 'hours', type: 'text', default: 'Mon-Sat 7AM-10PM, Sun 8AM-9PM' }] },
    ]},
    { id: 'contact-cards', name: 'Card Layout', Icon: CreditCard, desc: 'Contact info cards + form below', sections: [
      { key: 'info', label: 'Contact Details', fields: [{ name: 'phone', type: 'text', default: '(555) 123-4567' }, { name: 'email', type: 'text', default: 'hello@mystore.com' }, { name: 'address', type: 'text', default: '123 Main Street, Anytown, USA' }, { name: 'hours', type: 'text', default: 'Mon-Sat 7AM-10PM, Sun 8AM-9PM' }] },
    ]},
    { id: 'contact-minimal', name: 'Minimal Form', Icon: Minus, desc: 'Clean floating card with form', sections: [
      { key: 'info', label: 'Contact Details', fields: [{ name: 'phone', type: 'text', default: '(555) 123-4567' }, { name: 'email', type: 'text', default: 'hello@mystore.com' }, { name: 'address', type: 'text', default: '123 Main Street, Anytown, USA' }] },
    ]},
    { id: 'contact-map', name: 'Map + Form', Icon: Map, desc: 'Map/location area + form with info sidebar', sections: [
      { key: 'info', label: 'Contact Info', fields: [{ name: 'phone', type: 'text', default: '(555) 123-4567' }, { name: 'email', type: 'text', default: 'hello@mystore.com' }, { name: 'address', type: 'text', default: '123 Main Street, Anytown, USA' }] },
      { key: 'hours', label: 'Hours', fields: [{ name: 'hours', type: 'text', default: 'Mon-Sat 7AM-10PM, Sun 8AM-9PM' }] },
    ]},
    { id: 'contact-floating', name: 'Modern Floating', Icon: PanelTop, desc: 'Dark gradient background with floating white form card', sections: [
      { key: 'info', label: 'Contact Details', fields: [{ name: 'phone', type: 'text', default: '(555) 123-4567' }, { name: 'email', type: 'text', default: 'hello@mystore.com' }, { name: 'address', type: 'text', default: '123 Main Street, Anytown, USA' }, { name: 'hours', type: 'text', default: 'Mon-Sat 7AM-10PM, Sun 8AM-9PM' }] },
    ]},
  ],
};

/* ── SVG Template Previews ────────────────────────────────────────── */
function TemplatePreview({ templateId }) {
  const S = (p) => <svg viewBox="0 0 200 140" className="es-tpl-svg">{p}</svg>;
  const previewMap = {
    // Home
    'centered-hero': S(<><rect x="0" y="0" width="200" height="55" rx="2" fill="#94a3b8"/><rect x="50" y="12" width="100" height="8" rx="2" fill="#fff" opacity=".7"/><rect x="60" y="26" width="80" height="5" rx="1" fill="#fff" opacity=".4"/><rect x="75" y="38" width="50" height="9" rx="3" fill="#fff" opacity=".6"/><rect x="10" y="63" width="55" height="30" rx="4" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="72" y="63" width="55" height="30" rx="4" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="134" y="63" width="55" height="30" rx="4" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="10" y="100" width="42" height="36" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="58" y="100" width="42" height="36" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="106" y="100" width="42" height="36" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="154" y="100" width="42" height="36" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/></>),
    'split-hero': S(<><rect x="0" y="0" width="100" height="65" fill="#f0fdf4"/><rect x="10" y="12" width="70" height="8" rx="2" fill="#94a3b8"/><rect x="10" y="26" width="60" height="5" rx="1" fill="#cbd5e1"/><rect x="10" y="34" width="50" height="5" rx="1" fill="#cbd5e1"/><rect x="10" y="48" width="35" height="9" rx="3" fill="#3d56b5"/><rect x="100" y="0" width="100" height="65" fill="#e2e8f0" rx="0"/><rect x="108" y="8" width="84" height="49" rx="6" fill="#cbd5e1"/><rect x="10" y="75" width="42" height="55" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="58" y="75" width="42" height="55" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="106" y="75" width="42" height="55" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="154" y="75" width="42" height="55" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/></>),
    'minimal-home': S(<><rect x="30" y="15" width="140" height="12" rx="2" fill="#94a3b8"/><rect x="50" y="33" width="100" height="5" rx="1" fill="#e2e8f0"/><rect x="70" y="45" width="60" height="8" rx="3" fill="#3d56b5"/><rect x="10" y="62" width="42" height="35" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="58" y="62" width="42" height="35" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="106" y="62" width="42" height="35" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="154" y="62" width="42" height="35" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="10" y="103" width="42" height="35" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="58" y="103" width="42" height="35" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="106" y="103" width="42" height="35" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="154" y="103" width="42" height="35" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/></>),
    'overlay-hero': S(<><rect x="0" y="0" width="200" height="75" fill="#64748b"/><rect x="0" y="45" width="200" height="30" fill="url(#og)" opacity=".8"/><defs><linearGradient id="og" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="transparent"/><stop offset="1" stopColor="#000"/></linearGradient></defs><rect x="10" y="50" width="80" height="8" rx="2" fill="#fff" opacity=".8"/><rect x="10" y="62" width="60" height="5" rx="1" fill="#fff" opacity=".5"/><rect x="10" y="83" width="55" height="24" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="72" y="83" width="55" height="24" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="134" y="83" width="55" height="24" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="10" y="113" width="42" height="22" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="58" y="113" width="42" height="22" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="106" y="113" width="42" height="22" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="154" y="113" width="42" height="22" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/></>),
    'bold-typography': S(<><rect x="10" y="8" width="50" height="4" rx="1" fill="#3d56b5"/><rect x="10" y="18" width="140" height="14" rx="2" fill="#94a3b8"/><rect x="10" y="38" width="120" height="5" rx="1" fill="#cbd5e1"/><rect x="10" y="50" width="45" height="10" rx="4" fill="#3d56b5"/><rect x="0" y="68" width="200" height="1" fill="#e2e8f0"/><rect x="10" y="78" width="42" height="55" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="58" y="78" width="42" height="55" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="106" y="78" width="42" height="55" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="154" y="78" width="42" height="55" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/></>),
    // About
    'story-mission': S(<><rect x="10" y="10" width="80" height="10" rx="2" fill="#94a3b8"/><rect x="10" y="26" width="90" height="4" rx="1" fill="#e2e8f0"/><rect x="10" y="34" width="80" height="4" rx="1" fill="#e2e8f0"/><rect x="110" y="10" width="80" height="50" rx="4" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="10" y="70" width="180" height="30" rx="6" fill="#3d56b5" opacity=".2"/><rect x="30" y="78" width="80" height="6" rx="1" fill="#94a3b8"/><rect x="40" y="88" width="60" height="4" rx="1" fill="#cbd5e1"/><rect x="10" y="108" width="55" height="26" rx="4" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="72" y="108" width="55" height="26" rx="4" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="134" y="108" width="55" height="26" rx="4" fill="#f1f5f9" stroke="#e2e8f0"/></>),
    'about-timeline': S(<><rect x="60" y="8" width="80" height="10" rx="2" fill="#94a3b8"/><rect x="40" y="24" width="120" height="4" rx="1" fill="#e2e8f0"/><rect x="99" y="38" width="2" height="95" fill="#e2e8f0"/><circle cx="100" cy="52" r="5" fill="#3d56b5"/><rect x="110" y="45" width="70" height="14" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/><circle cx="100" cy="80" r="5" fill="#3d56b5"/><rect x="20" y="73" width="70" height="14" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/><circle cx="100" cy="108" r="5" fill="#3d56b5"/><rect x="110" y="101" width="70" height="14" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/></>),
    'about-cards': S(<><rect x="40" y="12" width="120" height="12" rx="2" fill="#94a3b8"/><rect x="30" y="30" width="140" height="4" rx="1" fill="#e2e8f0"/><rect x="10" y="48" width="88" height="40" rx="4" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="18" y="54" width="20" height="10" rx="1" fill="#3d56b5" opacity=".15"/><rect x="18" y="68" width="50" height="5" rx="1" fill="#94a3b8"/><rect x="18" y="77" width="70" height="4" rx="1" fill="#e2e8f0"/><rect x="106" y="48" width="88" height="40" rx="4" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="114" y="54" width="20" height="10" rx="1" fill="#3d56b5" opacity=".15"/><rect x="114" y="68" width="50" height="5" rx="1" fill="#94a3b8"/><rect x="114" y="77" width="70" height="4" rx="1" fill="#e2e8f0"/><rect x="10" y="96" width="88" height="40" rx="4" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="106" y="96" width="88" height="40" rx="4" fill="#f1f5f9" stroke="#e2e8f0"/></>),
    'about-overlay': S(<><rect x="0" y="0" width="200" height="55" fill="#64748b"/><rect x="50" y="15" width="100" height="8" rx="2" fill="#fff" opacity=".7"/><rect x="60" y="30" width="80" height="5" rx="1" fill="#fff" opacity=".4"/><rect x="40" y="64" width="36" height="18" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="82" y="64" width="36" height="18" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="124" y="64" width="36" height="18" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="10" y="92" width="180" height="40" rx="6" fill="#3d56b5" opacity=".15"/><rect x="50" y="100" width="100" height="6" rx="1" fill="#94a3b8"/><rect x="40" y="112" width="120" height="4" rx="1" fill="#cbd5e1"/></>),
    'about-multi': S(<><rect x="60" y="6" width="80" height="10" rx="2" fill="#94a3b8"/><rect x="10" y="24" width="85" height="4" rx="1" fill="#e2e8f0"/><rect x="10" y="32" width="75" height="4" rx="1" fill="#e2e8f0"/><rect x="105" y="22" width="85" height="22" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="10" y="52" width="85" height="22" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="105" y="54" width="85" height="4" rx="1" fill="#e2e8f0"/><rect x="105" y="62" width="75" height="4" rx="1" fill="#e2e8f0"/><rect x="10" y="82" width="85" height="4" rx="1" fill="#e2e8f0"/><rect x="10" y="90" width="75" height="4" rx="1" fill="#e2e8f0"/><rect x="105" y="82" width="85" height="22" rx="3" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="10" y="112" width="55" height="22" rx="4" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="72" y="112" width="55" height="22" rx="4" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="134" y="112" width="55" height="22" rx="4" fill="#f1f5f9" stroke="#e2e8f0"/></>),
    // Contact
    'contact-split': S(<><rect x="0" y="0" width="95" height="140" fill="#f8fafc"/><rect x="10" y="15" width="60" height="8" rx="2" fill="#94a3b8"/><rect x="10" y="32" width="70" height="4" rx="1" fill="#e2e8f0"/><rect x="10" y="44" width="10" height="10" rx="2" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="24" y="46" width="50" height="4" rx="1" fill="#cbd5e1"/><rect x="10" y="60" width="10" height="10" rx="2" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="24" y="62" width="50" height="4" rx="1" fill="#cbd5e1"/><rect x="10" y="76" width="10" height="10" rx="2" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="24" y="78" width="50" height="4" rx="1" fill="#cbd5e1"/><rect x="105" y="15" width="85" height="10" rx="3" fill="#e2e8f0"/><rect x="105" y="32" width="85" height="10" rx="3" fill="#e2e8f0"/><rect x="105" y="50" width="85" height="40" rx="3" fill="#e2e8f0"/><rect x="105" y="98" width="50" height="12" rx="4" fill="#3d56b5"/></>),
    'contact-cards': S(<><rect x="50" y="8" width="100" height="10" rx="2" fill="#94a3b8"/><rect x="60" y="24" width="80" height="4" rx="1" fill="#e2e8f0"/><rect x="10" y="38" width="55" height="32" rx="4" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="72" y="38" width="55" height="32" rx="4" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="134" y="38" width="55" height="32" rx="4" fill="#f1f5f9" stroke="#e2e8f0"/><rect x="30" y="80" width="140" height="10" rx="3" fill="#e2e8f0"/><rect x="30" y="96" width="140" height="10" rx="3" fill="#e2e8f0"/><rect x="30" y="112" width="140" height="20" rx="3" fill="#e2e8f0"/></>),
    'contact-minimal': S(<><rect x="30" y="20" width="140" height="100" rx="8" fill="#f8fafc" stroke="#e2e8f0"/><rect x="60" y="30" width="80" height="8" rx="2" fill="#94a3b8"/><rect x="50" y="42" width="100" height="4" rx="1" fill="#e2e8f0"/><rect x="45" y="54" width="110" height="8" rx="3" fill="#e2e8f0"/><rect x="45" y="68" width="110" height="8" rx="3" fill="#e2e8f0"/><rect x="45" y="82" width="110" height="18" rx="3" fill="#e2e8f0"/><rect x="65" y="106" width="70" height="10" rx="4" fill="#3d56b5"/></>),
    'contact-map': S(<><rect x="0" y="0" width="200" height="50" fill="#e2e8f0"/><circle cx="100" cy="22" r="8" fill="#94a3b8"/><rect x="60" y="36" width="80" height="5" rx="1" fill="#cbd5e1"/><rect x="10" y="58" width="85" height="4" rx="1" fill="#94a3b8"/><rect x="10" y="68" width="70" height="4" rx="1" fill="#e2e8f0"/><rect x="10" y="78" width="75" height="4" rx="1" fill="#e2e8f0"/><rect x="10" y="88" width="60" height="4" rx="1" fill="#e2e8f0"/><rect x="105" y="58" width="85" height="10" rx="3" fill="#e2e8f0"/><rect x="105" y="74" width="85" height="10" rx="3" fill="#e2e8f0"/><rect x="105" y="90" width="85" height="28" rx="3" fill="#e2e8f0"/><rect x="105" y="124" width="50" height="10" rx="4" fill="#3d56b5"/></>),
    'contact-floating': S(<><rect x="0" y="0" width="200" height="140" rx="0" fill="#1e293b"/><rect x="30" y="15" width="140" height="110" rx="8" fill="#fff"/><rect x="60" y="25" width="80" height="8" rx="2" fill="#94a3b8"/><rect x="50" y="38" width="100" height="4" rx="1" fill="#e2e8f0"/><rect x="45" y="50" width="110" height="8" rx="3" fill="#f1f5f9"/><rect x="45" y="64" width="110" height="8" rx="3" fill="#f1f5f9"/><rect x="45" y="78" width="110" height="18" rx="3" fill="#f1f5f9"/><rect x="65" y="102" width="70" height="10" rx="4" fill="#3d56b5"/></>),
  };
  return previewMap[templateId] || null;
}

/* ── Image Upload Component ───────────────────────────────────────── */
function ImageUploader({ value, onChange }) {
  const ref = useRef();
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImage(file);
      onChange(url);
    } catch (err) { toast.error(err.message); }
    setUploading(false);
  };

  return (
    <div className="es-img-uploader">
      {value && <img src={`${ECOM_UPLOADS}${value}`} alt="" className="es-img-preview" />}
      <div className="es-img-actions">
        <button type="button" className="es-img-btn" onClick={() => ref.current?.click()} disabled={uploading}>
          <Upload size={14} /> {uploading ? 'Uploading...' : value ? 'Replace' : 'Upload Image'}
        </button>
        {value && <button type="button" className="es-img-remove" onClick={() => onChange('')}><Trash2 size={14} /></button>}
      </div>
      <input ref={ref} type="file" accept="image/*" onChange={handleFile} hidden />
    </div>
  );
}

/* ── Section Editor ───────────────────────────────────────────────── */
function SectionEditor({ section, values, onChange }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="es-sect">
      <button className="es-sect-header" onClick={() => setOpen(!open)}>
        <span className="es-sect-label">{section.label}</span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && (
        <div className="es-sect-body">
          {section.fields.map(f => (
            <div key={f.name} className="es-field">
              <label className="es-label">{f.name.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}</label>
              {f.type === 'text' && (
                <input className="es-input" value={values?.[f.name] ?? f.default} onChange={e => onChange(section.key, f.name, e.target.value)} />
              )}
              {f.type === 'textarea' && (
                <textarea className="es-input es-textarea" value={values?.[f.name] ?? f.default} onChange={e => onChange(section.key, f.name, e.target.value)} rows={3} />
              )}
              {f.type === 'number' && (
                <input className="es-input" type="number" value={values?.[f.name] ?? f.default} onChange={e => onChange(section.key, f.name, parseInt(e.target.value) || 0)} />
              )}
              {f.type === 'toggle' && (
                <button className={`es-toggle ${values?.[f.name] ?? f.default ? 'es-toggle--on' : 'es-toggle--off'}`} onClick={() => onChange(section.key, f.name, !(values?.[f.name] ?? f.default))} />
              )}
              {f.type === 'image' && (
                <ImageUploader value={values?.[f.name] ?? f.default} onChange={v => onChange(section.key, f.name, v)} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Sync Section ─────────────────────────────────────────────────────── */
function SyncSection() {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState(null);

  const handleSync = async () => {
    setSyncing(true);
    setResult(null);
    try {
      const r = await fetch('/api/ecom/internal/sync/full', { method: 'POST', headers: getHeaders() });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Sync failed');
      setResult(data.synced);
      toast.success(`Synced ${data.synced.products} products and ${data.synced.departments} departments`);
    } catch (e) {
      toast.error(e.message);
    }
    setSyncing(false);
  };

  return (
    <div className="es-section">
      <div className="es-section-title">Product Sync</div>
      <p className="es-text-sm es-text-muted es-mb-16">
        Pull all products and departments from your POS catalog into the online store. New products are synced automatically when created, but use this to do a full initial sync.
      </p>
      <div className="es-flex-center">
        <button className="es-enable-btn es-sync-btn" onClick={handleSync} disabled={syncing}>
          <RefreshCw size={16} className={syncing ? 'es-spin' : ''} />
          {syncing ? 'Syncing...' : 'Sync Products Now'}
        </button>
        {result && (
          <span className="es-text-success">
            {result.products} products, {result.departments} departments synced
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Analytics Tab ────────────────────────────────────────────────────── */
function AnalyticsTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('GET', '/manage/analytics').then(d => setData(d.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="es-section"><p className="es-text-muted">Loading analytics...</p></div>;
  if (!data) return <div className="es-section"><p className="es-text-muted">No data available</p></div>;

  const { kpis, statusCounts, revenueTrend, topProducts } = data;

  return (
    <>
      <div className="es-analytics-kpis">
        <div className="es-kpi"><DollarSign size={20} className="es-kpi-icon" /><div><span className="es-kpi-num">${kpis.totalRevenue.toLocaleString()}</span><span className="es-kpi-label">Total Revenue</span></div></div>
        <div className="es-kpi"><ShoppingCart size={20} className="es-kpi-icon" /><div><span className="es-kpi-num">{kpis.orderCount}</span><span className="es-kpi-label">Orders</span></div></div>
        <div className="es-kpi"><Users size={20} className="es-kpi-icon" /><div><span className="es-kpi-num">{kpis.customerCount}</span><span className="es-kpi-label">Customers</span></div></div>
        <div className="es-kpi"><TrendingUp size={20} className="es-kpi-icon" /><div><span className="es-kpi-num">${kpis.avgOrderValue.toFixed(2)}</span><span className="es-kpi-label">Avg Order Value</span></div></div>
      </div>

      <div className="es-grid" style={{ marginBottom: 20 }}>
        <div className="es-section">
          <div className="es-section-title">Revenue (Last 30 Days)</div>
          <div className="es-chart-bar">
            {revenueTrend.slice(-14).map((d, i) => {
              const max = Math.max(...revenueTrend.slice(-14).map(r => r.revenue), 1);
              const pct = (d.revenue / max) * 100;
              return (
                <div key={i} className="es-bar-col" title={`${d.date}: $${d.revenue}`}>
                  <div className="es-bar" style={{ height: `${Math.max(pct, 2)}%` }} />
                  <span className="es-bar-label">{d.date.slice(8)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="es-section">
          <div className="es-section-title">Orders by Status</div>
          {Object.entries(statusCounts).length === 0 ? <p className="es-text-sm es-text-muted">No orders yet</p> : (
            <div className="es-status-list">
              {Object.entries(statusCounts).map(([status, count]) => (
                <div key={status} className="es-status-row">
                  <span className="es-status-name">{status}</span>
                  <span className="es-status-count">{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="es-section">
        <div className="es-section-title">Top Products</div>
        {topProducts.length === 0 ? <p className="es-text-sm es-text-muted">No sales data yet</p> : (
          <table className="es-top-table">
            <thead><tr><th>Product</th><th>Sold</th><th>Revenue</th></tr></thead>
            <tbody>
              {topProducts.map((p, i) => (
                <tr key={i}><td>{p.name}</td><td>{p.qty}</td><td>${p.revenue.toFixed(2)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

/* ── Customers Tab ───────────────────────────────────────────────────── */
function CustomersTab() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);

  const load = () => {
    setLoading(true);
    const params = search ? `?search=${encodeURIComponent(search)}` : '';
    api('GET', `/manage/customers${params}`).then(d => setCustomers(d.data || [])).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [search]);

  if (selected) {
    return <CustomerDetail customer={selected} onBack={() => { setSelected(null); load(); }} />;
  }

  return (
    <div className="es-section">
      <div className="es-section-title">Customers</div>
      <input className="es-input es-search-input" placeholder="Search by name, email, phone..." value={search} onChange={e => setSearch(e.target.value)} />
      {loading ? <p className="es-text-muted">Loading...</p> : customers.length === 0 ? (
        <p className="es-text-muted">No customers found</p>
      ) : (
        <table className="es-top-table">
          <thead><tr><th>Name</th><th>Email</th><th>Orders</th><th>Spent</th><th>Joined</th></tr></thead>
          <tbody>
            {customers.map(c => (
              <tr key={c.id} onClick={() => loadCustomerDetail(c.id, setSelected)} className="es-cursor-pointer">
                <td className="es-td-bold">{c.firstName || c.name || '—'} {c.lastName || ''}</td>
                <td>{c.email}</td>
                <td>{c.orderCount}</td>
                <td>${Number(c.totalSpent).toFixed(2)}</td>
                <td className="es-td-small-muted">{new Date(c.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

async function loadCustomerDetail(id, setter) {
  try {
    const d = await api('GET', `/manage/customers/${id}`);
    setter(d.data);
  } catch {}
}

function CustomerDetail({ customer, onBack }) {
  const orders = customer.orders || [];
  return (
    <div className="es-section">
      <button onClick={onBack} className="es-back-btn">← Back to Customers</button>
      <div className="es-flex-gap-16">
        <div className="es-avatar">
          {customer.firstName?.charAt(0) || customer.name?.charAt(0) || '?'}
        </div>
        <div>
          <div className="es-customer-name">{customer.firstName} {customer.lastName}</div>
          <div className="es-customer-meta">{customer.email} {customer.phone ? `· ${customer.phone}` : ''}</div>
        </div>
      </div>
      <div className="es-analytics-kpis es-mb-20">
        <div className="es-kpi"><div><span className="es-kpi-num">{customer.orderCount}</span><span className="es-kpi-label">Orders</span></div></div>
        <div className="es-kpi"><div><span className="es-kpi-num">${Number(customer.totalSpent).toFixed(2)}</span><span className="es-kpi-label">Total Spent</span></div></div>
        <div className="es-kpi"><div><span className="es-kpi-num">{new Date(customer.createdAt).toLocaleDateString()}</span><span className="es-kpi-label">Joined</span></div></div>
      </div>
      <div className="es-section-title">Order History</div>
      {orders.length === 0 ? <p className="es-text-muted">No orders</p> : (
        <table className="es-top-table">
          <thead><tr><th>Order</th><th>Status</th><th>Total</th><th>Date</th></tr></thead>
          <tbody>
            {orders.map(o => (
              <tr key={o.id}>
                <td className="es-td-bold">{o.orderNumber}</td>
                <td><span className={`eo-badge eo-badge--${o.status}`}>{o.status}</span></td>
                <td>${Number(o.grandTotal).toFixed(2)}</td>
                <td className="es-td-small-muted">{new Date(o.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ── Page Editor View (separate component to avoid hooks rule violation) ── */
function PageEditorView({ page, onBack, onSave }) {
  const tpl = TEMPLATES[page.pageType]?.find(t => t.id === page.templateId);
  const sections = tpl?.sections || [];
  const [editContent, setEditContent] = useState(JSON.parse(JSON.stringify(page.content?.sections || {})));

  const handleFieldChange = (sectionKey, fieldName, value) => {
    setEditContent(c => ({ ...c, [sectionKey]: { ...(c[sectionKey] || {}), [fieldName]: value } }));
  };

  return (
    <div className="p-page">
      <div className="es-header">
        <div>
          <h1 className="es-title">Edit: {page.title}</h1>
          <div className="es-section-detail">Template: {page.templateId} · /{page.slug}</div>
        </div>
        <button className="es-save-btn es-back-save-btn" onClick={onBack}>Back</button>
      </div>
      {sections.length === 0 && <p className="es-text-muted">No editable sections for this template.</p>}
      {sections.map(s => (
        <SectionEditor key={s.key} section={s} values={editContent[s.key]} onChange={handleFieldChange} />
      ))}
      <div className="es-save-bar">
        <button className="es-save-btn" onClick={() => onSave(page, editContent)}>Save Page Content</button>
      </div>
    </div>
  );
}

/* ── Main Component ───────────────────────────────────────────────── */
export default function EcomSetup() {
  const [store, setStore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get('tab') || 'general');
  const [pages, setPages] = useState([]);
  const [editingPage, setEditingPage] = useState(null); // page object being edited
  const [form, setForm] = useState({
    storeName: '', slug: '',
    branding: { logoText: '', primaryColor: '#16a34a', fontFamily: '', heroImage: '' },
    seoDefaults: { metaTitle: '', metaDescription: '' },
    socialLinks: { instagram: '', facebook: '', twitter: '' },
    fulfillmentConfig: { pickupEnabled: true, deliveryEnabled: false, pickupHours: '', deliveryFee: 0, minOrderAmount: 0 },
  });
  const [enableName, setEnableName] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const d = await api('GET', '/manage/ecom-store');
      if (d.data) {
        setStore(d.data);
        setForm({
          storeName: d.data.storeName || '', slug: d.data.slug || '',
          branding: { logoText: '', primaryColor: '#16a34a', fontFamily: '', heroImage: '', ...d.data.branding },
          seoDefaults: { metaTitle: '', metaDescription: '', ...d.data.seoDefaults },
          socialLinks: { instagram: '', facebook: '', twitter: '', ...d.data.socialLinks },
          fulfillmentConfig: { pickupEnabled: true, deliveryEnabled: false, pickupHours: '', deliveryFee: 0, minOrderAmount: 0, ...d.data.fulfillmentConfig },
        });
      }
      try { const p = await api('GET', '/manage/pages'); setPages(p.data || []); } catch {}
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleEnable = async () => {
    if (!enableName.trim()) { toast.error('Enter a store name'); return; }
    try {
      const d = await api('POST', '/manage/ecom-store/enable', { storeName: enableName });
      setStore(d.data);
      setForm(f => ({ ...f, storeName: d.data.storeName, slug: d.data.slug }));
      toast.success('E-commerce enabled!');
    } catch (e) { toast.error(e.message); }
  };

  const handleDisable = async () => {
    if (!window.confirm('Disable e-commerce? Storefront goes offline.')) return;
    try { await api('POST', '/manage/ecom-store/disable'); setStore(s => ({ ...s, enabled: false })); toast.success('Disabled'); } catch (e) { toast.error(e.message); }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api('PUT', '/manage/ecom-store', { branding: form.branding, seoDefaults: form.seoDefaults, socialLinks: form.socialLinks, fulfillmentConfig: form.fulfillmentConfig });
      toast.success('Settings saved!');
    } catch (e) { toast.error(e.message); }
    setSaving(false);
  };

  const handleCreatePage = async (pageType, templateId) => {
    const title = pageType.charAt(0).toUpperCase() + pageType.slice(1);
    const tpl = TEMPLATES[pageType]?.find(t => t.id === templateId);
    const defaultContent = {};
    if (tpl) tpl.sections.forEach(s => { defaultContent[s.key] = {}; s.fields.forEach(f => { defaultContent[s.key][f.name] = f.default; }); });
    try {
      await api('POST', '/manage/pages', { title, pageType, templateId, content: { sections: defaultContent }, published: true });
      toast.success(`${title} page created`);
      const p = await api('GET', '/manage/pages'); setPages(p.data || []);
    } catch (e) { toast.error(e.message); }
  };

  const handleDeletePage = async (id) => {
    if (!window.confirm('Delete this page?')) return;
    try { await api('DELETE', `/manage/pages/${id}`); toast.success('Deleted'); const p = await api('GET', '/manage/pages'); setPages(p.data || []); setEditingPage(null); } catch (e) { toast.error(e.message); }
  };

  const handleSavePage = async (page, content) => {
    try {
      await api('PUT', `/manage/pages/${page.id}`, { content: { sections: content } });
      toast.success('Page saved');
      const p = await api('GET', '/manage/pages'); setPages(p.data || []);
      setEditingPage(null);
    } catch (e) { toast.error(e.message); }
  };

  const setB = (k, v) => setForm(f => ({ ...f, branding: { ...f.branding, [k]: v } }));
  const setS = (k, v) => setForm(f => ({ ...f, seoDefaults: { ...f.seoDefaults, [k]: v } }));
  const setSo = (k, v) => setForm(f => ({ ...f, socialLinks: { ...f.socialLinks, [k]: v } }));
  const setF = (k, v) => setForm(f => ({ ...f, fulfillmentConfig: { ...f.fulfillmentConfig, [k]: v } }));

  if (loading) return <div className="p-page"><p className="es-text-muted">Loading...</p></div>;

  if (!store || !store.enabled) {
    return (
      <div className="p-page">
        <div className="es-section es-enable-card">
          <Store size={48} color="var(--brand-primary)" className="es-setup-icon" />
          <h2>Launch Your Online Store</h2>
          <p>Enable e-commerce to let customers shop online with pickup or delivery.</p>
          <div className="es-field" style={{ maxWidth: 400, margin: '0 auto 20px' }}>
            <label className="es-label">Store Name</label>
            <input className="es-input" placeholder="e.g. Joe's Market" value={enableName} onChange={e => setEnableName(e.target.value)} />
          </div>
          <button className="es-enable-btn" onClick={handleEnable}>Enable E-Commerce</button>
        </div>
      </div>
    );
  }

  // Page editor overlay
  if (editingPage) {
    return (
      <PageEditorView
        page={editingPage}
        onBack={() => setEditingPage(null)}
        onSave={handleSavePage}
      />
    );
  }

  return (
    <div className="p-page">
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon">
            <Globe size={22} />
          </div>
          <div>
            <h1 className="p-title">Online Store Setup</h1>
            <p className="p-subtitle">Live at: <a href={`${import.meta.env.VITE_STOREFRONT_URL || ''}?store=${store.slug}`} target="_blank" rel="noreferrer">{(import.meta.env.VITE_STOREFRONT_URL || '').replace(/^https?:\/\//, '')}?store={store.slug}</a></p>
          </div>
        </div>
        <div className="p-header-actions">
          <span className={`es-status ${store.enabled ? 'es-status--on' : 'es-status--off'}`}>{store.enabled ? '● Live' : '○ Disabled'}</span>
        </div>
      </div>

      <div className="es-tabs">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} className={`es-tab ${tab === t.id ? 'es-tab--active' : ''}`} onClick={() => setTab(t.id)}>
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* General */}
      {tab === 'general' && (<>
        <div className="es-section">
          <div className="es-section-title">Store Information</div>
          <div className="es-grid">
            <div className="es-field"><label className="es-label">Store Name</label><input className="es-input" value={form.storeName} readOnly style={{ opacity: 0.6 }} /></div>
            <div className="es-field"><label className="es-label">URL Slug</label><input className="es-input" value={form.slug} readOnly style={{ opacity: 0.6 }} /><div className="es-url-preview">Store URL: <strong>{(import.meta.env.VITE_STOREFRONT_URL || '').replace(/^https?:\/\//, '')}?store={form.slug}</strong></div></div>
          </div>
        </div>
        <div className="es-section">
          <div className="es-section-title">Store Logo / Banner</div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>Upload a banner image for your store card on the directory (recommended: 800×450px, 16:9 ratio). Shown on store discovery and as hero fallback.</p>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
            {form.branding.logoUrl ? (
              <img src={`${ECOM_UPLOADS}${form.branding.logoUrl || ''}`} alt="Logo" style={{ width: 180, height: 100, borderRadius: 10, objectFit: 'cover', border: '1px solid var(--border-color)' }} />
            ) : (
              <div style={{ width: 180, height: 100, borderRadius: 10, background: 'var(--bg-tertiary)', border: '1px dashed var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No image</div>
            )}
            <div>
              <ImageUploader value={form.branding.logoUrl || ''} onChange={v => setB('logoUrl', v)} />
            </div>
          </div>
        </div>
        <SyncSection />
      </>)}

      {/* Branding */}
      {tab === 'branding' && (
        <div className="es-section">
          <div className="es-section-title">Branding & Appearance</div>
          <div className="es-grid">
            <div className="es-field"><label className="es-label">Logo Text</label><input className="es-input" value={form.branding.logoText} onChange={e => setB('logoText', e.target.value)} placeholder="Displayed in header" /></div>
            <div className="es-field"><label className="es-label">Font</label>
              <select className="es-input" value={form.branding.fontFamily} onChange={e => setB('fontFamily', e.target.value)}>
                <option value="">System Default</option><option value="'Inter', sans-serif">Inter</option><option value="'Poppins', sans-serif">Poppins</option><option value="'DM Sans', sans-serif">DM Sans</option>
              </select>
            </div>
            <div className="es-field"><label className="es-label">Primary Color</label>
              <div className="es-color-row">
                <input type="color" className="es-color-input" value={form.branding.primaryColor} onChange={e => setB('primaryColor', e.target.value)} />
                <input className="es-input" style={{ maxWidth: 120 }} value={form.branding.primaryColor} onChange={e => setB('primaryColor', e.target.value)} />
              </div>
              <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                {['#16a34a','#2563eb','#7c3aed','#dc2626','#ea580c','#0891b2','#0f172a'].map(c => (
                  <button key={c} onClick={() => setB('primaryColor', c)} style={{ width: 26, height: 26, borderRadius: '50%', border: form.branding.primaryColor === c ? '2px solid var(--text-primary)' : '2px solid transparent', background: c, cursor: 'pointer', padding: 0 }} />
                ))}
              </div>
            </div>
            {/* Hero image moved to Page editor — each template has its own hero image field */}
          </div>
          <div className="es-preview-bar">
            <div className="es-preview-label">Preview</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ fontSize: 18, fontWeight: 800, color: form.branding.primaryColor }}>{form.branding.logoText || form.storeName}</span>
              <button style={{ padding: '7px 18px', background: form.branding.primaryColor, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13 }}>Shop Now</button>
            </div>
          </div>
        </div>
      )}

      {/* Pages */}
      {tab === 'pages' && (
        <div className="es-section">
          <div className="es-section-title">Website Pages</div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>Choose a template for each page, then edit the content.</p>

          {['home', 'about', 'contact'].map(pageType => {
            const existing = pages.find(p => p.pageType === pageType);
            const templates = TEMPLATES[pageType] || [];
            return (
              <div key={pageType} className="es-page-type-section">
                <div className="es-page-type-header">
                  <div>
                    <span className="es-page-type-name">{pageType.charAt(0).toUpperCase() + pageType.slice(1)} Page</span>
                    {existing ? <span className="es-page-type-status es-page-type-status--created">Created</span> : <span className="es-page-type-status es-page-type-status--missing">Not created</span>}
                  </div>
                  {existing && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="es-page-edit-btn" onClick={() => setEditingPage(existing)}><FileText size={14} /> Edit Content</button>
                      <button className="es-page-type-delete" onClick={() => handleDeletePage(existing.id)}><Trash2 size={14} /></button>
                    </div>
                  )}
                </div>

                {!existing && (
                  <div className="es-tpl-grid">
                    {templates.map(t => (
                      <button key={t.id} className="es-tpl-card" onClick={() => handleCreatePage(pageType, t.id)}>
                        <div className="es-tpl-preview-box">
                          <TemplatePreview templateId={t.id} />
                        </div>
                        <div className="es-tpl-info">
                          <t.Icon size={16} className="es-tpl-icon" />
                          <span className="es-tpl-name">{t.name}</span>
                        </div>
                        <span className="es-tpl-desc">{t.desc}</span>
                      </button>
                    ))}
                  </div>
                )}

                {existing && (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '4px 0' }}>
                    Template: <strong>{existing.templateId}</strong> · /{existing.slug} · {existing.published ? 'Published' : 'Draft'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Fulfillment */}
      {tab === 'fulfillment' && (
        <div className="es-section">
          <div className="es-section-title">Fulfillment Options</div>
          <div className="es-grid">
            <div>
              <div className="es-toggle-row"><button className={`es-toggle ${form.fulfillmentConfig.pickupEnabled ? 'es-toggle--on' : 'es-toggle--off'}`} onClick={() => setF('pickupEnabled', !form.fulfillmentConfig.pickupEnabled)} /><span className="es-toggle-label">Pickup Enabled</span></div>
              {form.fulfillmentConfig.pickupEnabled && <div className="es-field"><label className="es-label">Pickup Hours</label><input className="es-input" value={form.fulfillmentConfig.pickupHours} onChange={e => setF('pickupHours', e.target.value)} placeholder="Mon-Sun 8AM-10PM" /></div>}
            </div>
            <div>
              <div className="es-toggle-row"><button className={`es-toggle ${form.fulfillmentConfig.deliveryEnabled ? 'es-toggle--on' : 'es-toggle--off'}`} onClick={() => setF('deliveryEnabled', !form.fulfillmentConfig.deliveryEnabled)} /><span className="es-toggle-label">Delivery Enabled</span></div>
              {form.fulfillmentConfig.deliveryEnabled && (<>
                <div className="es-field"><label className="es-label">Delivery Fee ($)</label><input className="es-input" type="number" step="0.01" value={form.fulfillmentConfig.deliveryFee} onChange={e => setF('deliveryFee', parseFloat(e.target.value) || 0)} /></div>
                <div className="es-field"><label className="es-label">Min Order ($)</label><input className="es-input" type="number" step="0.01" value={form.fulfillmentConfig.minOrderAmount} onChange={e => setF('minOrderAmount', parseFloat(e.target.value) || 0)} /></div>
              </>)}
            </div>
          </div>
        </div>
      )}

      {/* SEO */}
      {tab === 'seo' && (
        <div className="es-section">
          <div className="es-section-title">SEO</div>
          <div className="es-grid">
            <div className="es-field"><label className="es-label">Meta Title</label><input className="es-input" value={form.seoDefaults.metaTitle} onChange={e => setS('metaTitle', e.target.value)} placeholder="Store — Shop Online" /></div>
            <div className="es-field"><label className="es-label">Meta Description</label><textarea className="es-input es-textarea" value={form.seoDefaults.metaDescription} onChange={e => setS('metaDescription', e.target.value)} /></div>
          </div>
          <div className="es-section-title" style={{ marginTop: 20 }}>Social Links</div>
          <div className="es-grid">
            <div className="es-field"><label className="es-label">Instagram</label><input className="es-input" value={form.socialLinks.instagram} onChange={e => setSo('instagram', e.target.value)} /></div>
            <div className="es-field"><label className="es-label">Facebook</label><input className="es-input" value={form.socialLinks.facebook} onChange={e => setSo('facebook', e.target.value)} /></div>
          </div>
        </div>
      )}

      {/* Analytics */}
      {tab === 'analytics' && <AnalyticsTab />}

      {/* Customers */}
      {tab === 'customers' && <CustomersTab />}

      {/* Custom Domain */}
      {tab === 'domain' && <EcomDomain embedded />}

      <div className="es-save-bar">
        <button className="es-disable-btn" onClick={handleDisable}>Disable E-Commerce</button>
        <button className="es-save-btn" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save All Changes'}</button>
      </div>
    </div>
  );
}

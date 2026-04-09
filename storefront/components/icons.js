/**
 * Shared icon mappings for the storefront.
 * Replaces all emoji usage with Lucide React icons.
 */

import {
  Store, Truck, ShieldCheck, Leaf,
  Coffee, Cookie, Snowflake, ShoppingCart, Heart, Home, Apple, Croissant, Beef, Package,
  Phone, Mail, MapPin, Clock,
} from 'lucide-react';

// Department slug → Lucide icon component
export const DEPT_ICONS = {
  beverages: Coffee,
  snacks: Cookie,
  'dairy-frozen': Snowflake,
  grocery: ShoppingCart,
  'health-beauty': Heart,
  household: Home,
  produce: Apple,
  bakery: Croissant,
  deli: Beef,
  default: Package,
};

export function DeptIcon({ slug, size = 28, ...props }) {
  const Icon = DEPT_ICONS[slug] || DEPT_ICONS.default;
  return <Icon size={size} strokeWidth={1.5} {...props} />;
}

// Trust section icons
export const TRUST_ICONS = {
  pickup: Store,
  delivery: Truck,
  secure: ShieldCheck,
  fresh: Leaf,
};

export function TrustIcon({ type, size = 28, ...props }) {
  const Icon = TRUST_ICONS[type];
  return Icon ? <Icon size={size} strokeWidth={1.5} {...props} /> : null;
}

// Contact info icons
export const CONTACT_ICONS = {
  phone: Phone,
  email: Mail,
  address: MapPin,
  hours: Clock,
};

export function ContactIcon({ type, size = 20, ...props }) {
  const Icon = CONTACT_ICONS[type];
  return Icon ? <Icon size={size} strokeWidth={1.5} {...props} /> : null;
}

// Fulfillment type icons
export function FulfillmentIcon({ type, size = 16 }) {
  if (type === 'pickup') return <Store size={size} strokeWidth={1.5} />;
  return <Truck size={size} strokeWidth={1.5} />;
}

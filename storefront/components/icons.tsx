/**
 * Shared icon mappings for the storefront.
 * Replaces all emoji usage with Lucide React icons.
 */

import {
  Store, Truck, ShieldCheck, Leaf,
  Coffee, Cookie, Snowflake, ShoppingCart, Heart, Home, Apple, Croissant, Beef, Package,
  Phone, Mail, MapPin, Clock,
  LucideProps, LucideIcon,
} from 'lucide-react';

type IconExtraProps = Omit<LucideProps, 'ref'>;

// Department slug → Lucide icon component
export const DEPT_ICONS: Record<string, LucideIcon> = {
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

interface DeptIconProps extends IconExtraProps {
  slug?: string | null;
  size?: number;
}

export function DeptIcon({ slug, size = 28, ...props }: DeptIconProps) {
  const Icon = (slug && DEPT_ICONS[slug]) || DEPT_ICONS.default;
  return <Icon size={size} strokeWidth={1.5} {...props} />;
}

// Trust section icons
export const TRUST_ICONS: Record<string, LucideIcon> = {
  pickup: Store,
  delivery: Truck,
  secure: ShieldCheck,
  fresh: Leaf,
};

interface TrustIconProps extends IconExtraProps {
  type: string;
  size?: number;
}

export function TrustIcon({ type, size = 28, ...props }: TrustIconProps) {
  const Icon = TRUST_ICONS[type];
  return Icon ? <Icon size={size} strokeWidth={1.5} {...props} /> : null;
}

// Contact info icons
export const CONTACT_ICONS: Record<string, LucideIcon> = {
  phone: Phone,
  email: Mail,
  address: MapPin,
  hours: Clock,
};

interface ContactIconProps extends IconExtraProps {
  type: string;
  size?: number;
}

export function ContactIcon({ type, size = 20, ...props }: ContactIconProps) {
  const Icon = CONTACT_ICONS[type];
  return Icon ? <Icon size={size} strokeWidth={1.5} {...props} /> : null;
}

// Fulfillment type icons
interface FulfillmentIconProps {
  type: string;
  size?: number;
}

export function FulfillmentIcon({ type, size = 16 }: FulfillmentIconProps) {
  if (type === 'pickup') return <Store size={size} strokeWidth={1.5} />;
  return <Truck size={size} strokeWidth={1.5} />;
}

import { Link } from 'react-router-dom';
import './MarketingButton.css';

const MarketingButton = ({
  children,
  variant = 'primary',
  size = 'md',
  onClick,
  href,
  className = '',
  type = 'button',
  icon: Icon,
  download = false,
}) => {
  const baseClass = `mkt-btn mkt-btn-${variant} mkt-btn-${size} ${className}`;

  const inner = (
    <>
      {children}
      {Icon && <Icon size={size === 'sm' ? 16 : 18} className="mkt-btn-icon" />}
    </>
  );

  if (href) {
    // External URL (http(s)://, mailto:, tel:) → plain <a>. React Router's
    // <Link> would try to treat it as an internal route and break the link.
    const isExternal = /^(https?:|mailto:|tel:)/i.test(href);

    // `download` prop OR any path pointing at a downloadable asset (anything
    // under /downloads/ or ending in a common installer extension) must also
    // bypass <Link> — otherwise React Router would swallow the click.
    const looksLikeFile = /\.(exe|dmg|appimage|pkg|msi|zip|deb|rpm)$/i.test(href) ||
                          /^\/downloads\//i.test(href);

    if (download || looksLikeFile) {
      // Same-origin assets get target="_self" + download attribute so the
      // browser streams the file instead of navigating away. External URLs
      // open in a new tab.
      return (
        <a
          href={href}
          className={baseClass}
          download={download || looksLikeFile ? '' : undefined}
          target={isExternal ? '_blank' : '_self'}
          rel={isExternal ? 'noopener noreferrer' : undefined}
          onClick={onClick}
        >
          {inner}
        </a>
      );
    }

    if (isExternal) {
      return (
        <a
          href={href}
          className={baseClass}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClick}
        >
          {inner}
        </a>
      );
    }
    return <Link to={href} className={baseClass}>{inner}</Link>;
  }

  return (
    <button type={type} className={baseClass} onClick={onClick}>
      {inner}
    </button>
  );
};

export default MarketingButton;

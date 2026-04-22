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

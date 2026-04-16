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
    return <Link to={href} className={baseClass}>{inner}</Link>;
  }

  return (
    <button type={type} className={baseClass} onClick={onClick}>
      {inner}
    </button>
  );
};

export default MarketingButton;

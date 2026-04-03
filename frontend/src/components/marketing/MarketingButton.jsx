import { Link } from 'react-router-dom';
import './MarketingButton.css';

const MarketingButton = ({ 
  children, 
  variant = 'primary', 
  size = 'md', 
  onClick, 
  href,
  className = '',
  type = 'button'
}) => {
  const baseClass = `mkt-btn mkt-btn-${variant} mkt-btn-${size} ${className}`;

  if (href) {
    return (
      <Link to={href} className={baseClass}>
        {children}
      </Link>
    );
  }

  return (
    <button type={type} className={baseClass} onClick={onClick}>
      {children}
    </button>
  );
};

export default MarketingButton;

import React from 'react';
import './MarketingSection.css';

const MarketingSection = ({
  children,
  id,
  title,
  subtitle,
  bgVariant = 'light',
  className = '',
  containerClass = '',
  fullWidth = false,
}) => {
  return (
    <section
      id={id}
      className={`mkt-section mkt-section-${bgVariant} ${className}`}
    >
      <div className={`${fullWidth ? 'mkt-container-full' : 'mkt-container'} ${containerClass}`}>
        {(title || subtitle) && (
          <div className="mkt-section-header">
            {title && <h2 className="mkt-section-title">{title}</h2>}
            {subtitle && <p className="mkt-section-subtitle">{subtitle}</p>}
          </div>
        )}
        {children}
      </div>
    </section>
  );
};

export default MarketingSection;

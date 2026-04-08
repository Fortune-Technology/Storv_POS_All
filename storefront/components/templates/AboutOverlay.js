/**
 * About Template 4: Image Background + Overlay
 * Hero image with overlay text, followed by stats + mission.
 */

const ECOM_URL = process.env.NEXT_PUBLIC_ECOM_URL || 'http://localhost:5005';

export default function AboutOverlay({ content, store }) {
  const s = content?.sections || {};
  const story = s.story || s.about || s.content || {};
  const mission = s.mission || {};
  const stats = s.stats || {};
  const storyImg = story.image ? (story.image.startsWith('http') ? story.image : `${ECOM_URL}${story.image}`) : null;

  return (
    <>
      <section className="tpl-hero tpl-hero--centered" style={storyImg ? { backgroundImage: `linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.6)), url(${storyImg})`, minHeight: 380 } : { minHeight: 300 }}>
        <div className="tpl-hero-content">
          <h1 className="tpl-hero-title" style={{ fontSize: 42 }}>{story.heading || 'Our Story'}</h1>
          <p className="tpl-hero-desc">{story.subheading || story.text?.slice(0, 120) || ''}</p>
        </div>
      </section>

      <div className="sf-container">
        {story.text && (
          <section className="tpl-section" style={{ maxWidth: 700 }}>
            <p className="tpl-about-body">{story.text}</p>
          </section>
        )}

        {/* Stats row */}
        <section className="tpl-stats-row">
          <div className="tpl-stat"><div className="tpl-stat-num">{stats.years || '10+'}</div><div className="tpl-stat-label">{stats.yearsLabel || 'Years Serving'}</div></div>
          <div className="tpl-stat"><div className="tpl-stat-num">{stats.products || '500+'}</div><div className="tpl-stat-label">{stats.productsLabel || 'Products'}</div></div>
          <div className="tpl-stat"><div className="tpl-stat-num">{stats.customers || '1000+'}</div><div className="tpl-stat-label">{stats.customersLabel || 'Happy Customers'}</div></div>
        </section>

        {(mission.heading || mission.text) && (
          <section className="tpl-mission-section">
            <div className="tpl-mission-card">
              <h2 className="tpl-mission-title">{mission.heading || 'Our Mission'}</h2>
              <p className="tpl-mission-body">{mission.text || ''}</p>
            </div>
          </section>
        )}
      </div>
    </>
  );
}

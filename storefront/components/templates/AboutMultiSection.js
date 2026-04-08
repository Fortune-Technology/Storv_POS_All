/**
 * About Template 5: Multi-Section Storytelling
 * Alternating text-left/image-right and image-left/text-right sections.
 */

const ECOM_URL = process.env.NEXT_PUBLIC_ECOM_URL || 'http://localhost:5005';

export default function AboutMultiSection({ content, store }) {
  const s = content?.sections || {};
  const story = s.story || s.about || s.content || {};
  const mission = s.mission || {};
  const vision = s.vision || {};
  const storyImg = story.image ? (story.image.startsWith('http') ? story.image : `${ECOM_URL}${story.image}`) : null;
  const visionImg = vision.image ? (vision.image.startsWith('http') ? vision.image : `${ECOM_URL}${vision.image}`) : null;

  return (
    <div className="sf-container">
      <section className="tpl-section" style={{ textAlign: 'center', paddingBottom: 16 }}>
        <h1 className="tpl-about-heading" style={{ fontSize: 40 }}>{story.heading || 'About Us'}</h1>
      </section>

      {/* Section 1: Text left, image right */}
      <section className="tpl-about-hero">
        <div className="tpl-about-split">
          <div className="tpl-about-text">
            <h2 className="tpl-about-heading">{story.subheading || 'Our Story'}</h2>
            <p className="tpl-about-body">{story.text || ''}</p>
          </div>
          {storyImg && <div className="tpl-about-image"><img src={storyImg} alt="" className="tpl-about-img" /></div>}
        </div>
      </section>

      {/* Section 2: Image left, text right (reversed) */}
      {(mission.heading || mission.text) && (
        <section className="tpl-about-hero">
          <div className="tpl-about-split" style={{ flexDirection: 'row-reverse' }}>
            <div className="tpl-about-text">
              <h2 className="tpl-about-heading">{mission.heading || 'Our Mission'}</h2>
              <p className="tpl-about-body">{mission.text || ''}</p>
            </div>
            <div className="tpl-about-image" style={{ flex: '0 0 300px' }}>
              <div style={{ width: '100%', aspectRatio: '1', background: 'linear-gradient(135deg, var(--sf-primary-light), var(--sf-primary))', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 64 }}>🎯</div>
            </div>
          </div>
        </section>
      )}

      {/* Section 3: Vision */}
      {(vision.heading || vision.text) && (
        <section className="tpl-about-hero">
          <div className="tpl-about-split">
            <div className="tpl-about-text">
              <h2 className="tpl-about-heading">{vision.heading || 'Our Vision'}</h2>
              <p className="tpl-about-body">{vision.text || ''}</p>
            </div>
            {visionImg && <div className="tpl-about-image"><img src={visionImg} alt="" className="tpl-about-img" /></div>}
          </div>
        </section>
      )}

      <section className="tpl-values">
        <div className="tpl-values-grid">
          <div className="tpl-value-card"><div className="tpl-value-icon">🎯</div><h4>Quality First</h4><p>We source only the best.</p></div>
          <div className="tpl-value-card"><div className="tpl-value-icon">🤝</div><h4>Community</h4><p>More than a store — your neighbors.</p></div>
          <div className="tpl-value-card"><div className="tpl-value-icon">💚</div><h4>Sustainability</h4><p>Reducing waste, supporting local.</p></div>
        </div>
      </section>
    </div>
  );
}

/**
 * About Template 1: Story + Mission
 * Hero image with story text, followed by mission/values cards.
 */

const ECOM_URL = process.env.NEXT_PUBLIC_ECOM_URL || 'http://localhost:5005';

export default function AboutStoryMission({ content, store }) {
  const s = content?.sections || {};
  const story = s.story || s.content || s.about || {};
  const mission = s.mission || {};
  const storyImg = story.image ? (story.image.startsWith('http') ? story.image : `${ECOM_URL}${story.image}`) : null;

  return (
    <div className="sf-container">
      {/* Story Section */}
      <section className="tpl-about-hero">
        <div className="tpl-about-split">
          <div className="tpl-about-text">
            <h2 className="tpl-about-heading">{story.heading || 'Our Story'}</h2>
            <p className="tpl-about-body">{story.text || story.body || ''}</p>
          </div>
          {storyImg && (
            <div className="tpl-about-image">
              <img src={storyImg} alt="" className="tpl-about-img" />
            </div>
          )}
        </div>
      </section>

      {/* Mission Section */}
      {(mission.heading || mission.text) && (
        <section className="tpl-mission-section">
          <div className="tpl-mission-card">
            <h2 className="tpl-mission-title">{mission.heading || 'Our Mission'}</h2>
            <p className="tpl-mission-body">{mission.text || ''}</p>
          </div>
        </section>
      )}

      {/* Values */}
      <section className="tpl-values">
        <div className="tpl-values-grid">
          <div className="tpl-value-card"><div className="tpl-value-icon">🎯</div><h4>Quality First</h4><p>We source only the best products for our community.</p></div>
          <div className="tpl-value-card"><div className="tpl-value-icon">🤝</div><h4>Community</h4><p>We're more than a store — we're your neighbors.</p></div>
          <div className="tpl-value-card"><div className="tpl-value-icon">💚</div><h4>Sustainability</h4><p>Committed to reducing waste and supporting local.</p></div>
        </div>
      </section>
    </div>
  );
}

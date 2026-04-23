/**
 * About Template 2: Timeline
 * Company journey displayed as a vertical timeline.
 */

import type { TemplateProps } from '../../lib/types';

const ECOM_URL = process.env.NEXT_PUBLIC_ECOM_URL || 'http://localhost:5005';

export default function AboutTimeline({ content }: TemplateProps) {
  const s = content?.sections || {};
  const about = s.about || s.story || s.content || {};
  const team = s.team || {};
  const teamImg = team.image ? (team.image.startsWith('http') ? team.image : `${ECOM_URL}${team.image}`) : null;

  return (
    <div className="sf-container">
      <section className="tpl-section">
        <h2 className="tpl-about-heading tpl-about-heading--centered">{about.heading || 'About Us'}</h2>
        {about.text && <p className="tpl-about-body tpl-about-body--tl-centered">{about.text}</p>}
      </section>

      {/* Timeline */}
      <section className="tpl-timeline">
        <div className="tpl-timeline-line" />
        <div className="tpl-timeline-item"><div className="tpl-timeline-dot" /><div className="tpl-timeline-content"><h4>Founded</h4><p>Started with a vision to serve our community with quality products.</p></div></div>
        <div className="tpl-timeline-item tpl-timeline-item--right"><div className="tpl-timeline-dot" /><div className="tpl-timeline-content"><h4>Growth</h4><p>Expanded our product range and built lasting relationships.</p></div></div>
        <div className="tpl-timeline-item"><div className="tpl-timeline-dot" /><div className="tpl-timeline-content"><h4>Online</h4><p>Launched our online store to bring convenience to your doorstep.</p></div></div>
      </section>

      {/* Team */}
      {(team.heading || teamImg) && (
        <section className="tpl-section tpl-section--team-centered">
          <h2 className="tpl-about-heading">{team.heading || 'Our Team'}</h2>
          {teamImg && <img src={teamImg} alt="" className="tpl-about-img tpl-about-img--team" />}
        </section>
      )}
    </div>
  );
}

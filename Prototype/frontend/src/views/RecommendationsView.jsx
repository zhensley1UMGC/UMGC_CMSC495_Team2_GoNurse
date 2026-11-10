import React from 'react';

export default function RecommendationsView({ panelProps, recommendations, setRecommendations, api, run, onAskAbout }) {
  return <section {...panelProps}>
    <h2>Recommendations</h2>
    <button onClick={() => run(async () => { const result = await api('/recommendations', 'POST', { limit: 5 }); setRecommendations(result.items); }, 'Recommendations updated.')}>Generate recommendations</button>
    {recommendations.length === 0 && <p>No recommendations displayed yet.</p>}
    {recommendations.map(rec => <article key={rec.id}>
      <h3>{rec.rank}. {rec.opportunity.title}</h3><p>{rec.explanation}</p>
      <div className="actions">
        {['helpful', 'not_helpful', 'declined'].map(rating => <button className="secondary" key={rating} onClick={() => run(() => api(`/recommendations/${rec.id}/feedback`, 'POST', { rating }), 'Feedback recorded.')}>{rating.replace('_', ' ')}</button>)}
        <button className="secondary" onClick={() => onAskAbout(rec.id)}>Ask about this</button>
      </div>
    </article>)}
  </section>;
}

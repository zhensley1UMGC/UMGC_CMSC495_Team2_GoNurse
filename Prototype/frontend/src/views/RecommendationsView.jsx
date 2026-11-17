
import React from 'react';

export default function RecommendationsView({
  panelProps,
  recommendations,
  setRecommendations,
  api,
  run,
  onAskAbout,
  recommendationRequestId,
}) {
  async function generateRecommendations() {
    const requestId = ++recommendationRequestId.current;

    // Remove previously displayed recommendations.
    setRecommendations([]);

    // Generate new recommendations and ignore outdated responses.
    await run(async () => {
      const result = await api('/recommendations', 'POST', {
        limit: 5,
      });

      if (requestId === recommendationRequestId.current) {
        setRecommendations(result.items);
      }
    });
  }

  return (
    <section {...panelProps}>
      <h2>Recommendations</h2>

      <button type="button" onClick={generateRecommendations}>
        Generate recommendations
      </button>

      {recommendations.length === 0 && (
        <p>No recommendations displayed yet.</p>
      )}

      {recommendations.map(rec => (
        <article key={rec.id}>
          <h3>
            {rec.rank}. {rec.opportunity.title}
          </h3>

          <p>{rec.explanation}</p>

          <div className="actions">
            {['helpful', 'not_helpful', 'declined'].map(rating => (
              <button
                className="secondary"
                key={rating}
                type="button"
                onClick={() =>
                  run(
                    () =>
                      api(
                        `/recommendations/${rec.id}/feedback`,
                        'POST',
                        { rating }
                      ),
                    'Feedback recorded.'
                  )
                }
              >
                {rating.replace('_', ' ')}
              </button>
            ))}

            <button
              className="secondary"
              type="button"
              onClick={() => onAskAbout(rec.id)}
            >
              Ask about this
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

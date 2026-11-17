
import React from 'react';

export default function NavigatorView({
  panelProps,
  tabbed,
  chat,
  setChat,
  recommendationId,
  setRecommendationId,
  answer,
  setAnswer,
  api,
  run,
  navigatorRequestId,
}) {
  async function handleSubmit(event) {
    event.preventDefault();

    const requestId = ++navigatorRequestId.current;

    const body = { message: chat };

    if (recommendationId) {
      body.recommendation_id = recommendationId;
    }

    setAnswer(null);

    await run(async () => {
      const result = await api('/navigator/messages', 'POST', body);

      // Ignore responses from requests that are no longer valid.
      if (requestId === navigatorRequestId.current) {
        setAnswer(result);
      }
    });
  }

  return (
    <section {...panelProps}>
      <h2>Career Navigator</h2>

      <p>
        Rule-based demo: ask about listings or profiles, or select a
        recommendation {tabbed ? 'in the Recommendations tab' : 'above'}.
      </p>

      <form onSubmit={handleSubmit}>
        <label>
          Question
          <textarea
            required
            value={chat}
            onChange={event => {
              navigatorRequestId.current += 1;
              setChat(event.target.value);
              setRecommendationId('');
              setAnswer(null);
            }}
          />
        </label>

        {recommendationId && (
          <small>Selected recommendation: {recommendationId}</small>
        )}

        <button type="submit">Ask</button>
      </form>

      {answer && (
        <article>
          <p>{answer.answer}</p>

          {answer.escalation_suggested && (
            <p>
              Consider submitting a support request{' '}
              {tabbed ? 'in the Request human support tab' : 'below'}.
            </p>
          )}
        </article>
      )}
    </section>
  );
}

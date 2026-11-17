
import React from 'react';

function OmissionNotice({ count }) {
  if (!count) return null;
  return <p role="note">Earlier exchanges omitted from this request: {count}.</p>;
}

export default function NavigatorView({
  panelProps,
  tabbed,
  chat,
  setChat,
  recommendationId,
  conversation,
  pending,
  error,
  blocked,
  canSubmit,
  onSubmit,
  onNewConversation,
}) {
  return (
    <section {...panelProps}>
      <h2>Career Navigator</h2>
      <p>
        AI-assisted career guidance uses your profile and current listings. Turn
        on recommendations in My profile to use AI guidance, including
        discussion of an existing recommendation.
      </p>

      {conversation.map((exchange, index) => (
        <article
          key={`${index}-${exchange.question}`}
          aria-label={`Conversation exchange ${index + 1}`}
        >
          <p><strong>You:</strong> {exchange.question}</p>
          <OmissionNotice count={exchange.omittedExchanges} />
          <p><strong>Career Navigator:</strong> {exchange.response.answer}</p>
          {exchange.response.escalation_suggested && (
            <p>
              Consider submitting a support request{' '}
              {tabbed ? 'in the Request human support tab' : 'below'}.
            </p>
          )}
        </article>
      ))}

      {pending && (
        <article aria-label="Pending question">
          <p><strong>You:</strong> {pending.question}</p>
          <OmissionNotice count={pending.omittedExchanges} />
          <p role="status">Waiting for Career Navigator…</p>
        </article>
      )}

      {error && (
        <p className="error" role="alert">
          {error} Your question remains in the draft so you can edit it and
          retry.
        </p>
      )}
      {blocked && (
        <p className="error" role="alert">
          Save your changed recommendation preference before asking a new
          question.
        </p>
      )}

      <form onSubmit={onSubmit}>
        <label>
          Question
          <textarea
            required
            value={chat}
            disabled={Boolean(pending) || blocked}
            onChange={event =>
              setChat(Array.from(event.target.value).slice(0, 2000).join(''))
            }
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
        </label>

        {recommendationId && (
          <small>Selected recommendation: {recommendationId}</small>
        )}

        <div className="actions">
          <button disabled={Boolean(pending) || blocked || !canSubmit}>
            {pending ? 'Asking…' : 'Ask'}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={onNewConversation}
          >
            New conversation
          </button>
        </div>
      </form>
    </section>
  );
}

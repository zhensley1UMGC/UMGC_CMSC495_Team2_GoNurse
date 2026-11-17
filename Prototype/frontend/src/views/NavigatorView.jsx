
import React from 'react';
import ReactMarkdown from 'react-markdown';

function OmissionNotice({ count }) {
  if (!count) return null;
  return <p role="note">Earlier exchanges omitted from this request: {count}.</p>;
}

function NavigatorAnswer({ answer }) {
  const markdown = answer
    .replace(/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/gi, '')
    .replace(/\(\s*ID:\s*\)/gi, '')
    .replace(/\s+-\s+(?=\*\*)/g, '\n- ');

  return <div className="navigator-answer"><ReactMarkdown>{markdown}</ReactMarkdown></div>;
}

function OpportunityReferences({ ids, opportunities, onViewOpportunity }) {
  const referencedItems = [...new Set(ids || [])]
    .map(id => opportunities.find(opportunity => String(opportunity.id) === id))
    .filter(Boolean);
  if (!referencedItems.length) return null;

  return <ul className="navigator-opportunities" aria-label="Referenced opportunities">
    {referencedItems.map(opportunity => {
      const description = Array.from(opportunity.description);
      const summary = description.length > 180
        ? `${description.slice(0, 177).join('').trimEnd()}…`
        : opportunity.description;
      return <li className="navigator-opportunity" key={opportunity.id}>
        <h3>{opportunity.title}</h3>
        <p>{summary}</p>
        <a href={`#opportunity-${opportunity.id}`} onClick={event => {
          if (!onViewOpportunity) return;
          event.preventDefault();
          onViewOpportunity(opportunity.id);
        }}>
          View opportunity
        </a>
      </li>;
    })}
  </ul>;
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
  preferenceChanged,
  recommendationsEnabled,
  canSubmit,
  onSubmit,
  onNewConversation,
  onGoToProfile,
  recommendations = [],
  onChangeRecommendationContext,
  onRemoveRecommendationContext,
  opportunities = [],
  onViewOpportunity,
  onRequestSupport,
}) {
  const disabled = Boolean(pending) || preferenceChanged || !recommendationsEnabled;
  const selectedRecommendation = recommendations.find(item => String(item.id) === String(recommendationId));
  const recommendationTitle = selectedRecommendation?.opportunity?.title || 'Selected recommendation';
  const referenceOpportunities = selectedRecommendation?.opportunity
    ? [...opportunities, selectedRecommendation.opportunity]
    : opportunities;

  return (
    <section {...panelProps}>
      <h2>Career Navigator</h2>
      <p>
        AI-assisted career guidance uses your profile and current listings. Turn
        on recommendations in My profile to use AI guidance, including
        discussion of an existing recommendation.
      </p>
      <p className="navigator-data-note" role="note">
        This chat uses your saved skills, interests, availability, and current
        open opportunities{recommendationId ? ', and the selected recommendation' : ''}.
        Do not enter patient or other sensitive information.
      </p>

      {preferenceChanged && (
        <p className="navigator-notice" role="status">
          Save your changed recommendation preference before asking a new
          question.{' '}
          <a
            href="#recommendations-opt-in"
            onClick={event => {
              event.preventDefault();
              onGoToProfile();
            }}
          >
            Go to My profile
          </a>.
        </p>
      )}
      {!recommendationsEnabled && !preferenceChanged && (
        <p className="navigator-notice" role="status">
          Career Navigator is unavailable while recommendations are turned off.{' '}
          <a
            href="#recommendations-opt-in"
            onClick={event => {
              event.preventDefault();
              onGoToProfile();
            }}
          >
            Enable recommendations in My profile
          </a>.
        </p>
      )}

      {recommendationId && (
        <div className="navigator-context" role="group" aria-label="Recommendation context">
          <span>
            Discussing recommendation: <strong>{recommendationTitle}</strong>
          </span>
          <div className="actions">
            <button
              type="button"
              className="secondary"
              onClick={onChangeRecommendationContext}
            >
              Change recommendation
            </button>
            <button
              type="button"
              className="secondary"
              onClick={onRemoveRecommendationContext}
            >
              Remove context
            </button>
          </div>
        </div>
      )}

      {conversation.map((exchange, index) => (
        <article
          key={`${index}-${exchange.question}`}
          aria-label={`Conversation exchange ${index + 1}`}
        >
          <p><strong>You:</strong> {exchange.question}</p>
          <OmissionNotice count={exchange.omittedExchanges} />
          <p><strong>Career Navigator:</strong></p>
          <NavigatorAnswer answer={exchange.response.answer} />
          <OpportunityReferences
            ids={exchange.response.referenced_opportunity_ids}
            opportunities={referenceOpportunities}
            onViewOpportunity={onViewOpportunity}
          />
          {exchange.response.escalation_suggested && (
            <div>
              <p>
                The button below opens a support request form; it does not
                connect you immediately. Nothing is sent until you submit the
                form.
              </p>
              <button
                type="button"
                className="secondary"
                onClick={onRequestSupport}
              >
                Request human support
              </button>
            </div>
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

      <form onSubmit={onSubmit}>
        <label>
          Question
          <textarea
            required
            value={chat}
            disabled={disabled}
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

        <div className="actions">
          <button disabled={disabled || !canSubmit}>
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

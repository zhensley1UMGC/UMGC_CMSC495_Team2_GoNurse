
import React, { useEffect, useRef, useState } from 'react';
import ProfileView from './views/ProfileView';
import OpportunitiesView from './views/OpportunitiesView';
import RecommendationsView from './views/RecommendationsView';
import NavigatorView from './views/NavigatorView';
import SupportView from './views/SupportView';
import SupportRequestsView from './views/SupportRequestsView';
import { split } from './formUtils';
import './style.css';

const emptyProfile = {
  skills: '',
  interests: '',
  availability: '',
  recommendations_opt_in: false,
};
const MAX_HISTORY_MESSAGES = 10;
const MAX_HISTORY_CODE_POINTS = 25000;
const PYTHON_WHITESPACE = '\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000';

function normalizeQuestion(value) {
  return value.replace(new RegExp(`^[${PYTHON_WHITESPACE}]+|[${PYTHON_WHITESPACE}]+$`, 'g'), '');
}

function codePointLength(value) {
  return Array.from(value).length;
}

function boundedHistory(conversation) {
  const exchanges = [];
  let messageCount = 0;
  let characterCount = 0;
  let index = conversation.length;
  while (index > 0) {
    const exchange = conversation[index - 1];
    const exchangeCharacters = codePointLength(exchange.question) + codePointLength(exchange.response.answer);
    if (messageCount + 2 > MAX_HISTORY_MESSAGES
        || characterCount + exchangeCharacters > MAX_HISTORY_CODE_POINTS) break;
    exchanges.unshift(exchange);
    messageCount += 2;
    characterCount += exchangeCharacters;
    index -= 1;
  }
  return {
    history: exchanges.flatMap(exchange => [
      { role: 'user', content: exchange.question },
      { role: 'assistant', content: exchange.response.answer },
    ]),
    omittedExchanges: index,
  };
}

export default function App({ tabbed = false }) {
  // Demo identity selection is not authentication.
  const [user, setUser] = useState('nurse');
  const userRef = useRef('nurse');
  const [activeTab, setActiveTab] = useState('profile');
  const tabRefs = useRef({});
  const navigatorRequestId = useRef(0);

  const [profile, setProfile] = useState(emptyProfile);
  const [savedOptIn, setSavedOptIn] = useState(false);
  const [opportunities, setOpportunities] = useState([]);
  const [recommendations, setRecommendations] = useState([]);

  // Tracks the latest valid recommendation request.
  const recommendationRequestId = useRef(0);
  const [recommendationsGenerated, setRecommendationsGenerated] = useState(false);
  const [requests, setRequests] = useState([]);
  const [chat, setChat] = useState('');
  const [recommendationId, setRecommendationId] = useState('');
  const [conversation, setConversation] = useState([]);
  const [navigatorPending, setNavigatorPending] = useState(null);
  const [navigatorError, setNavigatorError] = useState('');
  const [navigatorTargetOpportunityId, setNavigatorTargetOpportunityId] = useState('');
  const [profileSettingFocusRequested, setProfileSettingFocusRequested] = useState(false);
  const profileRequestId = useRef(0);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');
  const navigatorPreferenceChanged = savedOptIn !== profile.recommendations_opt_in;
  const navigatorAvailable = savedOptIn && profile.recommendations_opt_in;

  function clearConversation() {
    navigatorRequestId.current += 1;
    setConversation([]);
    setNavigatorPending(null);
    setNavigatorError('');
    setChat('');
    setRecommendationId('');
  }

  function startNewConversation() {
    if ((conversation.length || chat || recommendationId || navigatorPending)
        && !window.confirm('Start a new conversation? This will clear the current conversation and draft.')) {
      return;
    }
    clearConversation();
  }

  function selectRecommendation(id) {
    if (id !== recommendationId) {
      if ((conversation.length || chat || recommendationId || navigatorPending)
          && !window.confirm('Start a new conversation about this recommendation? This will clear the current conversation and draft.')) return;
      clearConversation();
      setRecommendationId(id);
      setChat('Why was this recommended?');
    } else {
      setChat(current => current || 'Why was this recommended?');
    }
    setActiveTab('navigator');
    tabRefs.current.navigator?.focus();
  }

  function removeRecommendationContext() {
    if (!recommendationId) return;
    if ((conversation.length || chat || navigatorPending)
        && !window.confirm('Remove this recommendation and start a new conversation? This will clear the current conversation and draft.')) {
      return;
    }
    clearConversation();
  }

  function viewOpportunity(id) {
    setNavigatorTargetOpportunityId(String(id));
    setActiveTab('opportunities');
  }

  function goToProfileSettings() {
    setProfileSettingFocusRequested(true);
    setActiveTab('profile');
  }

  function changeRecommendationContext() {
    setActiveTab('recommendations');
    tabRefs.current.recommendations?.focus();
  }

  async function submitNavigator(event) {
    event.preventDefault();
    if (navigatorPending || navigatorPreferenceChanged || !navigatorAvailable) return;

    const originalDraft = chat;
    const question = normalizeQuestion(chat);
    if (!question) return;
    const { history, omittedExchanges } = boundedHistory(conversation);
    const requestId = ++navigatorRequestId.current;
    const pending = { question, omittedExchanges };
    setNavigatorPending(pending);
    setNavigatorError('');
    try {
      const body = { message: question, history };
      if (recommendationId) body.recommendation_id = recommendationId;
      const response = await api('/navigator/messages', 'POST', body);
      if (requestId !== navigatorRequestId.current) return;
      setConversation(current => [...current, { question, response, omittedExchanges }]);
      setChat('');
      setNavigatorPending(null);
    } catch (error) {
      if (requestId !== navigatorRequestId.current) return;
      setNavigatorPending(null);
      setChat(originalDraft);
      setNavigatorError(error.message);
    }
  }

  async function saveProfile(profileDraft) {
    const requestId = ++profileRequestId.current;
    const identity = user;
    setFailure('');
    setNotice('');
    try {
      await api('/profile', 'PUT', {
        skills: split(profileDraft.skills),
        interests: split(profileDraft.interests),
        availability: split(profileDraft.availability),
        recommendations_opt_in: profileDraft.recommendations_opt_in,
      });
      if (requestId !== profileRequestId.current || identity !== userRef.current) return;
      setSavedOptIn(profileDraft.recommendations_opt_in);
      clearRecommendations();
      clearConversation();
      setNotice('Profile saved.');
    } catch (error) {
      if (requestId === profileRequestId.current && identity === userRef.current) setFailure(error.message);
    }
  }

  const tabs = user === 'admin'
    ? [
        { id: 'opportunities', label: 'Opportunities' },
        { id: 'requests', label: 'Support request review' },
      ]
    : [
        { id: 'profile', label: 'My profile' },
        { id: 'opportunities', label: 'Opportunities' },
        { id: 'recommendations', label: 'Recommendations' },
        { id: 'navigator', label: 'Career Navigator' },
        { id: 'support', label: 'Request human support' },
        { id: 'requests', label: 'My support requests' },
      ];

  function panelProps(id) {
    return tabbed
      ? {
          id: `panel-${id}`,
          role: 'tabpanel',
          'aria-labelledby': `tab-${id}`,
          hidden: activeTab !== id,
          tabIndex: 0,
        }
      : {};
  }

  function handleTabKey(event, index) {
    let next;

    if (event.key === 'ArrowRight') {
      next = (index + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft') {
      next = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = tabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    setActiveTab(tabs[next].id);
    tabRefs.current[tabs[next].id]?.focus();
  }

  // Invalidate pending requests and clear outdated recommendation information.
  function clearRecommendations() {
    recommendationRequestId.current += 1;
    setRecommendations([]);
    setRecommendationsGenerated(false);
    setRecommendationId('');
  }

  function updateProfile(nextProfile) {
    clearRecommendations();
    setNotice('');
    setProfile(nextProfile);
  }

  // Shared API helper using the selected demo identity.
  async function api(path, method = 'GET', body) {
    const result = await fetch(`/api/v1${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Demo-User': user,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const data = await result.json();

    if (!result.ok) {
      throw new Error(
        data.error?.message || `Request failed (${result.status}).`
      );
    }

    return data;
  }

  // Shared success and error handling.
  async function run(action, success) {
    setFailure('');
    setNotice('');

    try {
      await action();
      if (success) {
        setNotice(success);
      }
    } catch (error) {
      setFailure(error.message);
    }
  }

  // Refresh opportunities and support requests.
  async function refresh() {
    const [list, support] = await Promise.all([
      api('/opportunities'),
      api('/support-requests'),
    ]);

    setOpportunities(list.items);
    setRequests(support.items);
  }

  // Generate recommendations while ignoring outdated request responses.
  async function generateRecommendations() {
    const requestId = ++recommendationRequestId.current;

    setRecommendations([]);
    setRecommendationsGenerated(false);
    clearConversation();
    setFailure('');
    setNotice('');

    try {
      const result = await api('/recommendations', 'POST', {
        limit: 5,
      });

      if (requestId === recommendationRequestId.current) {
        setRecommendations(result.items);
        setRecommendationsGenerated(true);
        setNotice('Recommendations updated.');
      }
    } catch (error) {
      if (requestId === recommendationRequestId.current) {
        setRecommendationsGenerated(false);
        setFailure(error.message);
      }
    }
  }

  useEffect(() => {
    // Prevent older identity-specific responses from updating this view.
    let active = true;

    recommendationRequestId.current += 1;
    navigatorRequestId.current += 1;
    setProfile(emptyProfile);
    setSavedOptIn(false);
    setRecommendations([]);
    setRecommendationsGenerated(false);
    setRequests([]);
    clearConversation();
    setNavigatorTargetOpportunityId('');
    setProfileSettingFocusRequested(false);
    profileRequestId.current += 1;
    setNotice('');
    setFailure('');

    async function load() {
      try {
        const [list, support] = await Promise.all([
          api('/opportunities'),
          api('/support-requests'),
        ]);

        let selectedProfile = emptyProfile;

        if (user !== 'admin') {
          // A missing profile is expected for a new demo nurse.
          const result = await fetch('/api/v1/profile', {
            headers: { 'X-Demo-User': user },
          });

          if (result.status !== 404) {
            const data = await result.json();

            if (!result.ok) {
              throw new Error(
                data.error?.message || 'Unable to load profile.'
              );
            }

            selectedProfile = {
              ...data,
              skills: data.skills.join(', '),
              interests: data.interests.join(', '),
              availability: data.availability.join(', '),
            };
          }
        }

        if (active) {
          setOpportunities(list.items);
          setRequests(support.items);
          setProfile(selectedProfile);
          setSavedOptIn(selectedProfile.recommendations_opt_in);
        }
      } catch (error) {
        if (active) {
          setFailure(error.message);
        }
      }
    }

    load();

    return () => {
      active = false;
      recommendationRequestId.current += 1;
      navigatorRequestId.current += 1;
    };
  }, [user]);

  useEffect(() => {
    if (!navigatorTargetOpportunityId || (tabbed && activeTab !== 'opportunities')) return;
    const target = document.getElementById(`opportunity-${navigatorTargetOpportunityId}`);
    if (target) {
      target.focus();
      target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    }
    setNavigatorTargetOpportunityId('');
  }, [activeTab, navigatorTargetOpportunityId, tabbed]);

  useEffect(() => {
    if (!profileSettingFocusRequested || (tabbed && activeTab !== 'profile')) return;
    document.getElementById('recommendations-opt-in')?.focus();
    setProfileSettingFocusRequested(false);
  }, [activeTab, profileSettingFocusRequested, tabbed]);

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">LOCAL DEMONSTRATION</p>
          <h1>GoNurse</h1>
          <p>Discover internal professional development opportunities.</p>
        </div>

        <label>
          Demo identity
          <select
            value={user}
            onChange={event => {
              profileRequestId.current += 1;
              clearConversation();
              setNavigatorTargetOpportunityId('');
              setProfileSettingFocusRequested(false);
              setSavedOptIn(false);
              userRef.current = event.target.value;
              setUser(event.target.value);
              setActiveTab(event.target.value === 'admin' ? 'opportunities' : 'profile');
            }}
          >
            <option value="nurse">Nurse 1</option>
            <option value="nurse2">Nurse 2</option>
            <option value="admin">Administrator</option>
          </select>
        </label>
      </header>

      <div className="warning">
        Synthetic data only. Demo identities are not authentication.
        Career Navigator uses a configured AI provider and is unavailable while
        recommendations are turned off. Matching and ranking use deterministic
        rules.
        Do not enter patient or sensitive information.
      </div>

      {failure && (
        <p className="error" role="alert">
          {failure}
        </p>
      )}

      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}

      {tabbed && (
        <div
          className="tabs"
          role="tablist"
          aria-label="GoNurse sections"
        >
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              ref={element => {
                tabRefs.current[tab.id] = element;
              }}
              id={`tab-${tab.id}`}
              role="tab"
              type="button"
              aria-selected={activeTab === tab.id}
              aria-controls={`panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={event => handleTabKey(event, index)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      <div className={tabbed ? 'tab-content' : 'grid'}>
        {user !== 'admin' && (
          <ProfileView
            panelProps={panelProps('profile')}
            profile={profile}
            setProfile={updateProfile}
            onSaveProfile={saveProfile}
            onRecommendationsOptOut={clearConversation}
          />
        )}

        <OpportunitiesView
          panelProps={panelProps('opportunities')}
          user={user}
          opportunities={opportunities}
          api={api}
          run={run}
          refresh={refresh}
        />

        {user !== 'admin' && (
          <>
            <RecommendationsView
              panelProps={panelProps('recommendations')}
              recommendations={recommendations}
              setRecommendations={setRecommendations}
              recommendationsGenerated={recommendationsGenerated}
              api={api}
              run={run}
              onGenerate={generateRecommendations}
              onAskAbout={selectRecommendation}
            />

            <NavigatorView
              panelProps={panelProps('navigator')}
              tabbed={tabbed}
              chat={chat}
              setChat={setChat}
              recommendationId={recommendationId}
              conversation={conversation}
              pending={navigatorPending}
              error={navigatorError}
              preferenceChanged={navigatorPreferenceChanged}
              recommendationsEnabled={navigatorAvailable}
              canSubmit={Boolean(normalizeQuestion(chat))}
              onSubmit={submitNavigator}
              onNewConversation={startNewConversation}
              onGoToProfile={goToProfileSettings}
              recommendations={recommendations}
              onChangeRecommendationContext={changeRecommendationContext}
              onRemoveRecommendationContext={removeRecommendationContext}
              opportunities={opportunities}
              onViewOpportunity={viewOpportunity}
            />

            <SupportView
              panelProps={panelProps('support')}
              subject={subject}
              setSubject={setSubject}
              description={description}
              setDescription={setDescription}
              api={api}
              run={run}
              refresh={refresh}
            />
          </>
        )}

        <SupportRequestsView
          panelProps={panelProps('requests')}
          user={user}
          requests={requests}
          api={api}
          run={run}
          refresh={refresh}
        />
      </div>
    </main>
  );
}

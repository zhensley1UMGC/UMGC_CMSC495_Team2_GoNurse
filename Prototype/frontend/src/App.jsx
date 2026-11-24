
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ProfileView from './views/ProfileView';
import OpportunitiesView from './views/OpportunitiesView';
import RecommendationsView from './views/RecommendationsView';
import NavigatorView from './views/NavigatorView';
import SupportView from './views/SupportView';
import SupportRequestsView from './views/SupportRequestsView';
import './style.css';

const emptyProfile = {
  skills: [],
  interests: [],
  availability: [],
  recommendations_opt_in: false,
};
const emptyProfileOptions = { skills: [], interests: [], availability: [] };
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

export default function App() {
  // Demo identity selection is not authentication.
  const [user, setUser] = useState('nurse');
  const userRef = useRef('nurse');
  const identityVersion = useRef(0);
  const [activeTab, setActiveTab] = useState('profile');
  const tabRefs = useRef({});
  const navigationRef = useRef(null);
  const sectionSelectRef = useRef(null);
  const navigatorQuestionRef = useRef(null);
  const [mediaQuery] = useState(() => window.matchMedia('(max-width: 600px)'));
  const [compactNavigation, setCompactNavigation] = useState(mediaQuery.matches);
  const compactNavigationRef = useRef(mediaQuery.matches);
  const committedNavigationRef = useRef(mediaQuery.matches);
  const navigationFocusRequest = useRef(null);
  const [destinationFocus, setDestinationFocus] = useState('');
  const navigatorRequestId = useRef(0);

  const [profile, setProfile] = useState(emptyProfile);
  const [profileOptions, setProfileOptions] = useState(emptyProfileOptions);
  const [opportunityOptions, setOpportunityOptions] = useState(null);
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
  const [supportFocusRequested, setSupportFocusRequested] = useState(false);
  const supportSubjectRef = useRef(null);
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
    setDestinationFocus('navigator');
  }

  function removeRecommendationContext() {
    if (!recommendationId) return;
    if ((conversation.length || chat || navigatorPending)
        && !window.confirm('Remove this recommendation and start a new conversation? This will clear the current conversation and draft.')) {
      return;
    }
    clearConversation();
  }

  async function viewOpportunity(id) {
    const opportunityId = String(id);
    if (!opportunities.some(opportunity => String(opportunity.id) === opportunityId)) {
      const identity = userRef.current;
      const version = identityVersion.current;
      try {
        const opportunity = await api(`/opportunities/${opportunityId}`);
        if (identity !== userRef.current || version !== identityVersion.current) return;
        setOpportunities(current => current.some(item => String(item.id) === opportunityId)
          ? current
          : [...current, opportunity]);
      } catch (error) {
        if (identity === userRef.current && version === identityVersion.current) setFailure(error.message);
        return;
      }
    }
    setNavigatorTargetOpportunityId(opportunityId);
    setActiveTab('opportunities');
  }

  function goToProfileSettings() {
    setProfileSettingFocusRequested(true);
    setActiveTab('profile');
  }

  function changeRecommendationContext() {
    setActiveTab('recommendations');
    setDestinationFocus('recommendations');
  }

  function requestSupport() {
    setActiveTab('support');
    setSupportFocusRequested(true);
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
        skills: profileDraft.skills,
        interests: profileDraft.interests,
        availability: profileDraft.availability,
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
    return {
      id: `panel-${id}`,
      ...(compactNavigation ? {} : { role: 'tabpanel' }),
      'aria-labelledby': compactNavigation ? `heading-${id}` : `tab-${id}`,
      hidden: activeTab !== id,
      tabIndex: compactNavigation ? -1 : 0,
    };
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
    setProfileOptions(emptyProfileOptions);
    setOpportunityOptions(null);
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
        let selectedOptions = emptyProfileOptions;
        let selectedOpportunityOptions = null;

        if (user === 'admin') {
          selectedOpportunityOptions = await api('/opportunities/options');
        } else {
          selectedOptions = await api('/profile/options');
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
              skills: data.skills.filter(value => selectedOptions.skills.some(option => option.value === value)),
              interests: data.interests.filter(value => selectedOptions.interests.some(option => option.value === value)),
              availability: data.availability.filter(value => selectedOptions.availability.some(option => option.value === value)),
            };
          }
        }

        if (active) {
          setOpportunities(list.items);
          setRequests(support.items);
          setProfile(selectedProfile);
          setProfileOptions(selectedOptions);
          setOpportunityOptions(selectedOpportunityOptions);
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
    function handleChange(event) {
      if (event.matches === compactNavigationRef.current) return;
      const focused = document.activeElement;
      navigationFocusRequest.current = event.matches !== committedNavigationRef.current
        && navigationRef.current?.contains(focused) ? focused : null;
      compactNavigationRef.current = event.matches;
      setCompactNavigation(event.matches);
    }

    mediaQuery.addEventListener('change', handleChange);
    handleChange(mediaQuery);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [mediaQuery]);

  useLayoutEffect(() => {
    committedNavigationRef.current = compactNavigation;
    const previous = navigationFocusRequest.current;
    navigationFocusRequest.current = null;
    if (!previous) return;
    if (document.activeElement !== previous
        && (previous.isConnected || document.activeElement !== document.body)) return;
    if (compactNavigation) sectionSelectRef.current?.focus();
    else tabRefs.current[activeTab]?.focus();
  }, [compactNavigation, activeTab]);

  useEffect(() => {
    if (!destinationFocus || activeTab !== destinationFocus || user === 'admin') return;
    const panel = document.getElementById(`panel-${destinationFocus}`);
    const question = navigatorQuestionRef.current;
    if (destinationFocus === 'navigator' && question && !question.disabled) question.focus();
    else panel?.focus();
    setDestinationFocus('');
  }, [activeTab, destinationFocus, user]);

  useEffect(() => {
    if (!navigatorTargetOpportunityId || activeTab !== 'opportunities') return;
    const target = document.getElementById(`opportunity-${navigatorTargetOpportunityId}`);
    if (target) {
      target.focus();
      target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    }
    setNavigatorTargetOpportunityId('');
  }, [activeTab, navigatorTargetOpportunityId]);

  useEffect(() => {
    if (!profileSettingFocusRequested || activeTab !== 'profile') return;
    document.getElementById('recommendations-opt-in')?.focus();
    setProfileSettingFocusRequested(false);
  }, [activeTab, profileSettingFocusRequested]);

  useEffect(() => {
    if (!supportFocusRequested || user === 'admin' || activeTab !== 'support') return;
    supportSubjectRef.current?.focus({ preventScroll: true });
    supportSubjectRef.current?.scrollIntoView?.({ block: 'center' });
    setSupportFocusRequested(false);
  }, [activeTab, supportFocusRequested, user]);

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
              identityVersion.current += 1;
              profileRequestId.current += 1;
              clearConversation();
              setNavigatorTargetOpportunityId('');
              setProfileSettingFocusRequested(false);
              setSupportFocusRequested(false);
              setDestinationFocus('');
              navigationFocusRequest.current = null;
              setSavedOptIn(false);
              setOpportunityOptions(null);
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

      <nav ref={navigationRef} aria-label="GoNurse sections">
        {compactNavigation ? (
          <label>
            Section
            <select ref={sectionSelectRef} value={activeTab} onChange={event => setActiveTab(event.target.value)}>
              {tabs.map(tab => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
            </select>
          </label>
        ) : (
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
      </nav>

      <div className="tab-content">
        {user !== 'admin' && (
          <ProfileView
            panelProps={panelProps('profile')}
            profile={profile}
            profileOptions={profileOptions}
            setProfile={updateProfile}
            onSaveProfile={saveProfile}
            onRecommendationsOptOut={clearConversation}
          />
        )}

        <OpportunitiesView
          panelProps={panelProps('opportunities')}
          user={user}
          opportunities={opportunities}
          optionCatalog={opportunityOptions}
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
              questionRef={navigatorQuestionRef}
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
              onRequestSupport={requestSupport}
            />

            <SupportView
              panelProps={panelProps('support')}
              subject={subject}
              setSubject={setSubject}
              subjectRef={supportSubjectRef}
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

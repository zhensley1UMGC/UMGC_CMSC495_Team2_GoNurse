import React, { useEffect, useRef, useState } from 'react';
import ProfileView from './views/ProfileView';
import OpportunitiesView from './views/OpportunitiesView';
import RecommendationsView from './views/RecommendationsView';
import NavigatorView from './views/NavigatorView';
import SupportView from './views/SupportView';
import SupportRequestsView from './views/SupportRequestsView';
import './style.css';

const emptyProfile = { skills: '', interests: '', availability: '', recommendations_opt_in: false };

export default function App({ tabbed = false }) {
  // Identity selection is for local demonstration only, not authentication.
  // Keep the loaded records and the editable form drafts in separate state.
  const [user, setUser] = useState('nurse');
  const [activeTab, setActiveTab] = useState('profile');
  const tabRefs = useRef({});
  const [profile, setProfile] = useState(emptyProfile);
  const [opportunities, setOpportunities] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [requests, setRequests] = useState([]);
  const [chat, setChat] = useState('');
  const [recommendationId, setRecommendationId] = useState('');
  const [answer, setAnswer] = useState(null);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');

  const tabs = user === 'admin'
    ? [{ id: 'opportunities', label: 'Opportunities' }, { id: 'requests', label: 'Support request review' }]
    : [
        { id: 'profile', label: 'My profile' },
        { id: 'opportunities', label: 'Opportunities' },
        { id: 'recommendations', label: 'Recommendations' },
        { id: 'navigator', label: 'Career Navigator' },
        { id: 'support', label: 'Request human support' },
        { id: 'requests', label: 'My support requests' },
      ];

  function panelProps(id) {
    return tabbed ? {
      id: `panel-${id}`,
      role: 'tabpanel',
      'aria-labelledby': `tab-${id}`,
      hidden: activeTab !== id,
      tabIndex: 0,
    } : {};
  }

  function handleTabKey(event, index) {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    setActiveTab(tabs[next].id);
    tabRefs.current[tabs[next].id]?.focus();
  }

  // All normal API calls share the selected demo identity and error handling.
  async function api(path, method = 'GET', body) {
    const result = await fetch(`/api/v1${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Demo-User': user },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await result.json();
    if (!result.ok) throw new Error(data.error?.message || `Request failed (${result.status}).`);
    return data;
  }

  // Form and button handlers use one place to display successes and failures.
  async function run(action, success) {
    setFailure('');
    setNotice('');
    try {
      await action();
      if (success) setNotice(success);
    } catch (error) {
      setFailure(error.message);
    }
  }

  // Refresh shared listings after an administrator or nurse makes a change.
  async function refresh() {
    const [list, support] = await Promise.all([api('/opportunities'), api('/support-requests')]);
    setOpportunities(list.items);
    setRequests(support.items);
  }

  useEffect(() => {
    // Reset identity-specific views and load the new user's visible records.
    // The active flag prevents a previous identity's request updating this view
    // after the selection has changed or the component has unmounted.
    let active = true;
    setProfile(emptyProfile);
    setRecommendations([]);
    setRequests([]);
    setAnswer(null);
    setRecommendationId('');
    setNotice('');
    setFailure('');
    async function load() {
      try {
        const [list, support] = await Promise.all([api('/opportunities'), api('/support-requests')]);
        let selectedProfile = emptyProfile;
        if (user !== 'admin') {
          // A 404 is expected for a nurse who has not saved a profile yet.
          const result = await fetch('/api/v1/profile', { headers: { 'X-Demo-User': user } });
          if (result.status !== 404) {
            const data = await result.json();
            if (!result.ok) throw new Error(data.error?.message || 'Unable to load profile.');
            selectedProfile = { ...data, skills: data.skills.join(', '), interests: data.interests.join(', '), availability: data.availability.join(', ') };
          }
        }
        if (active) {
          setOpportunities(list.items);
          setRequests(support.items);
          setProfile(selectedProfile);
        }
      } catch (error) {
        if (active) setFailure(error.message);
      }
    }
    load();
    return () => { active = false; };
  }, [user]);

  return <main>
    <header>
      <div><p className="eyebrow">LOCAL DEMONSTRATION</p><h1>GoNurse</h1><p>Discover internal professional development opportunities.</p></div>
      <label>Demo identity
        <select value={user} onChange={event => { setUser(event.target.value); setActiveTab(event.target.value === 'admin' ? 'opportunities' : 'profile'); }}>
          <option value="nurse">Nurse 1</option><option value="nurse2">Nurse 2</option><option value="admin">Administrator</option>
        </select>
      </label>
    </header>
    <div className="warning">Synthetic data only. Demo identities are not authentication. Career Navigator and matching use deterministic rules, not AI. Do not enter patient or sensitive information.</div>
    {failure && <p className="error" role="alert">{failure}</p>}
    {notice && <p className="success" role="status">{notice}</p>}
    {tabbed && <div className="tabs" role="tablist" aria-label="GoNurse sections">
      {tabs.map((tab, index) => <button
        key={tab.id}
        ref={element => { tabRefs.current[tab.id] = element; }}
        id={`tab-${tab.id}`}
        role="tab"
        type="button"
        aria-selected={activeTab === tab.id}
        aria-controls={`panel-${tab.id}`}
        tabIndex={activeTab === tab.id ? 0 : -1}
        onClick={() => setActiveTab(tab.id)}
        onKeyDown={event => handleTabKey(event, index)}
      >{tab.label}</button>)}
    </div>}
    <div className={tabbed ? 'tab-content' : 'grid'}>
      {user !== 'admin' && <ProfileView panelProps={panelProps('profile')} profile={profile} setProfile={setProfile} api={api} run={run} />}
      <OpportunitiesView panelProps={panelProps('opportunities')} user={user} opportunities={opportunities} api={api} run={run} refresh={refresh} />
      {user !== 'admin' && <>
        <RecommendationsView panelProps={panelProps('recommendations')} recommendations={recommendations} setRecommendations={setRecommendations} api={api} run={run} onAskAbout={id => {
          setRecommendationId(id); setChat('Why was this recommended?');
          if (tabbed) { setActiveTab('navigator'); tabRefs.current.navigator?.focus(); }
        }} />
        <NavigatorView panelProps={panelProps('navigator')} tabbed={tabbed} chat={chat} setChat={setChat} recommendationId={recommendationId} setRecommendationId={setRecommendationId} answer={answer} setAnswer={setAnswer} api={api} run={run} />
        <SupportView panelProps={panelProps('support')} subject={subject} setSubject={setSubject} description={description} setDescription={setDescription} api={api} run={run} refresh={refresh} />
      </>}
      <SupportRequestsView panelProps={panelProps('requests')} user={user} requests={requests} api={api} run={run} refresh={refresh} />
    </div>
  </main>;
}

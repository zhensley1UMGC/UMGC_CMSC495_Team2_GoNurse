
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

// Form fields use comma-separated strings; the API expects arrays of labels.
const emptyProfile = { skills: '', interests: '', availability: '', recommendations_opt_in: false };
const split = value => value.split(',').map(item => item.trim()).filter(Boolean);

function App() {
  // Identity selection is for local demonstration only, not authentication.
  // Keep the loaded records and the editable form drafts in separate state.
  const [user, setUser] = useState('nurse');
  const [profile, setProfile] = useState(emptyProfile);
  const [opportunities, setOpportunities] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const recommendationRequestId = useRef(0);
  const [requests, setRequests] = useState([]);
  const [chat, setChat] = useState('');
  const [recommendationId, setRecommendationId] = useState('');
  const [answer, setAnswer] = useState(null);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [response, setResponse] = useState({});
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');
  const [draft, setDraft] = useState({ title: '', description: '', category: 'project', required_skills: '', interests: '', availability: '' });

  // Invalidate pending recommendations and remove results tied to an old profile.
  function clearRecommendations() {
    recommendationRequestId.current += 1;
    setRecommendations([]);
    setRecommendationId('');
    setAnswer(null);
    setNotice('');
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
    clearRecommendations();
    setProfile(emptyProfile);
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
    return () => { active = false; recommendationRequestId.current += 1; };
  }, [user]);

  return <main>
    <header>
      <div><p className="eyebrow">LOCAL DEMONSTRATION</p><h1>GoNurse</h1><p>Discover internal professional development opportunities.</p></div>
      <label>Demo identity
        <select value={user} onChange={event => { clearRecommendations(); setUser(event.target.value); }}>
          <option value="nurse">Nurse 1</option><option value="nurse2">Nurse 2</option><option value="admin">Administrator</option>
        </select>
      </label>
    </header>
    <div className="warning">Synthetic data only. Demo identities are not authentication. Career Navigator and matching use deterministic rules, not AI. Do not enter patient or sensitive information.</div>
    {failure && <p className="error" role="alert">{failure}</p>}
    {notice && <p className="success" role="status">{notice}</p>}
    <div className="grid">
      {/* Nurses maintain the profile and opt-in used by matching. */}
      {user !== 'admin' && <section>
        <h2>My profile</h2>
        <p>Separate items with commas. Example availability: weekday_morning.</p>
        <form onSubmit={event => { event.preventDefault(); run(async () => {
          await api('/profile', 'PUT', { skills: split(profile.skills), interests: split(profile.interests), availability: split(profile.availability), recommendations_opt_in: profile.recommendations_opt_in });
          clearRecommendations();
        }, 'Profile saved.'); }}>
          {['skills', 'interests', 'availability'].map(field => <label key={field}>{field}
            <input value={profile[field]} onChange={event => { clearRecommendations(); setProfile({ ...profile, [field]: event.target.value }); }} />
          </label>)}
          <label className="check"><input type="checkbox" checked={profile.recommendations_opt_in} onChange={event => { clearRecommendations(); setProfile({ ...profile, recommendations_opt_in: event.target.checked }); }} /> Enable recommendations</label>
          <button>Save profile</button>
        </form>
      </section>}
      {/* All demo users browse listings; only administrators can manage them. */}
      <section>
        <h2>Opportunities</h2>
        {opportunities.length === 0 && <p>No opportunities to show.</p>}
        {opportunities.map(item => <article key={item.id}><h3>{item.title}</h3><p>{item.description}</p><small>{item.category} · {item.status} · Required skills: {item.required_skills.join(', ') || 'None'}</small>
          {user === 'admin' && <div><button className="secondary" onClick={() => run(async () => {
            const { id, updated_at, ...fields } = item;
            await api(`/opportunities/${id}`, 'PUT', { ...fields, status: item.status === 'open' ? 'closed' : 'open' });
            await refresh();
          }, 'Listing status updated.')}>{item.status === 'open' ? 'Close listing' : 'Reopen listing'}</button></div>}
        </article>)}
        {user === 'admin' && <form onSubmit={event => { event.preventDefault(); run(async () => {
          await api('/opportunities', 'POST', { ...draft, required_skills: split(draft.required_skills), interests: split(draft.interests), availability: split(draft.availability), status: 'open' });
          setDraft({ title: '', description: '', category: 'project', required_skills: '', interests: '', availability: '' });
          await refresh();
        }, 'Opportunity created.'); }}>
          <h3>Create opportunity</h3>
          {['title', 'description', 'required_skills', 'interests', 'availability'].map(field => <label key={field}>{field.replace('_', ' ')}<input required={field === 'title' || field === 'description'} value={draft[field]} onChange={event => setDraft({ ...draft, [field]: event.target.value })} /></label>)}
          <label>Category<select value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value })}><option>project</option><option>committee</option><option>mentoring</option><option>professional_development</option></select></label>
          <button>Create listing</button>
        </form>}
      </section>
      {user !== 'admin' && <>
        {/* Results are generated on demand; feedback is recorded separately. */}
        <section>
          <h2>Recommendations</h2>
          <button onClick={async () => {
            const requestId = ++recommendationRequestId.current;
            setRecommendations([]);
            setRecommendationId('');
            setAnswer(null);
            setFailure('');
            setNotice('');
            try {
              const result = await api('/recommendations', 'POST', { limit: 5 });
              if (requestId === recommendationRequestId.current) {
                setRecommendations(result.items);
                setNotice('Recommendations generated.');
              }
            } catch (error) {
              if (requestId === recommendationRequestId.current) {
                setFailure(error.message);
              }
            }
          }}>Generate recommendations</button>
          {recommendations.length === 0 && <p>No recommendations displayed yet.</p>}
          {recommendations.map(rec => <article key={rec.id}>
            <h3>{rec.rank}. {rec.opportunity.title}</h3><p>{rec.explanation}</p>
            <div className="actions">
              {['helpful', 'not_helpful', 'declined'].map(rating => <button className="secondary" key={rating} onClick={() => run(() => api(`/recommendations/${rec.id}/feedback`, 'POST', { rating }), 'Feedback recorded.')}>{rating.replace('_', ' ')}</button>)}
              <button className="secondary" onClick={() => { setRecommendationId(rec.id); setChat('Why was this recommended?'); }}>Ask about this</button>
            </div>
          </article>)}
        </section>
        {/* Selecting a result supplies its ID; editing the question clears it. */}
        <section>
          <h2>Career Navigator</h2>
          <p>Rule-based demo: ask about listings or profiles, or select a recommendation above.</p>
          <form onSubmit={event => { event.preventDefault(); run(async () => {
            const body = { message: chat };
            if (recommendationId) body.recommendation_id = recommendationId;
            setAnswer(await api('/navigator/messages', 'POST', body));
          }); }}>
            <label>Question<textarea required value={chat} onChange={event => { setChat(event.target.value); setRecommendationId(''); }} /></label>
            {recommendationId && <small>Selected recommendation: {recommendationId}</small>}
            <button>Ask</button>
          </form>
          {answer && <article><p>{answer.answer}</p>{answer.escalation_suggested && <p>Consider submitting a support request below.</p>}</article>}
        </section>
        {/* Chat suggestions never submit this form automatically. */}
        <section>
          <h2>Request human support</h2>
          <form onSubmit={event => { event.preventDefault(); run(async () => {
            await api('/support-requests', 'POST', { subject, description });
            setSubject(''); setDescription(''); await refresh();
          }, 'Support request submitted.'); }}>
            <label>Subject<input required value={subject} onChange={event => setSubject(event.target.value)} /></label>
            <label>Description<textarea required value={description} onChange={event => setDescription(event.target.value)} /></label>
            <button>Submit request</button>
          </form>
        </section>
      </>}
      {/* Nurses see their own requests; administrators can review and respond. */}
      <section>
        <h2>{user === 'admin' ? 'Support request review' : 'My support requests'}</h2>
        {requests.length === 0 && <p>No support requests.</p>}
        {requests.map(item => <article key={item.id}><h3>{item.subject}</h3><p>{item.description}</p><p>Status: {item.status}</p>
          {item.response && <p>Administrator response: {item.response}</p>}
          {user === 'admin' && item.status !== 'closed' && <div>
            <label>Response<textarea value={response[item.id] || ''} onChange={event => setResponse({ ...response, [item.id]: event.target.value })} /></label>
            <div className="actions">
              {item.status === 'open' && <button className="secondary" onClick={() => run(async () => { await api(`/support-requests/${item.id}`, 'PATCH', { status: 'in_review' }); await refresh(); }, 'Request marked in review.')}>Mark in review</button>}
              <button onClick={() => run(async () => { await api(`/support-requests/${item.id}`, 'PATCH', { status: 'closed', response: response[item.id] || null }); await refresh(); }, 'Response saved and request closed.')}>Respond and close</button>
            </div>
          </div>}
        </article>)}
      </section>
    </div>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);

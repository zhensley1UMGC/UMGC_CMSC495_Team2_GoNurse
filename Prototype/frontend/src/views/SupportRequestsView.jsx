import React, { useState } from 'react';

export default function SupportRequestsView({ panelProps, user, requests, api, run, refresh }) {
  const [response, setResponse] = useState({});

  return <section {...panelProps}>
    <h2 id="heading-requests">{user === 'admin' ? 'Support request review' : 'My support requests'}</h2>
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
  </section>;
}

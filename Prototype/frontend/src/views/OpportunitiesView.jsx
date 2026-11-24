import React, { useState } from 'react';
import OptionCheckboxGroup from './OptionCheckboxGroup';

const emptyDraft = { title: '', description: '', category: 'project', required_skills: [], interests: [], availability: [] };

export default function OpportunitiesView({ panelProps, user, opportunities, optionCatalog, api, run, refresh }) {
  const [draft, setDraft] = useState(emptyDraft);

  return <section {...panelProps}>
    <h2 id="heading-opportunities">Opportunities</h2>
    {opportunities.length === 0 && <p>No opportunities to show.</p>}
    {opportunities.map(item => <article id={`opportunity-${item.id}`} tabIndex={-1} key={item.id}><h3>{item.title}</h3><p>{item.description}</p><small>{item.category} · {item.status} · Required skills: {item.required_skills.join(', ') || 'None'}</small>
      {user === 'admin' && <div><button className="secondary" onClick={() => run(async () => {
        const { id, updated_at, ...fields } = item;
        await api(`/opportunities/${id}`, 'PUT', { ...fields, status: item.status === 'open' ? 'closed' : 'open' });
        await refresh();
      }, 'Listing status updated.')}>{item.status === 'open' ? 'Close listing' : 'Reopen listing'}</button></div>}
    </article>)}
    {user === 'admin' && <form onSubmit={event => { event.preventDefault(); if (!optionCatalog) return; run(async () => {
      await api('/opportunities', 'POST', { ...draft, status: 'open' });
      setDraft(emptyDraft);
      await refresh();
    }, 'Opportunity created.'); }}>
      <h3>Create opportunity</h3>
      {['title', 'description'].map(field => <label key={field}>{field}<input required value={draft[field]} onChange={event => setDraft({ ...draft, [field]: event.target.value })} /></label>)}
      <label>Category<select value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value })}><option>project</option><option>committee</option><option>mentoring</option><option>professional_development</option></select></label>
      {optionCatalog && <>
        <p>Select any number of choices in each group.</p>
        {[
          ['required_skills', 'skills', 'Required skills'],
          ['interests', 'interests', 'Interests'],
          ['availability', 'availability', 'Availability'],
        ].map(([field, category, title]) => <OptionCheckboxGroup
          key={field}
          title={title}
          options={optionCatalog[category]}
          values={draft[field]}
          onChange={values => setDraft({ ...draft, [field]: values })}
        />)}
      </>}
      <button disabled={!optionCatalog}>Create listing</button>
    </form>}
  </section>;
}

import React from 'react';

export default function SupportView({ panelProps, subject, setSubject, subjectRef, description, setDescription, api, run, refresh }) {
  return <section {...panelProps}>
    <h2 id="heading-support">Request human support</h2>
    <form onSubmit={event => { event.preventDefault(); run(async () => {
      await api('/support-requests', 'POST', { subject, description });
      setSubject(''); setDescription(''); await refresh();
    }, 'Support request submitted.'); }}>
      <label>Subject<input ref={subjectRef} required value={subject} onChange={event => setSubject(event.target.value)} /></label>
      <label>Description<textarea required value={description} onChange={event => setDescription(event.target.value)} /></label>
      <button>Submit request</button>
    </form>
  </section>;
}

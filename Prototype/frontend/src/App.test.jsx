// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

function profileResponse(recommendationsOptIn = true) {
  return jsonResponse({
    skills: ['mentoring'], interests: ['education'], availability: ['weekday_morning'],
    recommendations_opt_in: recommendationsOptIn,
  });
}

function initialFetch() {
  return vi.fn((url, options = {}) => {
    if (url.endsWith('/opportunities')) return Promise.resolve(jsonResponse({ items: [] }));
    if (url.endsWith('/support-requests')) return Promise.resolve(jsonResponse({ items: [] }));
    if (url.endsWith('/profile') && options.method === undefined) return Promise.resolve(profileResponse());
    throw new Error(`Unexpected request: ${url}`);
  });
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

describe('Navigator conversations', () => {
  it('submits completed history, restores failed drafts, and ignores results after reset', async () => {
    const first = deferred();
    const late = deferred();
    let navigatorCalls = 0;
    const fetch = initialFetch();
    fetch.mockImplementation((url, options = {}) => {
      if (url.endsWith('/navigator/messages')) {
        navigatorCalls += 1;
        if (navigatorCalls === 1) return first.promise;
        if (navigatorCalls === 2) return Promise.resolve(jsonResponse(
          { error: { message: 'Navigator provider timed out.' } }, 504,
        ));
        if (navigatorCalls === 3) return Promise.resolve(jsonResponse({
          answer: 'Follow-up response.', referenced_opportunity_ids: [], escalation_suggested: true,
        }));
        return late.promise;
      }
      if (url.endsWith('/opportunities')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url.endsWith('/support-requests')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url.endsWith('/profile') && options.method === undefined) return Promise.resolve(profileResponse());
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App />);

    const question = await screen.findByLabelText('Question');
    fireEvent.change(question, { target: { value: 'First question?' } });
    fireEvent.keyDown(question, { key: 'Enter', code: 'Enter' });
    expect((await screen.findByRole('status')).textContent).toContain('Waiting for Career Navigator');
    expect(question.disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Asking…' }).disabled).toBe(true);

    first.resolve(jsonResponse({
      answer: 'First response.', referenced_opportunity_ids: [], escalation_suggested: false,
    }));
    expect(await screen.findByText('First response.')).toBeTruthy();

    fireEvent.change(question, { target: { value: 'Question to retry?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Navigator provider timed out.');
    expect(question.value).toBe('Question to retry?');
    expect(screen.queryByText('Question to retry?', { selector: 'article p' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText('Follow-up response.')).toBeTruthy();
    const requests = fetch.mock.calls.filter(([url]) => url.endsWith('/navigator/messages'));
    expect(JSON.parse(requests[0][1].body)).toEqual({ message: 'First question?', history: [] });
    expect(JSON.parse(requests[1][1].body)).toEqual({
      message: 'Question to retry?',
      history: [
        { role: 'user', content: 'First question?' },
        { role: 'assistant', content: 'First response.' },
      ],
    });
    expect(screen.getByText('Consider submitting a support request below.')).toBeTruthy();

    fireEvent.change(question, { target: { value: 'Unsaved draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByText('First response.')).toBeTruthy();
    expect(question.value).toBe('Unsaved draft');

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    expect(screen.queryByText('First response.')).toBeNull();
    expect(question.value).toBe('');

    fireEvent.change(question, { target: { value: 'Pending after reset' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await screen.findByText('Waiting for Career Navigator…');
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    late.resolve(jsonResponse({
      answer: 'Stale response.', referenced_opportunity_ids: [], escalation_suggested: false,
    }));
    await waitFor(() => expect(screen.queryByText('Stale response.')).toBeNull());
    expect(screen.queryByText('Pending after reset')).toBeNull();
  });

  it('sends the newest contiguous history window using Unicode code points', async () => {
    let answerNumber = 0;
    const fetch = initialFetch();
    fetch.mockImplementation((url, options = {}) => {
      if (url.endsWith('/navigator/messages')) {
        answerNumber += 1;
        return Promise.resolve(jsonResponse({
          answer: '😀'.repeat(8000), referenced_opportunity_ids: [], escalation_suggested: false,
        }));
      }
      if (url.endsWith('/opportunities')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url.endsWith('/support-requests')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url.endsWith('/profile') && options.method === undefined) return Promise.resolve(profileResponse());
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    render(<App />);

    const question = await screen.findByLabelText('Question');
    const questions = ['😀', '😷', '🚑', '🩺'].map(value => value.repeat(2000));
    for (let index = 0; index < questions.length; index += 1) {
      fireEvent.change(question, { target: { value: questions[index] } });
      fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
      await waitFor(() => {
        expect(screen.getAllByRole('article', { name: /Conversation exchange/ })).toHaveLength(index + 1);
      });
    }

    const requests = fetch.mock.calls.filter(([url]) => url.endsWith('/navigator/messages'));
    expect(answerNumber).toBe(4);
    expect(JSON.parse(requests[3][1].body)).toEqual({
      message: questions[3],
      history: [
        { role: 'user', content: questions[1] },
        { role: 'assistant', content: '😀'.repeat(8000) },
        { role: 'user', content: questions[2] },
        { role: 'assistant', content: '😀'.repeat(8000) },
      ],
    });
    expect(screen.getByRole('note').textContent).toContain('Earlier exchanges omitted from this request: 1.');
    expect(screen.getAllByRole('article', { name: /Conversation exchange/ })).toHaveLength(4);
  });

  it('limits requests to the newest five complete exchanges', async () => {
    let responseNumber = 0;
    const fetch = initialFetch();
    fetch.mockImplementation((url, options = {}) => {
      if (url.endsWith('/navigator/messages')) {
        responseNumber += 1;
        return Promise.resolve(jsonResponse({
          answer: `Answer ${responseNumber}.`, referenced_opportunity_ids: [], escalation_suggested: false,
        }));
      }
      if (url.endsWith('/opportunities')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url.endsWith('/support-requests')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url.endsWith('/profile') && options.method === undefined) return Promise.resolve(profileResponse());
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    render(<App />);

    const question = await screen.findByLabelText('Question');
    for (let index = 0; index < 6; index += 1) {
      fireEvent.change(question, { target: { value: `Question ${index + 1}?` } });
      fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
      await waitFor(() => {
        expect(screen.getAllByRole('article', { name: /Conversation exchange/ })).toHaveLength(index + 1);
      });
    }

    fireEvent.change(question, { target: { value: 'Question 7?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(screen.getAllByRole('article', { name: /Conversation exchange/ })).toHaveLength(7));
    const requests = fetch.mock.calls.filter(([url]) => url.endsWith('/navigator/messages'));
    const body = JSON.parse(requests[6][1].body);
    expect(body.history).toHaveLength(10);
    expect(body.history[0]).toEqual({ role: 'user', content: 'Question 2?' });
    expect(body.history[9]).toEqual({ role: 'assistant', content: 'Answer 6.' });
    expect(screen.getByRole('note').textContent).toContain('Earlier exchanges omitted from this request: 1.');
    expect(screen.getAllByRole('article', { name: /Conversation exchange/ })).toHaveLength(7);
  });

  it('clears immediately on opt-out and blocks until the changed profile is saved', async () => {
    let profileSaves = 0;
    const fetch = initialFetch();
    fetch.mockImplementation((url, options = {}) => {
      if (url.endsWith('/navigator/messages')) {
        return Promise.resolve(jsonResponse({
          answer: 'Opt-out guidance.', referenced_opportunity_ids: [], escalation_suggested: true,
        }));
      }
      if (url.endsWith('/profile') && options.method === 'PUT') {
        profileSaves += 1;
        if (profileSaves === 1) {
          return Promise.resolve(jsonResponse({ error: { message: 'Profile save failed.' } }, 500));
        }
        return Promise.resolve(profileResponse(false));
      }
      if (url.endsWith('/opportunities')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url.endsWith('/support-requests')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url.endsWith('/profile') && options.method === undefined) return Promise.resolve(profileResponse());
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    render(<App />);

    const question = await screen.findByLabelText('Question');
    fireEvent.change(question, { target: { value: 'Before opt-out' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText('Opt-out guidance.')).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable recommendations' }));
    expect(screen.queryByText('Opt-out guidance.')).toBeNull();
    expect(question.value).toBe('');
    expect(question.disabled).toBe(true);
    expect(screen.getByText('Save your changed recommendation preference before asking a new question.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByText('Profile save failed.')).toBeTruthy();
    expect(question.disabled).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable recommendations' }));
    fireEvent.change(question, { target: { value: 'Before profile save' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText('Opt-out guidance.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(screen.queryByText('Opt-out guidance.')).toBeNull());

    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable recommendations' }));
    expect(question.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(question.disabled).toBe(false));
    fireEvent.change(question, { target: { value: 'After saved opt-out' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText('Opt-out guidance.')).toBeTruthy();
    expect(profileSaves).toBe(3);
  });

  it('keeps recommendation selection sticky and confirms replacing a conversation', async () => {
    const fetch = initialFetch();
    const recommendationItems = [
      { id: 'rec-1', rank: 1, explanation: 'First recommendation.', opportunity: { title: 'First' } },
      { id: 'rec-2', rank: 2, explanation: 'Second recommendation.', opportunity: { title: 'Second' } },
    ];
    fetch.mockImplementation((url, options = {}) => {
      if (url.endsWith('/navigator/messages')) {
        return Promise.resolve(jsonResponse({
          answer: 'Recommendation answer.', referenced_opportunity_ids: [], escalation_suggested: false,
        }));
      }
      if (url.endsWith('/recommendations')) return Promise.resolve(jsonResponse({ items: recommendationItems }));
      if (url.endsWith('/opportunities')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url.endsWith('/support-requests')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url.endsWith('/profile') && options.method === undefined) return Promise.resolve(profileResponse());
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Generate recommendations' }));
    const askButtons = await screen.findAllByRole('button', { name: 'Ask about this' });
    fireEvent.click(askButtons[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText('Recommendation answer.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'A follow-up' } });
    fireEvent.click(askButtons[1]);
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByText('Selected recommendation: rec-1')).toBeTruthy();
    expect(screen.getByText('Recommendation answer.')).toBeTruthy();
    expect(screen.getByLabelText('Question').value).toBe('A follow-up');

    confirm.mockReturnValue(true);
    fireEvent.click(askButtons[1]);
    expect(screen.queryByText('Recommendation answer.')).toBeNull();
    expect(screen.getByText('Selected recommendation: rec-2')).toBeTruthy();
    expect(screen.getByLabelText('Question').value).toBe('Why was this recommended?');
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/navigator/messages'))).toHaveLength(1);
  });
});

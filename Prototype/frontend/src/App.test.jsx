// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

let mediaQuery;

beforeEach(() => {
  const listeners = new Set();
  mediaQuery = {
    matches: false,
    addEventListener: vi.fn((type, listener) => listeners.add(listener)),
    removeEventListener: vi.fn((type, listener) => listeners.delete(listener)),
    resize(width) {
      this.matches = width <= 600;
      act(() => listeners.forEach(listener => listener({ matches: this.matches })));
    },
  };
  vi.stubGlobal('matchMedia', vi.fn(() => mediaQuery));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function selectSection(label) {
  const selector = screen.queryByLabelText('Section');
  if (selector) {
    const option = within(selector).getByRole('option', { name: label });
    fireEvent.change(selector, { target: { value: option.value } });
  } else {
    fireEvent.click(screen.getByRole('tab', { name: label }));
  }
}

function jsonResponse(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

function profileResponse(recommendationsOptIn = true) {
  return jsonResponse({
    skills: ['mentoring'], interests: ['education'], availability: ['weekday_morning'],
    recommendations_opt_in: recommendationsOptIn,
  });
}

function profileOptionsResponse() {
  return jsonResponse({
    skills: [{ value: 'mentoring', label: 'Mentoring' }, { value: 'critical care', label: 'Critical care' }],
    interests: [{ value: 'education', label: 'Education' }],
    availability: [{ value: 'weekday_morning', label: 'Weekday mornings' }],
  });
}

function initialFetch() {
  return vi.fn((url, options = {}) => {
    if (url.endsWith('/opportunities')) return Promise.resolve(jsonResponse({ items: [] }));
    if (url.endsWith('/support-requests')) return Promise.resolve(jsonResponse({ items: [] }));
    if (url.endsWith('/profile/options') || url.endsWith('/opportunities/options')) return Promise.resolve(profileOptionsResponse());
    if (url.endsWith('/profile') && options.method === undefined) return Promise.resolve(profileResponse());
    throw new Error(`Unexpected request: ${url}`);
  });
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

describe('Section navigation', () => {
  it('uses accessible roving tabs and resets the selection for each identity', async () => {
    const fetch = initialFetch();
    vi.stubGlobal('fetch', fetch);
    render(<App />);
    await screen.findByRole('checkbox', { name: 'Mentoring' });

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(6);
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(screen.getByRole('tabpanel', { name: 'My profile' })).toBeTruthy();
    const profilePanel = document.getElementById('panel-profile');
    const supportPanel = document.getElementById('panel-support');
    expect(supportPanel.hidden).toBe(true);
    expect(tabs[0].getAttribute('aria-controls')).toBe(profilePanel.id);
    expect(profilePanel.getAttribute('aria-labelledby')).toBe(tabs[0].id);
    expect(tabs.map(tab => tab.tabIndex)).toEqual([0, -1, -1, -1, -1, -1]);
    const calls = fetch.mock.calls.length;

    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tabs[5]);
    expect(tabs[5].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tabs[5], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[0]);
    fireEvent.keyDown(tabs[0], { key: 'End' });
    expect(document.activeElement).toBe(tabs[5]);
    fireEvent.keyDown(tabs[5], { key: 'Home' });
    expect(document.activeElement).toBe(tabs[0]);
    tabs[4].focus();
    fireEvent.click(tabs[4]);
    expect(document.activeElement).toBe(tabs[4]);
    expect(supportPanel.hidden).toBe(false);
    expect(document.getElementById('panel-profile')).toBe(profilePanel);
    expect(fetch.mock.calls).toHaveLength(calls);

    fireEvent.change(screen.getByLabelText('Demo identity'), { target: { value: 'admin' } });
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: 'Opportunities' }).getAttribute('aria-selected')).toBe('true');
    await screen.findByRole('group', { name: 'Required skills' });
    fireEvent.change(screen.getByLabelText('title'), { target: { value: 'Draft listing' } });
    selectSection('Support request review');
    selectSection('Opportunities');
    expect(screen.getByLabelText('title').value).toBe('Draft listing');
    fireEvent.change(screen.getByLabelText('Demo identity'), { target: { value: 'nurse2' } });
    expect(screen.getByRole('tab', { name: 'My profile' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByRole('tab')).toHaveLength(6);
  });

  it('preserves selection, drafts, and appropriate focus across the 600px boundary', async () => {
    vi.stubGlobal('fetch', initialFetch());
    const { unmount } = render(<App />);
    await screen.findByRole('checkbox', { name: 'Mentoring' });
    selectSection('Request human support');
    const subject = screen.getByLabelText('Subject');
    fireEvent.change(subject, { target: { value: 'Unfinished request' } });
    const supportTab = screen.getByRole('tab', { name: 'Request human support' });
    supportTab.focus();

    mediaQuery.resize(600);
    const selector = screen.getByLabelText('Section');
    expect(document.activeElement).toBe(selector);
    expect(selector.value).toBe('support');
    expect(within(selector).getAllByRole('option')).toHaveLength(6);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('region', { name: 'Request human support' })).toBeTruthy();
    expect(subject.value).toBe('Unfinished request');
    selectSection('My profile');
    expect(document.activeElement).toBe(selector);
    selectSection('Request human support');
    expect(screen.getByLabelText('Subject')).toBe(subject);

    mediaQuery.resize(601);
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Request human support' }));
    subject.focus();
    mediaQuery.resize(600);
    expect(document.activeElement).toBe(subject);
    expect(subject.value).toBe('Unfinished request');
    fireEvent.change(screen.getByLabelText('Demo identity'), { target: { value: 'admin' } });
    expect(screen.getByLabelText('Section').value).toBe('opportunities');
    expect(within(screen.getByLabelText('Section')).getAllByRole('option')).toHaveLength(2);
    unmount();
    expect(mediaQuery.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it.each([false, true])('focuses the Navigator panel when its question is disabled (compact: %s)', async compact => {
    const fetch = initialFetch();
    fetch.mockImplementation((url, options = {}) => {
      if (url.endsWith('/recommendations')) return Promise.resolve(jsonResponse({
        items: [{ id: 'rec-1', rank: 1, explanation: 'A match.', opportunity: { title: 'Mentoring' } }],
      }));
      if (url.endsWith('/opportunities') || url.endsWith('/support-requests')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url.endsWith('/profile/options')) return Promise.resolve(profileOptionsResponse());
      if (url.endsWith('/profile') && options.method === undefined) return Promise.resolve(profileResponse(false));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    if (compact) mediaQuery.resize(600);
    render(<App />);
    await screen.findByRole('checkbox', { name: 'Mentoring' });
    selectSection('Recommendations');
    fireEvent.click(screen.getByRole('button', { name: 'Generate recommendations' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ask about this' }));
    expect(screen.getByLabelText('Question').disabled).toBe(true);
    expect(document.activeElement).toBe(document.getElementById('panel-navigator'));
    fireEvent.click(screen.getByRole('button', { name: 'Change recommendation' }));
    expect(document.activeElement).toBe(document.getElementById('panel-recommendations'));
  });
});

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
      if (url.endsWith('/profile/options')) return Promise.resolve(profileOptionsResponse());
      if (url.endsWith('/profile') && options.method === undefined) return Promise.resolve(profileResponse());
      throw new Error(`Unexpected request: ${url}`);
    });

    vi.stubGlobal('fetch', fetch);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App />);
    selectSection('Career Navigator');

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
    expect(screen.getByRole('button', { name: 'Request human support' })).toBeTruthy();

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

  describe('Navigator support handoff', () => {
    it('keeps an in-flight follow-up when navigating to support', async () => {
      const followUp = deferred();
      let navigatorCalls = 0;
      const fetch = vi.fn((url, options = {}) => {
        if (url.endsWith('/navigator/messages')) {
          navigatorCalls += 1;
          if (navigatorCalls === 2) return followUp.promise;
          return Promise.resolve(jsonResponse({
            answer: 'Please ask a person.', referenced_opportunity_ids: [], escalation_suggested: true,
          }));
        }
        if (url.endsWith('/opportunities')) return Promise.resolve(jsonResponse({ items: [] }));
        if (url.endsWith('/support-requests')) return Promise.resolve(jsonResponse({ items: [] }));
        if (url.endsWith('/profile/options')) return Promise.resolve(profileOptionsResponse());
        if (url.endsWith('/profile') && options.method === undefined) return Promise.resolve(profileResponse());
        throw new Error(`Unexpected request: ${url}`);
      });
      vi.stubGlobal('fetch', fetch);
      render(<App />);
      fireEvent.click(await screen.findByRole('tab', { name: 'Career Navigator' }));
      await waitFor(() => expect(screen.getByLabelText('Question').disabled).toBe(false));
      fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'First question' } });
      fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
      await screen.findByText('Please ask a person.');
      fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Pending follow-up' } });
      fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
      expect(screen.getByText('Waiting for Career Navigator…')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Request human support' }));
      expect(document.activeElement).toBe(screen.getByLabelText('Subject'));
      followUp.resolve(jsonResponse({
        answer: 'Follow-up completed.', referenced_opportunity_ids: [], escalation_suggested: false,
      }));
      fireEvent.click(screen.getByRole('tab', { name: 'Career Navigator' }));
      expect(await screen.findByText('Follow-up completed.')).toBeTruthy();
      expect(screen.getByText('Please ask a person.')).toBeTruthy();
      expect(fetch.mock.calls.filter(([url, options]) =>
        url.endsWith('/support-requests') && options?.method === 'POST')).toHaveLength(0);
    });

    it.each([
      ['desktop', false],
      ['mobile', true],
    ])('opens the existing form and preserves context in the %s layout', async (_layout, compact) => {
      let navigatorCalls = 0;
      const recommendationItems = [
        { id: 'rec-1', rank: 1, explanation: 'A recommendation.', opportunity: { title: 'Mentoring' } },
      ];
      const fetch = vi.fn((url, options = {}) => {
        if (url.endsWith('/navigator/messages')) {
          navigatorCalls += 1;
          return Promise.resolve(jsonResponse({
            answer: navigatorCalls === 1 ? 'Consider asking a person.' : 'Another answer.',
            referenced_opportunity_ids: [],
            escalation_suggested: navigatorCalls === 1,
          }));
        }
        if (url.endsWith('/recommendations')) return Promise.resolve(jsonResponse({ items: recommendationItems }));
        if (url.endsWith('/opportunities')) return Promise.resolve(jsonResponse({ items: [] }));
        if (url.endsWith('/support-requests')) return Promise.resolve(jsonResponse({ items: [] }));
        if (url.endsWith('/profile/options')) return Promise.resolve(profileOptionsResponse());
        if (url.endsWith('/profile') && options.method === undefined) return Promise.resolve(profileResponse());
        throw new Error(`Unexpected request: ${url}`);
      });
      vi.stubGlobal('fetch', fetch);
      if (compact) mediaQuery.resize(600);
      render(<App />);
      await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Mentoring' }).checked).toBe(true));

      selectSection('Request human support');
      const subject = screen.getByLabelText('Subject');
      const description = screen.getByLabelText('Description');
      subject.scrollIntoView = vi.fn();
      fireEvent.change(subject, { target: { value: 'My subject' } });
      fireEvent.change(description, { target: { value: 'My description' } });

      selectSection('Recommendations');
      fireEvent.click(screen.getByRole('button', { name: 'Generate recommendations' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Ask about this' }));
      expect(document.activeElement).toBe(screen.getByLabelText('Question'));
      fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
      await screen.findByText('Consider asking a person.');
      const supportPosts = () => fetch.mock.calls.filter(([url, options]) =>
        url.endsWith('/support-requests') && options?.method === 'POST');
      expect(supportPosts()).toHaveLength(0);

      const question = screen.getByLabelText('Question');
      fireEvent.change(question, { target: { value: 'Another question' } });
      fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
      await screen.findByText('Another answer.');
      fireEvent.change(question, { target: { value: 'A follow-up draft' } });
      const firstExchange = screen.getByRole('article', { name: 'Conversation exchange 1' });
      const secondExchange = screen.getByRole('article', { name: 'Conversation exchange 2' });
      expect(within(secondExchange).queryByRole('button', { name: 'Request human support' })).toBeNull();
      const action = within(firstExchange).getByRole('button', { name: 'Request human support' });
      const callsBeforeHandoff = fetch.mock.calls.length;
      fireEvent.click(action);
      if (!compact) {
        expect(screen.getByRole('tab', { name: 'Request human support' }).getAttribute('aria-selected')).toBe('true');
        expect(screen.getByRole('tabpanel', { name: 'Request human support' }).hidden).toBe(false);
      }
      expect(document.activeElement).toBe(subject);
      expect(subject.scrollIntoView).toHaveBeenCalledOnce();
      expect(subject.value).toBe('My subject');
      expect(description.value).toBe('My description');
      expect(fetch.mock.calls).toHaveLength(callsBeforeHandoff);
      expect(supportPosts()).toHaveLength(0);

      selectSection('Career Navigator');
      expect(screen.getByText('Consider asking a person.')).toBeTruthy();
      expect(screen.getByText('Another answer.')).toBeTruthy();
      expect(screen.getByRole('group', { name: 'Recommendation context' }).textContent).toContain('Mentoring');
      expect(screen.getByLabelText('Question').value).toBe('A follow-up draft');
      fireEvent.click(within(firstExchange).getByRole('button', { name: 'Request human support' }));
      expect(document.activeElement).toBe(subject);
      expect(subject.scrollIntoView).toHaveBeenCalledTimes(2);
      expect(supportPosts()).toHaveLength(0);

      fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
      await waitFor(() => expect(supportPosts()).toHaveLength(1));
      expect(JSON.parse(supportPosts()[0][1].body)).toEqual({ subject: 'My subject', description: 'My description' });
    });
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
      if (url.endsWith('/profile/options')) return Promise.resolve(profileOptionsResponse());
      if (url.endsWith('/profile') && options.method === undefined) return Promise.resolve(profileResponse());
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    render(<App />);
    selectSection('Career Navigator');

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
    expect(screen.getByText(/Earlier exchanges omitted from this request: 1\./)).toBeTruthy();
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
      if (url.endsWith('/profile/options')) return Promise.resolve(profileOptionsResponse());
      if (url.endsWith('/profile') && options.method === undefined) return Promise.resolve(profileResponse());
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    render(<App />);
    selectSection('Career Navigator');

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
    expect(screen.getByText(/Earlier exchanges omitted from this request: 1\./)).toBeTruthy();
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
      if (url.endsWith('/profile/options')) return Promise.resolve(profileOptionsResponse());
      if (url.endsWith('/profile') && options.method === undefined) return Promise.resolve(profileResponse());
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    render(<App />);
    selectSection('Career Navigator');

    const question = await screen.findByLabelText('Question');
    fireEvent.change(question, { target: { value: 'Before opt-out' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText('Opt-out guidance.')).toBeTruthy();

    selectSection('My profile');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable recommendations' }));
    selectSection('Career Navigator');
    expect(screen.queryByText('Opt-out guidance.')).toBeNull();
    expect(question.value).toBe('');
    expect(question.disabled).toBe(true);
    expect(screen.getByText(/Save your changed recommendation preference before asking a new question/)).toBeTruthy();

    selectSection('My profile');
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByText('Profile save failed.')).toBeTruthy();
    expect(question.disabled).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable recommendations' }));
    selectSection('Career Navigator');
    fireEvent.change(question, { target: { value: 'Before profile save' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText('Opt-out guidance.')).toBeTruthy();
    selectSection('My profile');
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(screen.queryByText('Opt-out guidance.')).toBeNull());

    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable recommendations' }));
    expect(question.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    selectSection('Career Navigator');
    await waitFor(() => expect(screen.getByRole('link', { name: 'Enable recommendations in My profile' })).toBeTruthy());
    expect(question.disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Ask' }).disabled).toBe(true);
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/navigator/messages'))).toHaveLength(2);
    expect(profileSaves).toBe(3);
  });

  it('requires a saved opt-in and links directly to the profile setting', async () => {
    const fetch = initialFetch();
    fetch.mockImplementation((url, options = {}) => {
      if (url.endsWith('/profile') && options.method === 'PUT') return Promise.resolve(profileResponse(true));
      if (url.endsWith('/profile/options')) return Promise.resolve(profileOptionsResponse());
      if (url.endsWith('/profile') && options.method === undefined) return Promise.resolve(profileResponse(false));
      if (url.endsWith('/opportunities')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url.endsWith('/support-requests')) return Promise.resolve(jsonResponse({ items: [] }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    render(<App />);

    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Mentoring' }).checked).toBe(true));
    fireEvent.click(screen.getByRole('tab', { name: 'Career Navigator' }));
    const question = screen.getByLabelText('Question');
    expect(question.disabled).toBe(true);
    expect(screen.getByText(/Career Navigator is unavailable while recommendations are turned off/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ask' }).disabled).toBe(true);

    fireEvent.click(screen.getByRole('link', { name: 'Enable recommendations in My profile' }));
    const profileTab = screen.getByRole('tab', { name: 'My profile' });
    await waitFor(() => expect(profileTab.getAttribute('aria-selected')).toBe('true'));
    const preference = screen.getByRole('checkbox', { name: 'Enable recommendations' });
    expect(document.activeElement).toBe(preference);

    fireEvent.click(preference);
    expect(question.disabled).toBe(true);
    selectSection('Career Navigator');
    expect(screen.getByText(/Save your changed recommendation preference/)).toBeTruthy();
    selectSection('My profile');
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByText('Profile saved.')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Career Navigator' }));
    await waitFor(() => expect(question.disabled).toBe(false));
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/navigator/messages'))).toHaveLength(0);
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
      if (url.endsWith('/profile/options')) return Promise.resolve(profileOptionsResponse());
      if (url.endsWith('/profile') && options.method === undefined) return Promise.resolve(profileResponse());
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Recommendations' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Generate recommendations' }));
    const askButtons = await screen.findAllByRole('button', { name: 'Ask about this' });
    fireEvent.click(askButtons[0]);
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Career Navigator' }).getAttribute('aria-selected')).toBe('true'));
    expect(document.activeElement).toBe(screen.getByLabelText('Question'));
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText('Recommendation answer.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'A follow-up' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change recommendation' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Recommendations' }).getAttribute('aria-selected')).toBe('true'));
    expect(document.activeElement).toBe(screen.getByRole('tabpanel', { name: 'Recommendations' }));
    fireEvent.click(askButtons[1]);
    expect(confirm).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('tab', { name: 'Career Navigator' }));
    const firstContext = screen.getByRole('group', { name: 'Recommendation context' });
    expect(firstContext.textContent).toContain('First');
    expect(firstContext.textContent).not.toContain('rec-1');
    expect(screen.getByText('Recommendation answer.')).toBeTruthy();
    expect(screen.getByLabelText('Question').value).toBe('A follow-up');

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Change recommendation' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Recommendations' }).getAttribute('aria-selected')).toBe('true'));
    fireEvent.click(askButtons[1]);
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Career Navigator' }).getAttribute('aria-selected')).toBe('true'));
    expect(screen.queryByText('Recommendation answer.')).toBeNull();
    const secondContext = screen.getByRole('group', { name: 'Recommendation context' });
    expect(secondContext.textContent).toContain('Second');
    expect(secondContext.textContent).not.toContain('rec-2');
    expect(screen.getByText(/current open opportunities, and the selected recommendation/)).toBeTruthy();
    expect(screen.getByLabelText('Question').value).toBe('Why was this recommended?');
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/navigator/messages'))).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Remove context' }));
    expect(screen.queryByRole('group', { name: 'Recommendation context' })).toBeNull();
    expect(screen.getByLabelText('Question').value).toBe('');
  });

  it('opens the cited opportunity when its Navigator card is followed', async () => {
    const opportunityId = '10000000-0000-4000-8000-000000000001';
    const opportunity = {
      id: opportunityId,
      title: 'Nurse mentoring committee',
      description: 'Help nurses mentor new colleagues.',
      category: 'committee',
      status: 'open',
      required_skills: [],
    };
    const fetch = initialFetch();
    fetch.mockImplementation((url, options = {}) => {
      if (url.endsWith('/opportunities')) return Promise.resolve(jsonResponse({ items: [opportunity] }));
      if (url.endsWith('/navigator/messages')) return Promise.resolve(jsonResponse({
        answer: 'This listing may be a fit.',
        referenced_opportunity_ids: [opportunityId],
        escalation_suggested: false,
      }));
      if (url.endsWith('/support-requests')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url.endsWith('/profile/options')) return Promise.resolve(profileOptionsResponse());
      if (url.endsWith('/profile') && options.method === undefined) return Promise.resolve(profileResponse());
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    render(<App />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Career Navigator' }));
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'What listings are available?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.click(await screen.findByRole('link', { name: 'View opportunity' }));

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Opportunities' }).getAttribute('aria-selected')).toBe('true'));
    await waitFor(() => expect(document.activeElement.id).toBe(`opportunity-${opportunityId}`));
  });

  it('loads a cited selected recommendation that is outside the first opportunities page', async () => {
    const opportunityId = '10000000-0000-4000-8000-000000000099';
    const opportunity = {
      id: opportunityId,
      title: 'Advanced mentoring project',
      description: 'Mentor nurses across the organization.',
      category: 'mentoring',
      status: 'open',
      required_skills: ['mentoring'],
      interests: ['education'],
      availability: ['weekday_morning'],
    };
    const firstPage = Array.from({ length: 20 }, (_, index) => ({
      id: `listing-${index}`,
      title: `Listing ${index}`,
      description: 'Another listing.',
      category: 'project',
      status: 'open',
      required_skills: [],
    }));
    const recommendationItems = [{
      id: 'rec-1',
      rank: 1,
      explanation: 'A matching recommendation.',
      opportunity,
    }];
    let lookupAttempts = 0;
    const fetch = initialFetch();
    fetch.mockImplementation((url, options = {}) => {
      if (url.endsWith(`/opportunities/${opportunityId}`)) {
        lookupAttempts += 1;
        if (lookupAttempts === 1) return Promise.resolve(jsonResponse({ error: { message: 'Listing lookup failed.' } }, 503));
        return Promise.resolve(jsonResponse(opportunity));
      }
      if (url.endsWith('/opportunities')) return Promise.resolve(jsonResponse({ items: firstPage }));
      if (url.endsWith('/navigator/messages')) return Promise.resolve(jsonResponse({
        answer: 'This recommendation could be a fit.',
        referenced_opportunity_ids: [opportunityId],
        escalation_suggested: false,
      }));
      if (url.endsWith('/recommendations')) return Promise.resolve(jsonResponse({ items: recommendationItems }));
      if (url.endsWith('/support-requests')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url.endsWith('/profile/options')) return Promise.resolve(profileOptionsResponse());
      if (url.endsWith('/profile') && options.method === undefined) return Promise.resolve(profileResponse());
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    render(<App />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Recommendations' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Generate recommendations' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ask about this' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ask' }));

    expect(await screen.findByRole('heading', { name: opportunity.title })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'View opportunity' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Listing lookup failed.');
    expect(screen.getByRole('tab', { name: 'Career Navigator' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('link', { name: 'View opportunity' }));

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Opportunities' }).getAttribute('aria-selected')).toBe('true'));
    await waitFor(() => expect(document.activeElement.id).toBe(`opportunity-${opportunityId}`));
    expect(fetch).toHaveBeenCalledWith(`/api/v1/opportunities/${opportunityId}`, expect.any(Object));
  });

  it('ignores a pending listing lookup after switching away from and back to an identity', async () => {
    const lookup = deferred();
    const opportunity = {
      id: 'outside-page', title: 'Outside page', description: 'A listing.',
      category: 'project', status: 'open', required_skills: [],
    };
    const fetch = initialFetch();
    fetch.mockImplementation((url, options = {}) => {
      if (url.endsWith('/opportunities/outside-page')) return lookup.promise;
      if (url.endsWith('/opportunities') || url.endsWith('/support-requests')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url.endsWith('/profile/options') || url.endsWith('/opportunities/options')) return Promise.resolve(profileOptionsResponse());
      if (url.endsWith('/profile') && options.method === undefined) return Promise.resolve(profileResponse());
      if (url.endsWith('/recommendations')) return Promise.resolve(jsonResponse({
        items: [{ id: 'rec-1', rank: 1, explanation: 'A match.', opportunity }],
      }));
      if (url.endsWith('/navigator/messages')) return Promise.resolve(jsonResponse({
        answer: 'Consider this listing.', referenced_opportunity_ids: ['outside-page'], escalation_suggested: false,
      }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    render(<App />);
    await screen.findByRole('checkbox', { name: 'Mentoring' });
    selectSection('Recommendations');
    fireEvent.click(screen.getByRole('button', { name: 'Generate recommendations' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ask about this' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.click(await screen.findByRole('link', { name: 'View opportunity' }));
    const identity = screen.getByLabelText('Demo identity');
    fireEvent.change(identity, { target: { value: 'admin' } });
    fireEvent.change(identity, { target: { value: 'nurse' } });
    await act(async () => lookup.resolve(jsonResponse(opportunity)));
    expect(screen.getByRole('tab', { name: 'My profile' }).getAttribute('aria-selected')).toBe('true');
    expect(document.getElementById('opportunity-outside-page')).toBeNull();
  });
});

describe('Profile options integration', () => {
  it('loads the opportunity catalog for an administrator', async () => {
    const fetch = vi.fn((url) => {
      if (url.endsWith('/opportunities')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url.endsWith('/support-requests')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url.endsWith('/profile/options') || url.endsWith('/opportunities/options')) {
        return Promise.resolve(profileOptionsResponse());
      }
      if (url.endsWith('/profile')) return Promise.resolve(profileResponse());
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    render(<App />);
    fireEvent.change(screen.getByLabelText('Demo identity'), { target: { value: 'admin' } });

    const group = await screen.findByRole('group', { name: 'Required skills' });
    expect(within(group).getByRole('checkbox', { name: 'Critical care' })).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith('/api/v1/opportunities/options', expect.objectContaining({
      headers: expect.objectContaining({ 'X-Demo-User': 'admin' }),
    }));
    expect(screen.getByRole('button', { name: 'Create listing' }).disabled).toBe(false);
  });

  it('does not enable listing creation when the opportunity catalog fails to load', async () => {
    const fetch = vi.fn((url) => {
      if (url.endsWith('/opportunities') || url.endsWith('/support-requests')) {
        return Promise.resolve(jsonResponse({ items: [] }));
      }
      if (url.endsWith('/opportunities/options')) {
        return Promise.resolve(jsonResponse({ error: { message: 'Catalog unavailable.' } }, 503));
      }
      if (url.endsWith('/profile/options')) return Promise.resolve(profileOptionsResponse());
      if (url.endsWith('/profile')) return Promise.resolve(profileResponse());
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    render(<App />);
    fireEvent.change(screen.getByLabelText('Demo identity'), { target: { value: 'admin' } });

    expect((await screen.findByRole('alert')).textContent).toContain('Catalog unavailable.');
    expect(screen.getByRole('button', { name: 'Create listing' }).disabled).toBe(true);
  });

  it('shows catalog load errors instead of substituting local choices', async () => {
    const fetch = vi.fn((url) => {
      if (url.endsWith('/opportunities')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url.endsWith('/support-requests')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url.endsWith('/profile/options')) return Promise.resolve(jsonResponse(
        { error: { message: 'Catalog unavailable.' } }, 503,
      ));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    render(<App />);

    expect((await screen.findByRole('alert')).textContent).toContain('Catalog unavailable.');
    expect(screen.queryByRole('checkbox', { name: 'Mentoring' })).toBeNull();
    expect(fetch.mock.calls.some(([url]) => url.endsWith('/profile'))).toBe(false);
  });

  it('loads catalog values, ignores legacy values, and saves only selected arrays', async () => {
    const fetch = vi.fn((url, options = {}) => {
      if (url.endsWith('/opportunities')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url.endsWith('/support-requests')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url.endsWith('/profile/options')) return Promise.resolve(profileOptionsResponse());
      if (url.endsWith('/profile') && options.method === 'PUT') return Promise.resolve(jsonResponse({}));
      if (url.endsWith('/profile')) return Promise.resolve(jsonResponse({
        skills: ['mentoring', 'legacy skill'],
        interests: ['education'],
        availability: ['weekday_morning'],
        recommendations_opt_in: true,
      }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    render(<App />);

    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Mentoring' }).checked).toBe(true));
    expect(screen.queryByRole('checkbox', { name: 'legacy skill' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => {
      const save = fetch.mock.calls.find(([url, options]) =>
        url.endsWith('/profile') && options.method === 'PUT');
      expect(JSON.parse(save[1].body)).toEqual({
        skills: ['mentoring'],
        interests: ['education'],
        availability: ['weekday_morning'],
        recommendations_opt_in: true,
      });
    });
  });
});


// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import NavigatorView from './NavigatorView';
import OpportunitiesView from './OpportunitiesView';
import ProfileView from './ProfileView';
import RecommendationsView from './RecommendationsView';

afterEach(cleanup);

describe('ProfileView', () => {
  it('passes the profile draft to the parent save handler', async () => {
    const onSaveProfile = vi.fn();
    const profile = {
      skills: ' CPR, , mentoring ',
      interests: ' leadership ',
      availability: ' weekday_morning, ',
      recommendations_opt_in: true,
    };

    render(<ProfileView
      panelProps={{}}
      profile={profile}
      setProfile={vi.fn()}
      onSaveProfile={onSaveProfile}
      onRecommendationsOptOut={vi.fn()}
    />);
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(onSaveProfile).toHaveBeenCalledWith(profile));
  });

  it('immediately clears Navigator state when recommendations are unchecked', () => {
    const profile = { skills: '', interests: '', availability: '', recommendations_opt_in: true };
    const setProfile = vi.fn();
    const onRecommendationsOptOut = vi.fn();
    render(<ProfileView
      panelProps={{}}
      profile={profile}
      setProfile={setProfile}
      onSaveProfile={vi.fn()}
      onRecommendationsOptOut={onRecommendationsOptOut}
    />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable recommendations' }));

    expect(setProfile).toHaveBeenCalledWith({ ...profile, recommendations_opt_in: false });
    expect(onRecommendationsOptOut).toHaveBeenCalledOnce();
  });
});

describe('OpportunitiesView', () => {
  const opportunity = {
    id: 7,
    title: 'Mentoring',
    description: 'Help colleagues',
    category: 'mentoring',
    status: 'open',
    required_skills: [],
    updated_at: '2026-01-01',
  };

  it('shows listings without administrator controls to nurses', () => {
    render(
      <OpportunitiesView
        panelProps={{}}
        user="nurse"
        opportunities={[opportunity]}
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Mentoring' })
    ).toBeTruthy();

    expect(screen.getByText(/Required skills: None/)).toBeTruthy();

    expect(
      screen.queryByRole('button', { name: 'Close listing' })
    ).toBeNull();

    expect(
      screen.queryByRole('button', { name: 'Create listing' })
    ).toBeNull();
  });

  it('allows administrators to close a listing and refresh', async () => {
    const api = vi.fn().mockResolvedValue({});
    const refresh = vi.fn().mockResolvedValue();
    const run = vi.fn(action => action());

    render(
      <OpportunitiesView
        panelProps={{}}
        user="admin"
        opportunities={[opportunity]}
        api={api}
        run={run}
        refresh={refresh}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Close listing' })
    );

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());

    expect(api).toHaveBeenCalledWith(
      '/opportunities/7',
      'PUT',
      {
        title: 'Mentoring',
        description: 'Help colleagues',
        category: 'mentoring',
        status: 'closed',
        required_skills: [],
      }
    );

    expect(run).toHaveBeenCalledWith(
      expect.any(Function),
      'Listing status updated.'
    );
  });
});

describe('RecommendationsView', () => {
  it('calls the parent handler to generate recommendations', () => {
    const onGenerate = vi.fn();

    render(
      <RecommendationsView
        panelProps={{}}
        recommendations={[]}
        onGenerate={onGenerate}
        onAskAbout={vi.fn()}
      />
    );

    expect(
      screen.getByText('No recommendations displayed yet.')
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Generate recommendations',
      })
    );

    expect(onGenerate).toHaveBeenCalledOnce();
  });

  it('displays recommendations and allows asking about them', () => {
    const onAskAbout = vi.fn();

    const recommendations = [
      {
        id: 1,
        rank: 1,
        opportunity: {
          title: 'Mentoring',
        },
        explanation: 'Matches your professional interests.',
      },
    ];

    render(
      <RecommendationsView
        panelProps={{}}
        recommendations={recommendations}
        onGenerate={vi.fn()}
        onAskAbout={onAskAbout}
      />
    );

    expect(
      screen.getByText('Matches your professional interests.')
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', { name: 'Ask about this' })
    );

    expect(onAskAbout).toHaveBeenCalledWith(1);
  });
});

describe('NavigatorView', () => {
  it('renders conversation history, omitted exchanges, and a pending question', () => {
    render(
      <NavigatorView
        panelProps={{}}
        tabbed={false}
        chat="Follow-up?"
        setChat={vi.fn()}
        recommendationId=""
        conversation={[{
          question: 'Earlier question?',
          response: {
            answer: 'Earlier answer.',
            escalation_suggested: true,
          },
          omittedExchanges: 2,
        }]}
        pending={{ question: 'Follow-up?', omittedExchanges: 2 }}
        error=""
        blocked={false}
        canSubmit
        onSubmit={vi.fn()}
        onNewConversation={vi.fn()}
      />
    );

    expect(screen.getByText('Earlier question?')).toBeTruthy();
    expect(screen.getByText('Earlier answer.')).toBeTruthy();
    expect(screen.getByText('Waiting for Career Navigator…')).toBeTruthy();
    expect(screen.getAllByRole('note')).toHaveLength(2);
    expect(screen.getByText('Consider submitting a support request below.')).toBeTruthy();
  });
});

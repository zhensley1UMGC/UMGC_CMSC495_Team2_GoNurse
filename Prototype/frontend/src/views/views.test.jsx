
 // @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OpportunitiesView from './OpportunitiesView';
import ProfileView from './ProfileView';
import RecommendationsView from './RecommendationsView';

afterEach(cleanup);

describe('ProfileView', () => {
  it('submits trimmed profile fields and the opt-in choice', async () => {
    const api = vi.fn().mockResolvedValue({});
    const run = vi.fn(action => action());
    const onProfileSaved = vi.fn();
    const profile = {
      skills: ' CPR, , mentoring ',
      interests: ' leadership ',
      availability: ' weekday_morning, ',
      recommendations_opt_in: true,
    };

    render(
      <ProfileView
        panelProps={{}}
        profile={profile}
        setProfile={vi.fn()}
        api={api}
        run={run}
        onProfileSaved={onProfileSaved}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/profile', 'PUT', {
        skills: ['CPR', 'mentoring'],
        interests: ['leadership'],
        availability: ['weekday_morning'],
        recommendations_opt_in: true,
      })
    );

    expect(run).toHaveBeenCalledWith(
      expect.any(Function),
      'Profile saved.'
    );
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

    expect(screen.getByRole('heading', { name: 'Mentoring' })).toBeTruthy();
    expect(screen.getByText(/Required skills: None/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close listing' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create listing' })).toBeNull();
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

    fireEvent.click(screen.getByRole('button', { name: 'Close listing' }));

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());

    expect(api).toHaveBeenCalledWith('/opportunities/7', 'PUT', {
      title: 'Mentoring',
      description: 'Help colleagues',
      category: 'mentoring',
      status: 'closed',
      required_skills: [],
    });

    expect(run).toHaveBeenCalledWith(
      expect.any(Function),
      'Listing status updated.'
    );
  });
});

describe('RecommendationsView', () => {
  it('calls the recommendation generator when clicked', () => {
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
      screen.getByRole('button', { name: 'Generate recommendations' })
    );

    expect(onGenerate).toHaveBeenCalledOnce();
  });

  it('displays recommendations and allows users to ask about them', () => {
    const onAskAbout = vi.fn();

    const recommendations = [
      {
        id: 1,
        rank: 1,
        opportunity: { title: 'Mentoring' },
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

    expect(screen.getByText('Matches your professional interests.')).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', { name: 'Ask about this' })
    );

    expect(onAskAbout).toHaveBeenCalledWith(1);
  });
});

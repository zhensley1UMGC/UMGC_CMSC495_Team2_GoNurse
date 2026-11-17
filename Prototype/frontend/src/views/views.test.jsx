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
    const profile = {
      skills: ' CPR, , mentoring ',
      interests: ' leadership ',
      availability: ' weekday_morning, ',
      recommendations_opt_in: true,
    };

    render(<ProfileView panelProps={{}} profile={profile} setProfile={vi.fn()} api={api} run={run} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(api).toHaveBeenCalledWith('/profile', 'PUT', {
      skills: ['CPR', 'mentoring'],
      interests: ['leadership'],
      availability: ['weekday_morning'],
      recommendations_opt_in: true,
    }));
    expect(run).toHaveBeenCalledWith(expect.any(Function), 'Profile saved.');
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
    render(<OpportunitiesView panelProps={{}} user="nurse" opportunities={[opportunity]} />);

    expect(screen.getByRole('heading', { name: 'Mentoring' })).toBeTruthy();
    expect(screen.getByText(/Required skills: None/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close listing' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create listing' })).toBeNull();
  });

  it('allows administrators to close a listing and refresh', async () => {
    const api = vi.fn().mockResolvedValue({});
    const refresh = vi.fn().mockResolvedValue();
    const run = vi.fn(action => action());
    render(<OpportunitiesView panelProps={{}} user="admin" opportunities={[opportunity]} api={api} run={run} refresh={refresh} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close listing' }));

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(api).toHaveBeenCalledWith('/opportunities/7', 'PUT', {
      title: 'Mentoring',
      description: 'Help colleagues',
      category: 'mentoring',
      status: 'closed',
      required_skills: [],
    });
    expect(run).toHaveBeenCalledWith(expect.any(Function), 'Listing status updated.');
  });
});

describe('RecommendationsView', () => {
  it('requests recommendations and stores the returned items', async () => {
    const items = [{ id: 1 }];
    const api = vi.fn().mockResolvedValue({ items });
    const setRecommendations = vi.fn();
    const run = vi.fn(action => action());
    render(<RecommendationsView panelProps={{}} recommendations={[]} setRecommendations={setRecommendations} api={api} run={run} />);

    expect(screen.getByText('No recommendations displayed yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Generate recommendations' }));

    await waitFor(() => expect(setRecommendations).toHaveBeenCalledWith(items));
    expect(api).toHaveBeenCalledWith('/recommendations', 'POST', { limit: 5 });
    expect(run).toHaveBeenCalledWith(expect.any(Function), 'Recommendations updated.');
  });
});

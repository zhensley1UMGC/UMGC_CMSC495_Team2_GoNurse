
// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NavigatorView from './NavigatorView';
import OpportunitiesView from './OpportunitiesView';
import ProfileView from './ProfileView';
import RecommendationsView from './RecommendationsView';

afterEach(cleanup);

describe('ProfileView', () => {
  const profileOptions = {
    skills: [
      { value: 'mentoring', label: 'Mentoring' },
      { value: 'critical care', label: 'Critical care' },
    ],
    interests: [{ value: 'education', label: 'Education' }],
    availability: [
      { value: 'weekday_morning', label: 'Weekday mornings' },
      { value: 'weekends', label: 'Weekends' },
    ],
  };

  it('passes the profile draft to the parent save handler', async () => {
    const onSaveProfile = vi.fn();
    const profile = {
      skills: ['mentoring'],
      interests: ['education'],
      availability: ['weekday_morning'],
      recommendations_opt_in: true,
    };

    render(<ProfileView
      panelProps={{}}
      profile={profile}
      profileOptions={profileOptions}
      setProfile={vi.fn()}
      onSaveProfile={onSaveProfile}
      onRecommendationsOptOut={vi.fn()}
    />);
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(onSaveProfile).toHaveBeenCalledWith(profile));
  });

  it('immediately clears Navigator state when recommendations are unchecked', () => {
    const profile = { skills: [], interests: [], availability: [], recommendations_opt_in: true };
    const setProfile = vi.fn();
    const onRecommendationsOptOut = vi.fn();
    render(<ProfileView
      panelProps={{}}
      profile={profile}
      profileOptions={profileOptions}
      setProfile={setProfile}
      onSaveProfile={vi.fn()}
      onRecommendationsOptOut={onRecommendationsOptOut}
    />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable recommendations' }));

    expect(setProfile).toHaveBeenCalledWith({ ...profile, recommendations_opt_in: false });
    expect(onRecommendationsOptOut).toHaveBeenCalledOnce();
  });

  it('renders accessible checkbox groups and independently toggles array values', () => {
    let profile = { skills: [], interests: [], availability: [], recommendations_opt_in: false };
    let view;
    const renderView = () => <ProfileView
        panelProps={{}}
        profile={profile}
        profileOptions={profileOptions}
        setProfile={next => {
          profile = next;
          view.rerender(renderView());
        }}
        onSaveProfile={vi.fn()}
        onRecommendationsOptOut={vi.fn()}
      />;
    view = render(renderView());

    expect(screen.getByRole('group', { name: 'Skills' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Interests' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Availability' })).toBeTruthy();
    const skills = within(screen.getByRole('group', { name: 'Skills' }));
    fireEvent.click(skills.getByRole('checkbox', { name: 'Mentoring' }));
    expect(profile.skills).toEqual(['mentoring']);
    fireEvent.click(skills.getByRole('checkbox', { name: 'Critical care' }));
    expect(profile.skills).toEqual(['mentoring', 'critical care']);
    fireEvent.click(skills.getByRole('checkbox', { name: 'Mentoring' }));
    expect(profile.skills).toEqual(['critical care']);
    fireEvent.click(within(screen.getByRole('group', { name: 'Availability' }))
      .getByRole('checkbox', { name: 'Weekends' }));
    expect(profile.availability).toEqual(['weekends']);
  });
});

describe('OpportunitiesView', () => {
  const optionCatalog = {
    skills: [{ value: 'mentoring', label: 'Mentoring' }, { value: 'critical care', label: 'Critical care' }],
    interests: [{ value: 'education', label: 'Education' }],
    availability: [{ value: 'weekday_morning', label: 'Weekday mornings' }],
  };
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
        optionCatalog={optionCatalog}
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

  it('creates a listing with selected canonical values and resets the form', async () => {
    const api = vi.fn().mockResolvedValue({});
    const refresh = vi.fn().mockResolvedValue();
    const run = vi.fn(action => action());
    render(<OpportunitiesView panelProps={{}} user="admin" opportunities={[]}
      optionCatalog={optionCatalog} api={api} run={run} refresh={refresh} />);

    fireEvent.change(screen.getByLabelText('title'), { target: { value: 'New project' } });
    fireEvent.change(screen.getByLabelText('description'), { target: { value: 'Help colleagues' } });
    const skills = within(screen.getByRole('group', { name: 'Required skills' }));
    fireEvent.click(skills.getByRole('checkbox', { name: 'Mentoring' }));
    fireEvent.click(skills.getByRole('checkbox', { name: 'Critical care' }));
    fireEvent.click(skills.getByRole('checkbox', { name: 'Mentoring' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Interests' }))
      .getByRole('checkbox', { name: 'Education' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Availability' }))
      .getByRole('checkbox', { name: 'Weekday mornings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create listing' }));

    await waitFor(() => expect(api).toHaveBeenCalledWith('/opportunities', 'POST', {
      title: 'New project',
      description: 'Help colleagues',
      category: 'project',
      required_skills: ['critical care'],
      interests: ['education'],
      availability: ['weekday_morning'],
      status: 'open',
    }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(skills.getByRole('checkbox', { name: 'Critical care' }).checked).toBe(false);
  });

  it('prevents creating a listing until the catalog has loaded', () => {
    render(<OpportunitiesView panelProps={{}} user="admin" opportunities={[]} optionCatalog={null} />);
    expect(screen.getByRole('button', { name: 'Create listing' }).disabled).toBe(true);
  });
});

describe('NavigatorView', () => {
  it('offers support for every escalated exchange and not for other answers', () => {
    const onRequestSupport = vi.fn();
    const conversation = [true, false, true].map((escalation, index) => ({
      question: `Question ${index + 1}`,
      response: { answer: `Answer ${index + 1}`, referenced_opportunity_ids: [], escalation_suggested: escalation },
    }));
    render(<NavigatorView panelProps={{}} chat="" setChat={vi.fn()} recommendationId=""
      conversation={conversation} recommendationsEnabled canSubmit={false}
      onRequestSupport={onRequestSupport} />);

    const exchanges = screen.getAllByRole('article');
    expect(within(exchanges[0]).getByRole('button', { name: 'Request human support' })).toBeTruthy();
    expect(within(exchanges[0]).getByText(/opens a support request form/i)).toBeTruthy();
    expect(within(exchanges[0]).getByText(/nothing is sent until you submit/i)).toBeTruthy();
    expect(within(exchanges[1]).queryByRole('button', { name: 'Request human support' })).toBeNull();
    expect(within(exchanges[1]).queryByText(/opens a support request form/i)).toBeNull();
    const action = within(exchanges[2]).getByRole('button', { name: 'Request human support' });
    expect(action.type).toBe('button');
    fireEvent.click(action);
    expect(onRequestSupport).toHaveBeenCalledOnce();
  });

  it('renders Markdown and cited opportunities as linked summary cards', () => {
    const opportunityId = '10000000-0000-4000-8000-000000000001';
    const opportunity = {
      id: opportunityId,
      title: 'Nurse mentoring committee',
      description: 'Help nurses mentor new colleagues.',
    };
    const onViewOpportunity = vi.fn();
    const { container } = render(<NavigatorView
      panelProps={{}}
      chat=""
      setChat={vi.fn()}
      recommendationId=""
      conversation={[{
        question: 'What is available?',
        omittedExchanges: 0,
        response: {
          answer: `Current options: - **Nurse mentoring committee** — Help nurses mentor new colleagues. (ID: ${opportunityId}) - **Pediatric education project** — Create learning resources.`,
          referenced_opportunity_ids: [opportunityId],
          escalation_suggested: false,
        },
      }]}
      pending={null}
      error=""
      preferenceChanged={false}
      recommendationsEnabled
      canSubmit={false}
      onSubmit={vi.fn()}
      onNewConversation={vi.fn()}
      opportunities={[opportunity]}
      onViewOpportunity={onViewOpportunity}
    />);

    expect(container.querySelector('.navigator-answer ul')).toBeTruthy();
    expect(container.textContent).not.toContain(opportunityId);
    expect(screen.getByRole('heading', { name: opportunity.title })).toBeTruthy();
    expect(screen.getByText(opportunity.description)).toBeTruthy();

    const link = screen.getByRole('link', { name: 'View opportunity' });
    expect(link.getAttribute('href')).toBe(`#opportunity-${opportunityId}`);
    fireEvent.click(link);
    expect(onViewOpportunity).toHaveBeenCalledWith(opportunityId);
  });
});

describe('RecommendationsView', () => {
  it('calls the parent handler to generate recommendations', () => {
    const onGenerate = vi.fn();

    render(
      <RecommendationsView
        panelProps={{}}
        recommendations={[]}
        api={vi.fn()}
        run={vi.fn()}
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

  it('explains why an empty result set has no recommendations', () => {
    render(
      <RecommendationsView
        panelProps={{}}
        recommendations={[]}
        recommendationsGenerated
        api={vi.fn()}
        run={vi.fn()}
        onGenerate={vi.fn()}
        onAskAbout={vi.fn()}
      />
    );

    expect(screen.getByRole('status').textContent).toContain('All required skills must match');
    expect(screen.getByRole('status').textContent).toContain('any listed availability must match');
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
        api={vi.fn()}
        run={vi.fn()}
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
        preferenceChanged={false}
        recommendationsEnabled
        canSubmit
        onSubmit={vi.fn()}
        onNewConversation={vi.fn()}
      />
    );

    expect(screen.getByText('Earlier question?')).toBeTruthy();
    expect(screen.getByText('Earlier answer.')).toBeTruthy();
    expect(screen.getByText('Waiting for Career Navigator…')).toBeTruthy();
    expect(screen.getAllByText(/Earlier exchanges omitted from this request/)).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Request human support' })).toBeTruthy();
  });
});

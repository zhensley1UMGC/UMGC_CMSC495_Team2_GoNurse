
import React from 'react';
import OptionCheckboxGroup from './OptionCheckboxGroup';

export default function ProfileView({
  panelProps,
  profile,
  profileOptions,
  setProfile,
  onSaveProfile,
  onRecommendationsOptOut,
}) {
  return (
    <section {...panelProps}>
      <h2 id="heading-profile">My profile</h2>

      <p>Select any number of choices in each group.</p>

      <form onSubmit={event => {
        event.preventDefault();
        onSaveProfile(profile);
      }}>
        {[
          ['skills', 'Skills'],
          ['interests', 'Interests'],
          ['availability', 'Availability'],
        ].map(([field, title]) => (
          <OptionCheckboxGroup
            key={field}
            title={title}
            options={profileOptions[field]}
            values={profile[field]}
            onChange={values => setProfile({ ...profile, [field]: values })}
          />
        ))}

        <label className="check">
          <input
            id="recommendations-opt-in"
            type="checkbox"
            checked={profile.recommendations_opt_in}
            onChange={event => {
              setProfile({
                ...profile,
                recommendations_opt_in: event.target.checked,
              });
              if (!event.target.checked) onRecommendationsOptOut();
            }}
          />
          Enable recommendations
        </label>

        <button type="submit">Save profile</button>
      </form>
    </section>
  );
}

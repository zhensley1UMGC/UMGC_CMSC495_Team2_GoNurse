
import React from 'react';

export default function ProfileView({
  panelProps,
  profile,
  setProfile,
  onSaveProfile,
  onRecommendationsOptOut,
}) {
  return (
    <section {...panelProps}>
      <h2>My profile</h2>

      <p>
        Separate items with commas. Example availability: weekday_morning.
      </p>

      <form onSubmit={event => {
        event.preventDefault();
        onSaveProfile(profile);
      }}>
        {['skills', 'interests', 'availability'].map(field => (
          <label key={field}>
            {field}
            <input
              value={profile[field]}
              onChange={event =>
                setProfile({
                  ...profile,
                  [field]: event.target.value,
                })
              }
            />
          </label>
        ))}

        <label className="check">
          <input
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

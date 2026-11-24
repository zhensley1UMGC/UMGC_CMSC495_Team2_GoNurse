import React from 'react';

export default function OptionCheckboxGroup({ title, options, values, onChange }) {
  return (
    <fieldset className="profile-options">
      <legend>{title}</legend>
      <div className="profile-option-list">
        {options.map(option => (
          <label className="profile-option" key={option.value}>
            <input
              type="checkbox"
              checked={values.includes(option.value)}
              onChange={event => onChange(event.target.checked
                ? [...new Set([...values, option.value])]
                : values.filter(value => value !== option.value))}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

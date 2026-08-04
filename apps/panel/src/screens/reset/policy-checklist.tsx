import { PASSWORD_RULES } from './password-policy.js';
import './reset.css';

/**
 * Live ✓/○ per rule (S-02 §4, §8): state is never carried by colour alone —
 * each row has a glyph as well as a colour — and the list is aria-live so a
 * change is announced, not merely coloured.
 */
export function PolicyChecklist({ value, confirm }: { value: string; confirm: string }): JSX.Element {
  return (
    <div className="us-policy">
      <div className="us-policy__heading">PASSWORD MUST</div>
      <ul className="us-policy__list" aria-live="polite">
        {PASSWORD_RULES.map((rule) => {
          const met = rule.test(value, confirm);
          return (
            <li
              key={rule.id}
              className={met ? 'us-policyrow us-policyrow--met' : 'us-policyrow us-policyrow--unmet'}
            >
              <span aria-hidden="true">{met ? '✓' : '○'}</span>
              {rule.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

import { Link } from 'react-router';
import type { Problem, UserRole } from '@eduscope/shared';

const REMEDIES: Partial<Record<Problem['code'], string>> = {
  'provisioning.incomplete': '/advanced/device',
  'volume.unavailable': '/advanced/storage',
  'storage.critical': '/advanced/storage',
  'config.invalid': '/advanced/local-capture',
};

export function StartRefusal({ problem, role }: { readonly problem: Problem; readonly role: UserRole | null }) {
  const remedy = REMEDIES[problem.code];
  return (
    <div className="us-startrefusal" role="alert">
      <strong>{problem.title}</strong>
      {problem.detail ? <span>{problem.detail}</span> : null}
      {role === 'admin' && remedy ? <Link to={remedy}>Open the fixing screen</Link> : null}
    </div>
  );
}

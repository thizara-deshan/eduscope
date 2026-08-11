import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import type { ResolveJoinCodeResponse } from '@eduscope/shared';
import { Button } from '../../components/ui/button.js';
import { fieldMessage, type FieldViolation } from './field-problem.js';
import { PolicyField } from './policy-field.js';

type RegistrationPolicy = ResolveJoinCodeResponse['registrationPolicy'];

interface FormValues {
  fullName: string;
  studentIdNumber: string;
}

export function RegistrationForm({
  policy,
  onSubmit,
  submitting,
  disabled,
  fieldViolations,
}: {
  policy: RegistrationPolicy;
  onSubmit: (values: FormValues) => void;
  submitting: boolean;
  disabled: boolean;
  fieldViolations?: readonly FieldViolation[] | undefined;
}) {
  const { register, handleSubmit, setFocus } = useForm<FormValues>({
    defaultValues: { fullName: '', studentIdNumber: '' },
  });

  const nameError = fieldMessage(fieldViolations, '/fullName');
  const idError = fieldMessage(fieldViolations, '/studentIdNumber');

  useEffect(() => {
    if (nameError) setFocus('fullName');
    else if (idError) setFocus('studentIdNumber');
  }, [nameError, idError, setFocus]);

  const submit = handleSubmit((values) => {
    onSubmit({ fullName: values.fullName.trim(), studentIdNumber: values.studentIdNumber.trim() });
  });

  return (
    // Server problems stay authoritative (frontend-conventions §1) — the
    // `pattern`/`maxLength` attributes are advisory (mobile keyboard hints),
    // not a client-side gate, so `noValidate` keeps every submit reaching it.
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <PolicyField
        label="Full name"
        maxLength={policy.fullNameMaxLength}
        error={nameError}
        disabled={disabled || submitting}
        autoComplete="off"
        {...register('fullName', { required: true })}
        id="fullName"
      />
      <PolicyField
        label="Student ID"
        maxLength={policy.studentIdMaxLength}
        pattern={policy.studentIdPattern}
        inputMode={policy.inputMode}
        hint={policy.studentIdHint}
        error={idError}
        disabled={disabled || submitting}
        autoComplete="off"
        autoCapitalize="characters"
        {...register('studentIdNumber', { required: true })}
        id="studentIdNumber"
      />
      <Button type="submit" size="block" disabled={disabled || submitting}>
        {submitting ? 'Joining…' : 'Join'}
      </Button>
    </form>
  );
}

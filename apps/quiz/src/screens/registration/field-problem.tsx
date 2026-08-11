export interface FieldViolation {
  readonly pointer: string;
  readonly message: string;
}

export function fieldMessage(violations: readonly FieldViolation[] | undefined, pointer: string): string | undefined {
  return violations?.find((v) => v.pointer === pointer)?.message;
}

export function FieldProblem({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-sm font-medium text-danger">
      {message}
    </p>
  );
}

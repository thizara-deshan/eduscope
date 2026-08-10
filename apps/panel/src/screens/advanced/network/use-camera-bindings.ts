import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PhysicalInput, SourceRoleId, SourceStatus } from '@eduscope/shared';
import { useClient } from '../../../client/client-provider.js';
import { useSourceStatus } from '../../../store/selectors.js';

const PHYSICAL_INPUTS_KEY = ['physical-inputs'] as const;
const SOURCE_BINDINGS_KEY = ['source-bindings'] as const;

export interface CameraCard {
  readonly roleId: SourceRoleId;
  readonly inputId: string;
  readonly address: string;
  readonly status: SourceStatus | undefined;
}

export interface UseCameraBindings {
  readonly cameras: CameraCard[];
  readonly loading: boolean;
  /** Edits the camera address in exactly one place (INV-PI-2) — updatePhysicalInput. */
  saveAddress(inputId: string, address: string): void;
  readonly savingId: string | null;
}

function useCamera(roleId: SourceRoleId, inputs: PhysicalInput[] | undefined, bindings: { roleId: SourceRoleId; physicalInputId: string | null; enabled: boolean }[] | undefined): CameraCard | null {
  const status = useSourceStatus(roleId);
  const binding = bindings?.find((b) => b.roleId === roleId && b.enabled);
  const input = binding?.physicalInputId ? inputs?.find((i) => i.id === binding.physicalInputId) : undefined;
  if (!input) return null;
  return { roleId, inputId: input.id, address: input.address, status };
}

/** S-28 camera-ip cards: `lecturer-cam` / `students-cam` bound roles, merged with live sources.status. */
export function useCameraBindings(): UseCameraBindings {
  const client = useClient();
  const queryClient = useQueryClient();

  const inputsQuery = useQuery({ queryKey: PHYSICAL_INPUTS_KEY, queryFn: () => client.listPhysicalInputs() });
  const bindingsQuery = useQuery({ queryKey: SOURCE_BINDINGS_KEY, queryFn: () => client.listSourceBindings() });

  const lecturerCam = useCamera('lecturer-cam', inputsQuery.data, bindingsQuery.data);
  const studentsCam = useCamera('students-cam', inputsQuery.data, bindingsQuery.data);
  const cameras = [lecturerCam, studentsCam].filter((c): c is CameraCard => c !== null);

  const mutation = useMutation({
    mutationFn: ({ inputId, address }: { inputId: string; address: string }) =>
      client.updatePhysicalInput(inputId, { address }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: PHYSICAL_INPUTS_KEY });
    },
  });

  const saveAddress = (inputId: string, address: string) => {
    mutation.mutate({ inputId, address });
  };

  return {
    cameras,
    loading: inputsQuery.isLoading || bindingsQuery.isLoading,
    saveAddress,
    savingId: mutation.isPending ? mutation.variables?.inputId ?? null : null,
  };
}

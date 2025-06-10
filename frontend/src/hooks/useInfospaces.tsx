import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  InfospaceCreate,
  InfospaceRead,
  InfospaceUpdate,
} from '@/client/models';
import { InfospacesService } from '@/client/services';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';

const fetchInfospaces = async (): Promise<InfospaceRead[]> => {
  const response = await InfospacesService.readInfospaces({});
  return response;
};

const createInfospace = async (
  Infospace: InfospaceCreate
): Promise<InfospaceRead> => {
  const response = await InfospacesService.createInfospace({
    requestBody: Infospace,
  });
  return response;
};

const deleteInfospace = async (InfospaceId: number): Promise<void> => {
  await InfospacesService.deleteInfospace({ InfospaceId });
};

const updateInfospace = async ({
  InfospaceId,
  data,
}: {
  InfospaceId: number;
  data: InfospaceUpdate;
}): Promise<InfospaceRead> => {
  const response = await InfospacesService.updateInfospace({
    InfospaceId,
    requestBody: data,
  });
  return response;
};

const useInfospaces = () => {
  const queryClient = useQueryClient();
  const { setActiveInfospace } = useInfospaceStore();

  const InfospacesQuery = useQuery({
    queryKey: ['Infospaces'],
    queryFn: fetchInfospaces,
  });

  const createInfospaceMutation = useMutation({
    mutationFn: createInfospace,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['Infospaces'] });
    },
  });

  const deleteInfospaceMutation = useMutation({
    mutationFn: deleteInfospace,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['Infospaces'] });
    },
  });

  const updateInfospaceMutation = useMutation({
    mutationFn: updateInfospace,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['Infospaces'] });
    },
  });

  return {
    InfospacesQuery,
    createInfospace: createInfospaceMutation.mutateAsync,
    deleteInfospace: deleteInfospaceMutation.mutateAsync,
    updateInfospace: updateInfospaceMutation.mutateAsync,
  };
};

export default useInfospaces;
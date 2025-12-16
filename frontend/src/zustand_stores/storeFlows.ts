import { create } from 'zustand';
import { FlowsService, FlowRead, FlowCreate, FlowUpdate, FlowExecutionRead } from '@/client';
import { useInfospaceStore } from './storeInfospace';
import { toast } from 'sonner';

interface FlowState {
  flows: FlowRead[];
  activeFlow: FlowRead | null;
  executions: FlowExecutionRead[];
  isLoading: boolean;
  isExecuting: boolean;
  error: string | null;
  
  // Actions
  fetchFlows: () => Promise<void>;
  createFlow: (flowData: FlowCreate) => Promise<FlowRead | null>;
  updateFlow: (flowId: number, flowData: FlowUpdate) => Promise<FlowRead | null>;
  deleteFlow: (flowId: number) => Promise<void>;
  activateFlow: (flowId: number) => Promise<FlowRead | null>;
  pauseFlow: (flowId: number) => Promise<FlowRead | null>;
  triggerExecution: (flowId: number, assetIds?: number[]) => Promise<FlowExecutionRead | null>;
  fetchExecutions: (flowId: number) => Promise<void>;
  setActiveFlow: (flow: FlowRead | null) => void;
  resetCursor: (flowId: number) => Promise<void>;
}

export const useFlowStore = create<FlowState>((set, get) => ({
  flows: [],
  activeFlow: null,
  executions: [],
  isLoading: false,
  isExecuting: false,
  error: null,

  fetchFlows: async () => {
    const activeInfospace = useInfospaceStore.getState().activeInfospace;
    if (!activeInfospace) {
      set({ flows: [], isLoading: false, error: 'No active infospace selected.' });
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const response = await FlowsService.listFlows({ 
        infospaceId: activeInfospace.id,
      });
      set({ flows: response.data, isLoading: false });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch flows.';
      console.error('Fetch flows error:', err);
      set({ isLoading: false, error: errorMessage });
      toast.error(errorMessage);
    }
  },

  createFlow: async (flowData) => {
    const activeInfospace = useInfospaceStore.getState().activeInfospace;
    if (!activeInfospace) {
      toast.error('No active infospace selected.');
      return null;
    }

    set({ isLoading: true, error: null });
    try {
      const newFlow = await FlowsService.createFlow({
        infospaceId: activeInfospace.id,
        requestBody: flowData,
      });
      set(state => ({
        flows: [...state.flows, newFlow],
        isLoading: false
      }));
      toast.success(`Flow "${newFlow.name}" created successfully`);
      return newFlow;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create flow.';
      console.error('Create flow error:', err);
      set({ isLoading: false, error: errorMessage });
      toast.error(errorMessage);
      return null;
    }
  },

  updateFlow: async (flowId, flowData) => {
    const activeInfospace = useInfospaceStore.getState().activeInfospace;
    if (!activeInfospace) {
      toast.error('No active infospace selected.');
      return null;
    }

    set({ isLoading: true, error: null });
    try {
      const updatedFlow = await FlowsService.updateFlow({
        infospaceId: activeInfospace.id,
        flowId,
        requestBody: flowData,
      });
      set(state => ({
        flows: state.flows.map(f => f.id === flowId ? updatedFlow : f),
        activeFlow: state.activeFlow?.id === flowId ? updatedFlow : state.activeFlow,
        isLoading: false
      }));
      toast.success('Flow updated successfully');
      return updatedFlow;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update flow.';
      console.error('Update flow error:', err);
      set({ isLoading: false, error: errorMessage });
      toast.error(errorMessage);
      return null;
    }
  },

  deleteFlow: async (flowId) => {
    const activeInfospace = useInfospaceStore.getState().activeInfospace;
    if (!activeInfospace) {
      toast.error('No active infospace selected.');
      return;
    }

    set({ isLoading: true, error: null });
    try {
      await FlowsService.deleteFlow({
        infospaceId: activeInfospace.id,
        flowId,
      });
      set(state => ({
        flows: state.flows.filter(f => f.id !== flowId),
        activeFlow: state.activeFlow?.id === flowId ? null : state.activeFlow,
        isLoading: false
      }));
      toast.success('Flow deleted successfully');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete flow.';
      console.error('Delete flow error:', err);
      set({ isLoading: false, error: errorMessage });
      toast.error(errorMessage);
    }
  },

  activateFlow: async (flowId) => {
    const activeInfospace = useInfospaceStore.getState().activeInfospace;
    if (!activeInfospace) {
      toast.error('No active infospace selected.');
      return null;
    }

    try {
      const activatedFlow = await FlowsService.activateFlow({
        infospaceId: activeInfospace.id,
        flowId,
      });
      set(state => ({
        flows: state.flows.map(f => f.id === flowId ? activatedFlow : f),
        activeFlow: state.activeFlow?.id === flowId ? activatedFlow : state.activeFlow,
      }));
      toast.success('Flow activated');
      return activatedFlow;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to activate flow.';
      console.error('Activate flow error:', err);
      toast.error(errorMessage);
      return null;
    }
  },

  pauseFlow: async (flowId) => {
    const activeInfospace = useInfospaceStore.getState().activeInfospace;
    if (!activeInfospace) {
      toast.error('No active infospace selected.');
      return null;
    }

    try {
      const pausedFlow = await FlowsService.pauseFlow({
        infospaceId: activeInfospace.id,
        flowId,
      });
      set(state => ({
        flows: state.flows.map(f => f.id === flowId ? pausedFlow : f),
        activeFlow: state.activeFlow?.id === flowId ? pausedFlow : state.activeFlow,
      }));
      toast.success('Flow paused');
      return pausedFlow;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to pause flow.';
      console.error('Pause flow error:', err);
      toast.error(errorMessage);
      return null;
    }
  },

  triggerExecution: async (flowId, assetIds) => {
    const activeInfospace = useInfospaceStore.getState().activeInfospace;
    if (!activeInfospace) {
      toast.error('No active infospace selected.');
      return null;
    }

    set({ isExecuting: true });
    try {
      const execution = await FlowsService.triggerFlowExecution({
        infospaceId: activeInfospace.id,
        flowId,
        requestBody: assetIds ? { asset_ids: assetIds } : undefined,
      });
      set(state => ({
        executions: [execution, ...state.executions],
        isExecuting: false
      }));
      toast.success('Flow execution triggered');
      return execution;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to trigger flow execution.';
      console.error('Trigger execution error:', err);
      set({ isExecuting: false });
      toast.error(errorMessage);
      return null;
    }
  },

  fetchExecutions: async (flowId) => {
    const activeInfospace = useInfospaceStore.getState().activeInfospace;
    if (!activeInfospace) {
      return;
    }

    try {
      const response = await FlowsService.listFlowExecutions({
        infospaceId: activeInfospace.id,
        flowId,
      });
      set({ executions: response.data });
    } catch (err) {
      console.error('Fetch executions error:', err);
    }
  },

  setActiveFlow: (flow) => {
    set({ activeFlow: flow });
    if (flow) {
      get().fetchExecutions(flow.id);
    } else {
      set({ executions: [] });
    }
  },

  resetCursor: async (flowId) => {
    const activeInfospace = useInfospaceStore.getState().activeInfospace;
    if (!activeInfospace) {
      toast.error('No active infospace selected.');
      return;
    }

    try {
      const updatedFlow = await FlowsService.resetFlowCursor({
        infospaceId: activeInfospace.id,
        flowId,
      });
      set(state => ({
        flows: state.flows.map(f => f.id === flowId ? updatedFlow : f),
        activeFlow: state.activeFlow?.id === flowId ? updatedFlow : state.activeFlow,
      }));
      toast.success('Flow cursor reset - will reprocess all assets');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to reset flow cursor.';
      console.error('Reset cursor error:', err);
      toast.error(errorMessage);
    }
  }
}));

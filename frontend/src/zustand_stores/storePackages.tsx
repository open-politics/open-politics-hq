/**
 * Package Store
 * =============
 *
 * State management for the Package sharing system.
 * Wraps PackagesService SDK methods directly — no service abstraction layer.
 */

import { create } from 'zustand';
import { toast } from 'sonner';
import {
  PackagesService,
  type app__api__routes__packages__PackageRead as PackageRead,
  type PackagePublicRead,
  type PackageItemRead,
  type PackageCreate,
  type PackageUpdate,
  type PackageItemCreate,
} from '@/client';
import { useInfospaceStore } from './storeInfospace';

export type { PackageRead, PackagePublicRead, PackageItemRead, PackageCreate, PackageUpdate, PackageItemCreate };

interface PackageState {
  // Data
  packages: PackageRead[];
  discoveredPackages: PackagePublicRead[];
  selectedPackage: PackageRead | null;

  // Loading
  isLoading: boolean;
  isLoadingDiscovery: boolean;
  error: string | null;

  // CRUD
  fetchPackages: () => Promise<void>;
  createPackage: (data: PackageCreate) => Promise<PackageRead | null>;
  updatePackage: (packageId: number, data: PackageUpdate) => Promise<void>;
  deletePackage: (packageId: number) => Promise<void>;
  selectPackage: (packageId: number) => Promise<void>;
  clearSelection: () => void;

  // Items
  addItem: (packageId: number, item: PackageItemCreate) => Promise<void>;
  removeItem: (packageId: number, itemId: number) => Promise<void>;

  // Discovery
  discoverPackages: (visibility?: string) => Promise<void>;

  // Token
  accessByToken: (token: string) => Promise<any>;
}

function getInfospaceId(): number | null {
  const { activeInfospace } = useInfospaceStore.getState();
  return activeInfospace?.id ?? null;
}

export const usePackageStore = create<PackageState>((set, get) => ({
  packages: [],
  discoveredPackages: [],
  selectedPackage: null,
  isLoading: false,
  isLoadingDiscovery: false,
  error: null,

  fetchPackages: async () => {
    const infospaceId = getInfospaceId();
    if (!infospaceId) return;

    set({ isLoading: true, error: null });
    try {
      const packages = await PackagesService.listPackages({ infospaceId });
      set({ packages: packages as PackageRead[], isLoading: false });
    } catch (e: any) {
      set({ error: e.message, isLoading: false });
    }
  },

  createPackage: async (data: PackageCreate) => {
    const infospaceId = getInfospaceId();
    if (!infospaceId) return null;

    try {
      const pkg = await PackagesService.createPackage({
        infospaceId,
        requestBody: data,
      });
      toast.success(`Package "${data.name}" created`);
      await get().fetchPackages();
      return pkg as PackageRead;
    } catch (e: any) {
      toast.error(`Failed to create package: ${e.message}`);
      return null;
    }
  },

  updatePackage: async (packageId: number, data: PackageUpdate) => {
    const infospaceId = getInfospaceId();
    if (!infospaceId) return;

    try {
      await PackagesService.updatePackage({
        infospaceId,
        packageId,
        requestBody: data,
      });
      toast.success("Package updated");
      await get().fetchPackages();
      // Refresh selection if this package is selected
      if (get().selectedPackage?.id === packageId) {
        await get().selectPackage(packageId);
      }
    } catch (e: any) {
      toast.error(`Failed to update package: ${e.message}`);
    }
  },

  deletePackage: async (packageId: number) => {
    const infospaceId = getInfospaceId();
    if (!infospaceId) return;

    try {
      await PackagesService.deletePackage({ infospaceId, packageId });
      toast.success("Package deleted");
      if (get().selectedPackage?.id === packageId) {
        set({ selectedPackage: null });
      }
      await get().fetchPackages();
    } catch (e: any) {
      toast.error(`Failed to delete package: ${e.message}`);
    }
  },

  selectPackage: async (packageId: number) => {
    const infospaceId = getInfospaceId();
    if (!infospaceId) return;

    try {
      const pkg = await PackagesService.getPackage({ infospaceId, packageId });
      set({ selectedPackage: pkg as PackageRead });
    } catch (e: any) {
      toast.error(`Failed to load package: ${e.message}`);
    }
  },

  clearSelection: () => set({ selectedPackage: null }),

  addItem: async (packageId: number, item: PackageItemCreate) => {
    const infospaceId = getInfospaceId();
    if (!infospaceId) return;

    try {
      await PackagesService.addPackageItem({
        infospaceId,
        packageId,
        requestBody: item,
      });
      toast.success("Item added to package");
      await get().selectPackage(packageId);
      await get().fetchPackages();
    } catch (e: any) {
      toast.error(`Failed to add item: ${e.message}`);
    }
  },

  removeItem: async (packageId: number, itemId: number) => {
    const infospaceId = getInfospaceId();
    if (!infospaceId) return;

    try {
      await PackagesService.removePackageItem({
        infospaceId,
        packageId,
        itemId,
      });
      toast.success("Item removed from package");
      await get().selectPackage(packageId);
      await get().fetchPackages();
    } catch (e: any) {
      toast.error(`Failed to remove item: ${e.message}`);
    }
  },

  discoverPackages: async (visibility = "public") => {
    set({ isLoadingDiscovery: true });
    try {
      const packages = await PackagesService.discoverPackages({ visibility });
      set({ discoveredPackages: packages as PackagePublicRead[], isLoadingDiscovery: false });
    } catch (e: any) {
      set({ isLoadingDiscovery: false });
      toast.error(`Failed to discover packages: ${e.message}`);
    }
  },

  accessByToken: async (token: string) => {
    try {
      return await PackagesService.accessPackageByToken({ token });
    } catch (e: any) {
      toast.error(`Failed to access package: ${e.message}`);
      return null;
    }
  },
}));

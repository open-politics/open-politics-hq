'use client';

import { useInfospaceStore } from '@/zustand_stores/storeInfospace';

export default function InfospaceSelector() {
  const { Infospaces, activeInfospace, setActiveInfospace } = useInfospaceStore();

  return (
    <div>
      <label htmlFor="Infospace-select" className="block text-sm font-medium text-gray-700">
        Select Active Infospace
      </label>
      <select
        id="Infospace-select"
        value={activeInfospace?.uid || ''}
        onChange={(e) => {
          const Infospace = Infospaces.find((w) => w.uid === Number(e.target.value));
          if (Infospace) setActiveInfospace(Infospace);
        }}
        className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
      >
        <option value="" disabled>
          -- Select Infospace --
        </option>
        {Infospaces.map((Infospace) => (
          <option key={Infospace.uid} value={Infospace.uid}>
            {Infospace.name}
          </option>
        ))}
      </select>
    </div>
  );
}
"use client";

/**
 * PanelHeaderSlot — shared passthrough for the ``PanelRenderer`` header.
 *
 * Panels own their role-picker state but the picker button visually belongs
 * in the header's ``ButtonGroup``. We pass the React node up via context so
 * ``RolePickerPopover``'s ``Button`` becomes a direct sibling of
 * Edit/Filter/Layout/Close — no intermediate DOM node breaks the segmented
 * styling.
 *
 * Critical design detail: the reader and the writer live on **separate**
 * contexts. If we used one shared context with a render-prop
 * (``{children(slotNode)}``), every ``setNode`` would re-render the panel
 * subtree that feeds ``setNode``, creating an infinite loop (new JSX
 * children each render → effect fires → setState → re-render → repeat).
 * With split contexts, only ``PanelHeaderSlotRenderer`` consumes the node
 * and re-renders on change; the panel itself stays off that dependency
 * chain, so ``setNode`` is idempotent at steady state.
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

const HeaderNodeContext = createContext<ReactNode>(null);
const SetHeaderNodeContext = createContext<(n: ReactNode) => void>(() => {});

export function PanelHeaderSlotProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<ReactNode>(null);
  return (
    <SetHeaderNodeContext.Provider value={setNode}>
      <HeaderNodeContext.Provider value={node}>
        {children}
      </HeaderNodeContext.Provider>
    </SetHeaderNodeContext.Provider>
  );
}

/** Renders whatever the active panel has assigned via ``<PanelHeaderSlot>``. */
export function PanelHeaderSlotRenderer() {
  return <>{useContext(HeaderNodeContext)}</>;
}

/** Called inside a panel — assigns ``children`` to the header slot. */
export function PanelHeaderSlot({ children }: { children: ReactNode }) {
  const setNode = useContext(SetHeaderNodeContext);
  useEffect(() => {
    setNode(children);
    return () => setNode(null);
  }, [setNode, children]);
  return null;
}

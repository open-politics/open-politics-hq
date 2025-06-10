import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useInfospaceStore } from "@/zustand_stores/storeInfospace";
import { IconPickerDialog } from "@/components/collection/infospaces/utilities/icons/IconPickerOverlay";
import { IconRenderer } from "@/components/collection/infospaces/utilities/icons/icon-picker";

interface EditInfospaceOverlayProps {
  open: boolean;
  onClose: () => void;
  InfospaceId?: number;
  defaultName?: string | undefined;
  defaultDescription?: string | undefined;
  defaultSources?: string[] | undefined;
  defaultIcon?: string | undefined;
  defaultSystemPrompt?: string | undefined;
  isCreating?: boolean;
  onCreateInfospace?: (name: string, description: string, icon: string, systemPrompt: string) => Promise<void>;
}

/**
 * Displays an overlay (dialog) allowing the user to edit an existing Infospace or create a new one.
 * Update logic is handled via the useInfospaceDataStore.
 */
export default function EditInfospaceOverlay({
  open,
  onClose,
  InfospaceId,
  defaultName,
  defaultDescription,
  defaultSources,
  defaultIcon,
  defaultSystemPrompt,
  isCreating = false,
  onCreateInfospace,
}: EditInfospaceOverlayProps) {
  const [name, setName] = useState(defaultName || "");
  const [description, setDescription] = useState(defaultDescription || "");
  const [sources, setSources] = useState(defaultSources?.join(", ") || "");
  const [icon, setIcon] = useState(defaultIcon || "Boxes");
  const [systemPrompt, setSystemPrompt] = useState(defaultSystemPrompt || "");
  const [errorMessage, setErrorMessage] = useState("");

  const { updateInfospace } = useInfospaceStore();

  useEffect(() => {
    setName(defaultName || "");
    setDescription(defaultDescription || "");
    setSources(defaultSources?.join(", ") || "");
    setIcon(defaultIcon || "Boxes");
    setSystemPrompt(defaultSystemPrompt || "");
  }, [defaultName, defaultDescription, defaultSources, defaultIcon, defaultSystemPrompt]);

  const handleSave = async () => {
    setErrorMessage("");
    
    if (!name.trim()) {
      setErrorMessage("Infospace name is required");
      return;
    }
    
    try {
      if (isCreating && onCreateInfospace) {
        await onCreateInfospace(
          name,
          description,
          icon,
          systemPrompt
        );
      } else if (InfospaceId) {
        await updateInfospace(InfospaceId, {
          name,
          description,
          icon,
        });
      }
      onClose();
    } catch (error) {
      setErrorMessage(isCreating ? "Failed to create Infospace. Please try again." : "Failed to update Infospace. Please try again.");
      console.error(isCreating ? "Error creating Infospace:" : "Error updating Infospace:", error);
    }
  };

  const dialogTitle = isCreating ? "Create New Infospace" : "Edit Infospace";
  const dialogDescription = isCreating 
    ? "Create a new Infospace and switch to it immediately." 
    : "Use this dialog to edit the Infospace details.";
  const buttonText = isCreating ? "Create & Switch" : "Save";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="rounded-lg shadow-xl bg-primary-900 m-4 max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-secondary-500">
            <div className="flex items-center justify-start gap-2 p-2 pl-0"> 
              <IconRenderer className="size-6" icon={icon} />
              <span className="text-blue-800 dark:text-green-500">{isCreating ? dialogTitle : name}</span>
            </div>
          </DialogTitle>
          <DialogDescription>
            {dialogDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col space-y-4 mt-4">
          <div>
            <label className="block text-sm text-secondary-300 mb-1">Name</label>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full p-3 bg-primary-800 border border-secondary-700 rounded-xl shadow-inner"
              placeholder="Infospace Name"
            />
          </div>

          <div>
            <label className="block text-sm text-secondary-300 mb-1">Description</label>
            <Input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-3 bg-primary-800 border border-secondary-700 rounded-xl shadow-inner"
              placeholder="Infospace Description"
            />
          </div>

          <div>
            <label className="block text-sm text-secondary-300 mb-1">Sources</label>
            <Input
              type="text"
              value={sources}
              onChange={(e) => setSources(e.target.value)}
              className="w-full p-3 bg-primary-800 border border-secondary-700 rounded-xl shadow-inner"
              placeholder="http://example.com, http://another.com"
            />
          </div>

          <div>
            <label className="block text-sm text-secondary-300 mb-1">Infospace System Prompt (Optional)</label>
            <Textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="w-full p-3 bg-primary-800 border border-secondary-700 rounded-xl shadow-inner text-sm font-mono"
              placeholder="Enter general instructions for AI classifications within this Infospace..."
              rows={4}
            />
            <p className="text-xs text-muted-foreground mt-1">This prompt will be combined with scheme-specific instructions.</p>
          </div>

          <div>
            <label className="block text-sm text-secondary-300 mb-1">Icon</label>
            <div className="flex items-center justify-start gap-2 p-2 pl-0">
              <IconPickerDialog onIconSelect={setIcon} defaultIcon={icon} />
            </div>
          </div>

          {errorMessage && <p className="text-red-400">{errorMessage}</p>}

          <div className="flex justify-end space-x-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSave} className="bg-green-600 hover:bg-green-500 text-primary-950">
              {buttonText}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
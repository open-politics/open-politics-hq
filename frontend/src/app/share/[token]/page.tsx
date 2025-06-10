'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation'; // Corrected import for App Router
import { useShareableStore } from '@/zustand_stores/storeShareables';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { useDatasetStore } from '@/zustand_stores/storeDatasets';
import { ShareableLinkRead, ResourceType } from '@/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, AlertCircle, CheckCircle, XCircle, InfoIcon } from 'lucide-react';
import { toast } from 'sonner';

export default function ShareTokenPage() {
  const params = useParams();
  const router = useRouter();
  const token = params?.token as string | undefined;

  const {
    accessSharedResource,
    // fetchLinkByToken, // Conceptual, not fully implemented in store
    isLoading: isLoadingShare,
    error: errorShare,
  } = useShareableStore((state) => ({
    accessSharedResource: state.accessSharedResource,
    // fetchLinkByToken: state.fetchLinkByToken, 
    isLoading: state.isLoading,
    error: state.error,
  }));

  const { importInfospaceFromToken, setActiveInfospace, fetchInfospaces } = useInfospaceStore((state) => ({
    importInfospaceFromToken: state.importInfospaceFromToken,
    setActiveInfospace: state.setActiveInfospace,
    fetchInfospaces: state.fetchInfospaces,
  }));

  const { importFromToken: importDatasetFromToken, fetchDatasets } = useDatasetStore((state) => ({
    importFromToken: state.importFromToken,
    fetchDatasets: state.fetchDatasets,
  }));

  const [sharedResourceInfo, setSharedResourceInfo] = useState<any | null>(null);
  const [linkInfo, setLinkInfo] = useState<ShareableLinkRead | null>(null); // For future use if fetchLinkByToken is enhanced
  const [processing, setProcessing] = useState(false);
  const [targetInfospaceId, setTargetInfospaceId] = useState<number | null>(null); // For dataset imports

  useEffect(() => {
    // Attempt to get active Infospace ID for dataset imports
    const activeWsId = useInfospaceStore.getState().activeInfospace?.id;
    if (activeWsId) {
      setTargetInfospaceId(activeWsId);
    }
  }, []);

  useEffect(() => {
    if (token && !sharedResourceInfo && !linkInfo) {
      // Option 1: Try to access directly (might be too broad or not give enough preliminary info)
      // For now, we'll simulate fetching link details conceptually or assume accessSharedResource gives enough context.
      // If we had a robust fetchLinkByToken that returns ShareableLinkRead:
      /*
      const fetchDetails = async () => {
        const linkDetails = await fetchLinkByToken(token);
        if (linkDetails) {
          setLinkInfo(linkDetails);
        } else {
          toast.error("Invalid or expired share token.");
        }
      };
      fetchDetails();
      */
      // Placeholder: Let's assume we need to show *something* before trying to import.
      // For a real scenario, we might need a backend endpoint to peek at token details without full access.
      // Or, accessSharedResource itself might return structured data including resource_type.
      console.log(`Share token found: ${token}. UI would typically show info and ask for confirmation here.`);
      // Simulate fetching some preliminary info if possible, or just prepare for action.
    }
  }, [token, sharedResourceInfo, linkInfo]);

  const handleImport = async () => {
    if (!token) {
      toast.error("No share token provided.");
      return;
    }
    setProcessing(true);

    // For now, we will try to determine action based on what we *expect* the token is for.
    // This is a simplified approach. A better way would be for accessSharedResource or a dedicated
    // endpoint to return the resource_type associated with the token.

    // Attempt Infospace Import (example)
    // This is a guess. We need a way to know if it *is* a Infospace token.
    toast.info("Attempting to import based on token (assuming Infospace for now)...");
    try {
      const newInfospace = await importInfospaceFromToken(token, `Shared Infospace (from token ${token.substring(0, 6)})`);
      if (newInfospace && newInfospace.id) {
        toast.success(`Infospace "${newInfospace.name}" imported successfully!`);
        await fetchInfospaces(); // Refresh Infospace list
        setActiveInfospace(newInfospace.id); // Set as active
        router.push(`/Infospace/${newInfospace.id}`); // Navigate to the new Infospace
      } else {
        // If Infospace import fails, maybe it's a dataset or other resource type?
        // This is where knowing the resource_type from the token is critical.
        toast.info("Infospace import failed or no Infospace returned. Token might be for a different resource type.");
        // Fallback or try another type if applicable - this is very naive
        // Consider trying dataset import if a target Infospace is selected
        if (targetInfospaceId) {
            toast.info(`Trying to import as Dataset into Infospace ${targetInfospaceId}...`);
            const importedDataset = await importDatasetFromToken(token, { 
                InfospaceId: targetInfospaceId, 
                includeContent: true, 
                includeResults: true 
            });
            if (importedDataset && importedDataset.id) {
                toast.success(`Dataset "${importedDataset.name}" imported successfully into Infospace ${targetInfospaceId}!`);
                if (importedDataset.Infospace_id === useInfospaceStore.getState().activeInfospace?.id) {
                    await fetchDatasets(); // Refresh dataset list for the current active Infospace
                }
                router.push(`/Infospace/${importedDataset.Infospace_id}/datasets/${importedDataset.id}`); // Navigate to the dataset in its Infospace
            } else {
                 toast.error("Failed to import as Dataset. The share token might be invalid, expired, or for another resource type.");
            }
        } else {
            toast.error("Infospace import failed and no target Infospace for dataset import. Please try again or check the share link.");
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "An unknown error occurred during import.";
      toast.error(`Import failed: ${msg}`);
      console.error("Import from token error:", err);
    }
    setProcessing(false);
  };
  
  if (!token) {
    return (
      <div className="container mx-auto p-4 flex justify-center items-center min-h-screen">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center"><AlertCircle className="h-6 w-6 mr-2 text-red-500" /> Invalid Share Link</CardTitle>
          </CardHeader>
          <CardContent>
            <p>No share token was found in the URL. Please check the link and try again.</p>
            <Button onClick={() => router.push('/')} className="mt-4 w-full">Go to Homepage</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Initial display before user interaction or if more info is needed
  return (
    <div className="container mx-auto p-4 flex justify-center items-center min-h-screen">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center"><InfoIcon className="h-6 w-6 mr-2 text-blue-500" /> Shared Resource Access</CardTitle>
          <CardDescription>
            You have accessed a share link with token: <span className="font-mono bg-gray-100 px-1 rounded">{token}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {linkInfo ? (
            <div>
              <p><strong>Name:</strong> {linkInfo.name}</p>
              <p><strong>Description:</strong> {linkInfo.description}</p>
              <p><strong>Resource Type:</strong> {linkInfo.resource_type}</p>
              {/* Display more linkInfo as needed */}
            </div>
          ) : (
            <p className="text-sm text-gray-600 mb-4">
              To access or import the shared content, please click the button below.
              The system will attempt to determine the resource type and import it into your relevant Infospace.
            </p>
          )}
          
          {processing || isLoadingShare ? (
            <Button disabled className="w-full mt-4">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing...
            </Button>
          ) : (
            <Button onClick={handleImport} className="w-full mt-4" disabled={!token}>
              Access/Import Shared Content
            </Button>
          )}
          {errorShare && (
            <p className="text-red-500 text-sm mt-2">Error accessing share: {errorShare}</p>
          )}
          <Button variant="outline" onClick={() => router.push('/')} className="w-full mt-2">
            Cancel & Go to Homepage
          </Button>
        </CardContent>
      </Card>
    </div>
  );
} 
'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useShareableStore, SharedResourcePreview, AssetPreview, BundlePreview, AnnotationRunPreview } from '@/zustand_stores/storeShareables';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { useAssetStore } from '@/zustand_stores/storeAssets';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, AlertCircle, CheckCircle, InfoIcon, Import, LogIn, ChevronLeft, LayoutDashboard, FileText, ToggleLeft, ToggleRight } from 'lucide-react';
import { toast } from 'sonner';
import AssetPublicView from '@/components/collection/assets/Helper/AssetPublicView';
import BundlePublicView from '@/components/collection/assets/Helper/BundlePublicView';
import SharedAnnotationRunViewer from '@/components/collection/annotation/shared/SharedAnnotationRunViewer';
import SharedAnnotationRunDashboard from '@/components/collection/annotation/shared/SharedAnnotationRunDashboard';
import useAuth from '@/hooks/useAuth';
import { ImportResourceDialog } from '@/components/collection/assets/Helper/ImportResourceDialog';

function isBundle(content: AssetPreview | BundlePreview | AnnotationRunPreview): content is BundlePreview {
    return 'assets' in content;
}

function isAnnotationRun(content: AssetPreview | BundlePreview | AnnotationRunPreview): content is AnnotationRunPreview {
    return 'annotation_count' in content;
}

export default function ShareTokenPage() {
  const params = useParams();
  const router = useRouter();
  const token = params?.token as string | undefined;

  // --- Store Access ---
  const { viewSharedResource, importResourceFromToken } = useShareableStore();
  const activeInfospaceId = useInfospaceStore((state) => state.activeInfospace?.id);
  const { fetchAssets } = useAssetStore();
  const { fetchBundles } = useBundleStore();
  const { user } = useAuth();

  // --- Component State ---
  const [resource, setResource] = useState<SharedResourcePreview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [activeAsset, setActiveAsset] = useState<AssetPreview | null>(null);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'preview' | 'dashboard'>('dashboard');

  useEffect(() => {
    if (token) {
      const fetchResource = async () => {
        setIsLoading(true);
        setError(null);
        try {
          const result = await viewSharedResource(token);
          if (result) {
            setResource(result);
            if (!isBundle(result.content) && !isAnnotationRun(result.content)) {
              // If the shared item is a single asset, show its detail view by default
              setActiveAsset(result.content);
            }
          } else {
            setError('The shared link is invalid, has expired, or the resource could not be found.');
          }
        } catch (e: any) {
          setError(e.message || 'An unexpected error occurred.');
        } finally {
          setIsLoading(false);
        }
      };
      fetchResource();
    } else {
        setError('No share token provided in the URL.');
        setIsLoading(false);
    }
  }, [token, viewSharedResource]);

  const handleOpenImportDialog = () => {
    if (!token || !resource) return;
    setIsImportDialogOpen(true);
  };
  
  const executeImport = async (targetInfospaceId: number) => {
    if (!token || !resource) return;

    setIsImporting(true);
    try {
        const result = await importResourceFromToken(token, targetInfospaceId);

        if (result && result.imported_resource_id) {
            toast.success(`Successfully imported "${result.imported_resource_name}" into your active Infospace.`);
            
            // Refresh assets and bundles in the background
            fetchAssets();
            fetchBundles(targetInfospaceId);
            
            // Redirect based on resource type
            if (resource.resource_type === 'run') {
                // For annotation runs, redirect to the annotation runner with the imported run
                router.push(`/infospace/${targetInfospaceId}/annotations?runId=${result.imported_resource_id}`);
            } else {
                // For assets/bundles, redirect to the assets page
                router.push(`/infospace/${targetInfospaceId}/assets`);
            }
        } else {
            toast.error(`Failed to import ${resource.resource_type}. You may need to log in or the import failed on the server.`);
        }
    } catch (error) {
        console.error("An exception occurred during import:", error);
        toast.error("An unexpected error occurred during import.");
    } finally {
        setIsImporting(false);
        setIsImportDialogOpen(false);
    }
  };

  if (isLoading || isImporting) {
    return (
      <div className="container mx-auto p-4 flex justify-center items-center min-h-screen">
        <div className="flex flex-col items-center gap-4 text-primary">
          <Loader2 className="h-12 w-12 animate-spin" />
          <p className="text-lg font-medium">
            {isImporting ? "Importing resource..." : "Loading resource..."}
          </p>
        </div>
      </div>
    );
  }

  if (error || !resource) {
    return (
      <div className="container mx-auto p-4 flex justify-center items-center min-h-screen">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center">
              <AlertCircle className="h-6 w-6 mr-2 text-red-500" /> Resource Not Available
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p>{error || 'An unknown error occurred.'}</p>
            <Button onClick={() => router.push('/')} className="mt-4 w-full">
              Go to Homepage
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!token) {
    return (
        <div className="container mx-auto p-4 flex justify-center items-center min-h-screen">
            <Card className="w-full max-w-7xl">
                <CardHeader>
                    <CardTitle className="flex items-center">
                        <AlertCircle className="h-6 w-6 mr-2 text-red-500" /> Invalid URL
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p>No share token was provided in the URL.</p>
                </CardContent>
            </Card>
        </div>
    );
  }

  const isTopLevelBundle = resource && isBundle(resource.content);

  return (
    <div className="bg-muted/30 min-h-screen max-w-7xl mx-auto mt-16 p-4">
        <div className="container mx-auto p-4 sm:p-6 lg:p-8">
            <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 p-4 bg-card/80 backdrop-blur-sm border rounded-lg">
                <div className='flex-grow'>
                    <h1 className="text-xl font-semibold">Shared Resource</h1>
                    <p className="text-sm text-muted-foreground">You've been invited to view this content. Log in to import it.</p>
                </div>
                <div className="flex items-center gap-3">
                  {/* View mode toggle for annotation runs */}
                  {resource && isAnnotationRun(resource.content) && (
                    <div className="flex items-center gap-2 bg-muted rounded-lg p-1">
                      <Button
                        variant={viewMode === 'preview' ? 'default' : 'ghost'}
                        size="sm"
                        onClick={() => setViewMode('preview')}
                        className="h-8 px-3"
                      >
                        <FileText className="h-4 w-4 mr-1" />
                        Metadata
                      </Button>
                      <Button
                        variant={viewMode === 'dashboard' ? 'default' : 'ghost'}
                        size="sm"
                        onClick={() => setViewMode('dashboard')}
                        className="h-8 px-3"
                      >
                        <LayoutDashboard className="h-4 w-4 mr-1" />
                        Dashboard
                      </Button>
                    </div>
                  )}
                  
                  {user ? (
                    <>
                      {/* Show import button only for the root resource, not for detailed asset views */}
                      {!activeAsset || (isTopLevelBundle && activeAsset) ? (
                          <Button onClick={handleOpenImportDialog} disabled={isImporting}>
                              {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Import className="mr-2 h-4 w-4" />}
                              Import to my Infospace
                          </Button>
                      ) : null}
                    </>
                  ) : (
                    <Button onClick={() => router.push(`/login?redirect=/share/${token}`)}>
                        <LogIn className="mr-2 h-4 w-4" />
                        Log In to Import
                    </Button>
                  )}
                </div>
            </header>

            <main>
              {activeAsset ? (
                <>
                  {isTopLevelBundle && (
                     <Button variant="outline" onClick={() => setActiveAsset(null)} className="mb-4">
                        <ChevronLeft className="mr-2 h-4 w-4" /> Back to Bundle
                     </Button>
                  )}
                  <AssetPublicView asset={activeAsset} token={token} />
                </>
              ) : (resource && isBundle(resource.content)) ? (
                <BundlePublicView bundle={resource.content} token={token} onAssetClick={setActiveAsset} />
              ) : (resource && isAnnotationRun(resource.content)) ? (
                viewMode === 'preview' ? (
                  <SharedAnnotationRunViewer runData={resource.content as any} />
                ) : (
                  <SharedAnnotationRunDashboard runData={resource.content as any} />
                )
              ) : (
                 <div className="text-center p-8"><p className="text-muted-foreground">Select an item to view.</p></div>
              )}
            </main>
            
            <ImportResourceDialog 
              isOpen={isImportDialogOpen}
              onClose={() => setIsImportDialogOpen(false)}
              onConfirm={executeImport}
              resourceName={resource.name}
              isImporting={isImporting}
            />
        </div>
    </div>
  );
} 
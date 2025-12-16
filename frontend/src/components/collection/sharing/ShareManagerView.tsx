'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useShareableStore } from '@/zustand_stores/storeShareables';
import { ShareableLinkRead, ResourceType } from '@/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertCircle, Trash2, Copy, ExternalLink, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNowStrict, format, parseISO } from 'date-fns';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { 
    AlertDialog, 
    AlertDialogAction, 
    AlertDialogCancel, 
    AlertDialogContent, 
    AlertDialogDescription, 
    AlertDialogFooter, 
    AlertDialogHeader, 
    AlertDialogTitle, 
    AlertDialogTrigger 
} from "@/components/ui/alert-dialog";

// TODO: Add a way to navigate to the actual resource if possible.
// const getResourceUrl = (resourceType: ResourceType, resourceId: number): string | null => {
//   switch (resourceType) {
//     case 'Infospace': return `/infospaces/${resourceId}`;
//     case 'data_source': return `/data_sources/${resourceId}`; // Adjust paths as needed
//     case 'classification_job': return `/jobs/${resourceId}`;
//     case 'dataset': return `/datasets/${resourceId}`;
//     default: return null;
//   }
// };

export default function ShareManagerView() {
  const {
    links,
    isLoading,
    error,
    fetchLinks,
    deleteLink,
  } = useShareableStore((state) => ({
    links: state.links,
    isLoading: state.isLoading,
    error: state.error,
    fetchLinks: state.fetchLinks,
    deleteLink: state.deleteLink,
  }));

  const [linkToDelete, setLinkToDelete] = useState<ShareableLinkRead | null>(null);

  useEffect(() => {
    fetchLinks(20); // Fetch all links initially
  }, [fetchLinks]);

  const handleRefresh = () => {
    toast.info("Refreshing share links...");
    fetchLinks(20);
  };

  const handleDeleteConfirmation = (link: ShareableLinkRead) => {
    setLinkToDelete(link);
  };

  const executeDeleteLink = async () => {
    if (!linkToDelete || linkToDelete.id === undefined) return;

    toast.promise(deleteLink(linkToDelete.id), {
      loading: `Deleting link: ${linkToDelete.name || `Link ID ${linkToDelete.id}`}...`,
      success: () => {
        setLinkToDelete(null);
        // fetchLinks(); // Re-fetch to update the list, or rely on store to update links array
        return `Link "${linkToDelete.name || `Link ID ${linkToDelete.id}`}" deleted successfully.`;
      },
      error: (err) => {
        setLinkToDelete(null);
        const message = err instanceof Error ? err.message : 'Failed to delete link.';
        return message;
      },
    });
  };

  const handleCopyLink = (shareUrl: string | undefined | null, linkName?: string | null) => {
    if (!shareUrl) {
      toast.error("No URL available to copy.");
      return;
    }
    navigator.clipboard.writeText(shareUrl)
      .then(() => toast.success(`Link "${linkName || 'Share URL'}" copied to clipboard!`))
      .catch(() => toast.error("Failed to copy link. Please copy manually."));
  };

  if (isLoading && links.length === 0) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2">Loading share links...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-destructive">
        <AlertCircle className="h-8 w-8 mb-2" />
        <span className="font-medium">Error loading share links</span>
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
            <CardTitle>Shareable Link Manager</CardTitle>
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isLoading}>
                <RefreshCw className={`mr-1 h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
        </div>
        <CardDescription>
          Manage all active shareable links created across your Infospaces and resources.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {links.length === 0 && !isLoading ? (
          <div className="text-center py-10 text-muted-foreground">
            <p>No shareable links found.</p>
            <p className="text-sm mt-1">Create links from Infospaces, Data Sources, Datasets, or Job History views.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name / Description</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead className="w-[120px]">Created</TableHead>
                <TableHead className="w-[120px]">Expires</TableHead>
                <TableHead className="w-[80px] text-center">Uses</TableHead>
                <TableHead className="w-[200px]">Share URL</TableHead>
                <TableHead className="w-[100px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.map((link) => (
                <TableRow key={link.id}>
                  <TableCell>
                    <div className="font-medium">{link.name || `Link ID: ${link.id}`}</div>
                    {link.resource_type === 'infospace' && link.infospace_id && <div className="text-xs text-muted-foreground truncate max-w-xs">Infospace ID: {link.infospace_id}</div>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="capitalize">
                      {link.resource_type.replace('_', ' ')}
                    </Badge>
                    <span className="text-xs ml-1">ID: {link.resource_id}</span>
                    {/* TODO: Add Link component here to the resource page if getResourceUrl is implemented */}
                  </TableCell>
                  <TableCell className="text-xs">
                    {formatDistanceToNowStrict(parseISO(link.created_at), { addSuffix: true })}
                  </TableCell>
                  <TableCell className="text-xs">
                    {link.expiration_date 
                      ? format(parseISO(link.expiration_date), 'PPpp') 
                      : <span className="text-muted-foreground">Never</span>}
                  </TableCell>
                  <TableCell className="text-center text-xs">{link.use_count} / {link.max_uses || '∞'}</TableCell>
                  <TableCell>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    onClick={() => handleCopyLink(link.share_url, link.name)}
                                    className="text-xs p-1 h-auto flex items-center w-full justify-start"
                                >
                                    <Copy className="h-3 w-3 mr-1.5 shrink-0" /> 
                                    <span className="truncate">{link.share_url || "No URL"}</span>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>Copy to clipboard</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                  </TableCell>
                  <TableCell className="text-right">
                    <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={() => handleDeleteConfirmation(link)} className="text-destructive hover:text-destructive-foreground hover:bg-destructive">
                            <Trash2 className="h-4 w-4" />
                            <span className="sr-only">Delete Link</span>
                        </Button>
                    </AlertDialogTrigger>
                    {/* TODO: Add Edit Button here if implemented */}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {linkToDelete && (
        <AlertDialog open={!!linkToDelete} onOpenChange={(open) => !open && setLinkToDelete(null)}>
            <AlertDialogContent>
                <AlertDialogHeader>
                <AlertDialogTitle>Confirm Deletion</AlertDialogTitle>
                <AlertDialogDescription>
                    Are you sure you want to delete the share link "{linkToDelete.name || `Link ID ${linkToDelete.id}`}"?
                    This action cannot be undone, and the link will no longer be accessible.
                </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setLinkToDelete(null)}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={executeDeleteLink} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Delete Link
                </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
      )}
    </Card>
  );
} 
'use client';

import React, { useEffect, useState } from 'react';
import {
  Download, FileText, FolderOpen, Microscope, Network, Play, Tag,
  AlertCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

import { OpenAPI } from '@/client';

const RESOURCE_ICONS: Record<string, React.ElementType> = {
  bundle: FolderOpen,
  asset: FileText,
  run: Play,
  schema: Microscope,
  graph: Network,
  entity: Tag,
};

interface PackageTokenResponse {
  uuid: string;
  name: string;
  description: string | null;
  infospace_id: number;
  infospace_name: string | null;
  items: Array<{
    resource_type: string;
    resource_id: number;
    resource_name: string | null;
    allow_download: boolean;
    allow_copy: boolean;
  }>;
}

interface Props {
  token: string;
}

export default function PackageConsumerView({ token }: Props) {
  const [pkg, setPkg] = useState<PackageTokenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchPackage = async () => {
      setIsLoading(true);
      try {
        const baseUrl = OpenAPI.BASE || '';
        const res = await fetch(`${baseUrl}/api/v1/p/${token}`);
        if (res.status === 410) {
          setError('This package has expired.');
          return;
        }
        if (!res.ok) {
          setError('Package not found.');
          return;
        }
        const data = await res.json();
        setPkg(data);
      } catch (e) {
        setError('Failed to load package.');
      } finally {
        setIsLoading(false);
      }
    };
    fetchPackage();
  }, [token]);

  if (isLoading) {
    return <div className="text-sm text-muted-foreground p-8 text-center">Loading package...</div>;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 p-8">
        <AlertCircle className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!pkg) return null;

  const downloadUrl = (assetId: number) =>
    `${OpenAPI.BASE || ''}/api/v1/p/${token}/assets/${assetId}/download`;
  const exportUrl = `${OpenAPI.BASE || ''}/api/v1/p/${token}/export`;

  const hasDownloadableItems = pkg.items.some(
    (i) => i.allow_download && (i.resource_type === 'asset' || i.resource_type === 'bundle')
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">{pkg.name}</h1>
        {pkg.description && (
          <p className="text-muted-foreground mt-1">{pkg.description}</p>
        )}
        {pkg.infospace_name && (
          <p className="text-xs text-muted-foreground mt-2">
            From: {pkg.infospace_name}
          </p>
        )}
      </div>

      <Separator />

      {/* Items */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">{pkg.items.length} items</h2>
          {hasDownloadableItems && (
            <Button size="sm" variant="outline" asChild>
              <a href={exportUrl} download>
                <Download className="h-4 w-4 mr-1" /> Export All
              </a>
            </Button>
          )}
        </div>

        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Download</TableHead>
                <TableHead>Copy</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pkg.items.map((item, idx) => {
                const Icon = RESOURCE_ICONS[item.resource_type] ?? FileText;
                return (
                  <TableRow key={idx}>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span className="capitalize text-sm">{item.resource_type}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">
                      {item.resource_name || `#${item.resource_id}`}
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.allow_download ? 'default' : 'outline'}>
                        {item.allow_download ? 'Yes' : 'No'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.allow_copy ? 'default' : 'outline'}>
                        {item.allow_copy ? 'Yes' : 'No'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {item.allow_download && item.resource_type === 'asset' && (
                        <Button size="sm" variant="ghost" asChild>
                          <a href={downloadUrl(item.resource_id)} download>
                            <Download className="h-4 w-4" />
                          </a>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { 
  Archive, 
  RefreshCw, 
  Users, 
  Database, 
  AlertTriangle, 
  CheckCircle, 
  Clock,
  Download,
  Info,
  Search,
  X
} from 'lucide-react';
import { BackupsService } from '@/client/services';
import { toast } from 'sonner';

interface InfospaceOverview {
  id: number;
  name: string;
  owner_id: number;
  owner: {
    id: number;
    email: string;
    full_name: string;
  };
  created_at: string | null;
  backup_count: number;
  latest_backup: {
    id: number;
    name: string;
    status: string;
    created_at: string | null;
    completed_at: string | null;
    backup_type: string;
    created_by: {
      id: number;
      email: string;
      full_name: string;
    };
  } | null;
}

interface OverviewResponse {
  data: InfospaceOverview[];
  total: number;
  limit: number;
  skip: number;
}

export default function AdminBackupsPage() {
  const [infospaces, setInfospaces] = useState<InfospaceOverview[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedInfospaces, setSelectedInfospaces] = useState<Set<number>>(new Set());
  const [isBulkBackupRunning, setIsBulkBackupRunning] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [userFilter, setUserFilter] = useState<number | null>(null);
  const [isRestoreRunning, setIsRestoreRunning] = useState(false);
  const [selectedForRestore, setSelectedForRestore] = useState<Set<number>>(new Set());

  const fetchInfospacesOverview = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams({
        limit: '100',
        skip: '0'
      });
      
      if (searchTerm.trim()) {
        params.append('search', searchTerm.trim());
      }
      
      if (userFilter) {
        params.append('user_id', userFilter.toString());
      }
      
      const response = await fetch(`/api/v1/backups/admin/infospaces-overview?${params}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
        },
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data: OverviewResponse = await response.json();
      setInfospaces(data.data);
      setLastRefresh(new Date());
    } catch (error: any) {
      console.error('Error fetching infospaces overview:', error);
      setError(`Failed to load infospaces: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchInfospacesOverview();
  }, [searchTerm, userFilter]);

  const handleSelectAll = () => {
    if (selectedInfospaces.size === infospaces.length) {
      setSelectedInfospaces(new Set());
    } else {
      setSelectedInfospaces(new Set(infospaces.map(i => i.id)));
    }
  };

  const handleSelectInfospace = (infospaceId: number) => {
    const newSelected = new Set(selectedInfospaces);
    if (newSelected.has(infospaceId)) {
      newSelected.delete(infospaceId);
    } else {
      newSelected.add(infospaceId);
    }
    setSelectedInfospaces(newSelected);
  };

  const handleSelectForRestore = (backupId: number) => {
    const newSelected = new Set(selectedForRestore);
    if (newSelected.has(backupId)) {
      newSelected.delete(backupId);
    } else {
      newSelected.add(backupId);
    }
    setSelectedForRestore(newSelected);
  };

  const handleRestoreBackup = async (backupId: number, infospace_name: string) => {
    setIsRestoreRunning(true);
    
    try {
      const response = await fetch(`/api/v1/backups/${backupId}/restore`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          new_name: `${infospace_name} (Admin Restored ${new Date().toLocaleDateString()})` 
        }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const result = await response.json();
      toast.success(`✅ Backup restored successfully! New infospace: ${result.name}`);
      
      // Refresh the list
      setTimeout(() => {
        fetchInfospacesOverview();
      }, 2000);
      
    } catch (error: any) {
      console.error('Error restoring backup:', error);
      toast.error(`❌ Failed to restore backup: ${error.message}`);
    } finally {
      setIsRestoreRunning(false);
    }
  };

  const triggerBulkBackup = async (type: 'all' | 'selected') => {
    setIsBulkBackupRunning(true);
    
    try {
      if (type === 'all') {
        const response = await fetch('/api/v1/backups/admin/backup-all', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ backup_type: 'manual' }),
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        const result = await response.json();
        toast.success(`✅ ${result.message}`);
      } else {
        if (selectedInfospaces.size === 0) {
          toast.error('No infospaces selected');
          return;
        }
        
        const response = await fetch('/api/v1/backups/admin/backup-specific', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            infospace_ids: Array.from(selectedInfospaces),
            backup_type: 'manual' 
          }),
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        const result = await response.json();
        toast.success(`✅ ${result.message}`);
        setSelectedInfospaces(new Set());
      }
      
      // Refresh the list after a delay to show new backups
      setTimeout(() => {
        fetchInfospacesOverview();
      }, 2000);
      
    } catch (error: any) {
      console.error('Error triggering backup:', error);
      toast.error(`❌ Failed to start backup: ${error.message}`);
    } finally {
      setIsBulkBackupRunning(false);
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'completed': return 'default';
      case 'creating': return 'secondary';
      case 'failed': return 'destructive';
      case 'expired': return 'outline';
      default: return 'outline';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle className="h-4 w-4" />;
      case 'creating': return <Clock className="h-4 w-4" />;
      case 'failed': return <AlertTriangle className="h-4 w-4" />;
      default: return <Info className="h-4 w-4" />;
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleString();
  };

  const getTotalBackups = () => infospaces.reduce((sum, i) => sum + i.backup_count, 0);
  const getInfospacesWithBackups = () => infospaces.filter(i => i.backup_count > 0).length;

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Backup Management</h1>
          <p className="text-gray-600 mt-2">Manage backups for all infospaces</p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            onClick={fetchInfospacesOverview}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Search & Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 items-center">
            <div className="flex-1">
              <Input
                placeholder="Search infospaces or users..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full"
              />
            </div>
            {searchTerm && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSearchTerm('')}
              >
                <X className="h-4 w-4" />
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-blue-500" />
              <div>
                <p className="text-sm text-gray-600">Total Infospaces</p>
                <p className="text-2xl font-bold">{infospaces.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Archive className="h-5 w-5 text-green-500" />
              <div>
                <p className="text-sm text-gray-600">Total Backups</p>
                <p className="text-2xl font-bold">{getTotalBackups()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-blue-500" />
              <div>
                <p className="text-sm text-gray-600">With Backups</p>
                <p className="text-2xl font-bold">{getInfospacesWithBackups()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-gray-500" />
              <div>
                <p className="text-sm text-gray-600">Last Refresh</p>
                <p className="text-sm font-medium">{formatDate(lastRefresh.toISOString())}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bulk Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Archive className="h-5 w-5" />
            Bulk Actions
          </CardTitle>
          <CardDescription>
            Create backups or restore from existing backups. Operations are performed in the background.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Backup Actions */}
          <div>
            <h4 className="font-medium mb-2">Backup Operations</h4>
            <div className="flex gap-2">
              <Button
                onClick={() => triggerBulkBackup('all')}
                disabled={isBulkBackupRunning}
                className="flex items-center gap-2"
              >
                {isBulkBackupRunning ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Archive className="h-4 w-4" />
                )}
                Backup All Infospaces
              </Button>
              
              <Button
                variant="outline"
                onClick={() => triggerBulkBackup('selected')}
                disabled={isBulkBackupRunning || selectedInfospaces.size === 0}
                className="flex items-center gap-2"
              >
                {isBulkBackupRunning ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Archive className="h-4 w-4" />
                )}
                Backup Selected ({selectedInfospaces.size})
              </Button>
            </div>
          </div>

          {/* Restore Info */}
          <div>
            <h4 className="font-medium mb-2">Restore Operations</h4>
            <p className="text-sm text-gray-600 mb-2">
              Use the "Restore" buttons next to individual backups to restore them as new infospaces.
              Restored infospaces will be created with the admin as the owner.
            </p>
          </div>
          
          {(isBulkBackupRunning || isRestoreRunning) && (
            <Alert>
              <Clock className="h-4 w-4" />
              <AlertTitle>Processing</AlertTitle>
              <AlertDescription>
                {isBulkBackupRunning && "Backup tasks are running in the background."}
                {isRestoreRunning && "Restore operation is in progress."}
                {" "}Check the table below for progress updates.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Infospaces Table */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Infospaces Overview</CardTitle>
            <div className="flex items-center gap-2">
              <Checkbox 
                checked={selectedInfospaces.size === infospaces.length && infospaces.length > 0}
                onCheckedChange={handleSelectAll}
              />
              <span className="text-sm text-gray-600">Select All</span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          
          {isLoading ? (
            <div className="text-center py-8">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2" />
              <p>Loading infospaces...</p>
            </div>
          ) : (
            <ScrollArea className="h-[500px]">
              <div className="space-y-2">
                {infospaces.length === 0 ? (
                  <p className="text-center text-gray-500 py-8">No infospaces found.</p>
                ) : (
                  infospaces.map((infospace) => (
                    <div
                      key={infospace.id}
                      className="flex items-center gap-4 p-4 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50"
                    >
                      <Checkbox
                        checked={selectedInfospaces.has(infospace.id)}
                        onCheckedChange={() => handleSelectInfospace(infospace.id)}
                      />
                      
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-medium">{infospace.name}</h3>
                          <Badge variant="outline">ID: {infospace.id}</Badge>
                        </div>
                        <p className="text-sm text-gray-600">
                          Owner: {infospace.owner.full_name} ({infospace.owner.email}) | Created: {formatDate(infospace.created_at)}
                        </p>
                      </div>
                      
                      <div className="text-center">
                        <p className="text-lg font-bold">{infospace.backup_count}</p>
                        <p className="text-xs text-gray-600">Backups</p>
                      </div>
                      
                      <div className="w-64">
                        {infospace.latest_backup ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              {getStatusIcon(infospace.latest_backup.status)}
                              <Badge variant={getStatusBadgeVariant(infospace.latest_backup.status)}>
                                {infospace.latest_backup.status}
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                {infospace.latest_backup.backup_type}
                              </Badge>
                            </div>
                            <p className="text-xs text-gray-600 truncate">
                              {infospace.latest_backup.name}
                            </p>
                            <p className="text-xs text-gray-500">
                              Created by: {infospace.latest_backup.created_by.full_name}
                            </p>
                            <p className="text-xs text-gray-500">
                              {formatDate(infospace.latest_backup.created_at)}
                            </p>
                          </div>
                        ) : (
                          <div className="text-center text-gray-500">
                            <p className="text-sm">No backups yet</p>
                          </div>
                        )}
                      </div>
                      
                      <div className="w-32 flex flex-col gap-1">
                        {infospace.latest_backup && infospace.latest_backup.status === 'completed' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRestoreBackup(infospace.latest_backup!.id, infospace.name)}
                            disabled={isRestoreRunning}
                            className="text-xs"
                          >
                            {isRestoreRunning ? (
                              <RefreshCw className="h-3 w-3 animate-spin" />
                            ) : (
                              <Download className="h-3 w-3" />
                            )}
                            Restore
                          </Button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
} 
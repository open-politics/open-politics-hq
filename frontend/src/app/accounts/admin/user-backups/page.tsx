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
  Users, 
  RefreshCw, 
  Database, 
  AlertTriangle, 
  CheckCircle, 
  Clock,
  Download,
  Info,
  Search,
  X,
  Shield,
  HardDrive,
  UserPlus
} from 'lucide-react';
import { toast } from 'sonner';

interface UserOverview {
  id: number;
  email: string;
  full_name: string;
  is_active: boolean;
  is_superuser: boolean;
  created_at: string | null;
  backup_count: number;
  latest_backup: {
    id: number;
    name: string;
    status: string;
    created_at: string | null;
    completed_at: string | null;
    backup_type: string;
    included_infospaces: number;
    file_size_bytes?: number;
    created_by: {
      id: number;
      email: string;
      full_name: string;
    };
  } | null;
}

interface UserBackup {
  id: number;
  target_user_id: number;
  name: string;
  description?: string;
  status: 'creating' | 'completed' | 'failed' | 'expired';
  backup_type: string;
  file_size_bytes?: number;
  included_infospaces: number;
  included_assets: number;
  included_schemas: number;
  included_runs: number;
  included_annotations: number;
  included_datasets: number;
  created_at: string;
  completed_at?: string;
  expires_at?: string;
  is_ready: boolean;
  is_expired: boolean;
}

interface UsersOverviewResponse {
  data: UserOverview[];
  total: number;
  limit: number;
  skip: number;
}

interface UserBackupsResponse {
  data: UserBackup[];
  count: number;
}

export default function AdminUserBackupsPage() {
  const [users, setUsers] = useState<UserOverview[]>([]);
  const [userBackups, setUserBackups] = useState<UserBackup[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingBackups, setIsLoadingBackups] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedUsers, setSelectedUsers] = useState<Set<number>>(new Set());
  const [isBulkBackupRunning, setIsBulkBackupRunning] = useState(false);
  const [isRestoreRunning, setIsRestoreRunning] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  const fetchUsersOverview = async () => {
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
      
      const response = await fetch(`/api/v1/user-backups/admin/users-overview?${params}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
        },
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data: UsersOverviewResponse = await response.json();
      setUsers(data.data);
      setLastRefresh(new Date());
    } catch (error: any) {
      console.error('Error fetching users overview:', error);
      setError(`Failed to load users: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchUserBackups = async (userId?: number) => {
    setIsLoadingBackups(true);
    
    try {
      const params = new URLSearchParams({
        limit: '50',
        skip: '0'
      });
      
      if (userId) {
        params.append('target_user_id', userId.toString());
      }
      
      const response = await fetch(`/api/v1/user-backups?${params}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
        },
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data: UserBackupsResponse = await response.json();
      setUserBackups(data.data);
    } catch (error: any) {
      console.error('Error fetching user backups:', error);
      toast.error(`Failed to load user backups: ${error.message}`);
    } finally {
      setIsLoadingBackups(false);
    }
  };

  useEffect(() => {
    fetchUsersOverview();
    fetchUserBackups();
  }, [searchTerm]);

  const handleSelectAll = () => {
    if (selectedUsers.size === users.length) {
      setSelectedUsers(new Set());
    } else {
      setSelectedUsers(new Set(users.map(u => u.id)));
    }
  };

  const handleSelectUser = (userId: number) => {
    const newSelected = new Set(selectedUsers);
    if (newSelected.has(userId)) {
      newSelected.delete(userId);
    } else {
      newSelected.add(userId);
    }
    setSelectedUsers(newSelected);
  };

  const handleUserClick = (userId: number) => {
    setSelectedUserId(userId);
    fetchUserBackups(userId);
  };

  const createUserBackup = async (userId: number, userName: string) => {
    try {
      const response = await fetch('/api/v1/user-backups', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          target_user_id: userId,
          name: `Complete backup - ${userName}`,
          description: `Admin-triggered backup of user ${userName} created on ${new Date().toLocaleString()}`,
          backup_type: 'manual'
        }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const result = await response.json();
      toast.success(`✅ User backup created for ${userName}`);
      
      // Refresh both lists
      setTimeout(() => {
        fetchUsersOverview();
        fetchUserBackups(selectedUserId || undefined);
      }, 1000);
      
    } catch (error: any) {
      console.error('Error creating user backup:', error);
      toast.error(`❌ Failed to create backup for ${userName}: ${error.message}`);
    }
  };

  const triggerBulkUserBackup = async (type: 'all' | 'selected') => {
    setIsBulkBackupRunning(true);
    
    try {
      if (type === 'all') {
        const response = await fetch('/api/v1/user-backups/admin/backup-all', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ backup_type: 'system' }),
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        const result = await response.json();
        toast.success(`✅ ${result.message}`);
      } else {
        if (selectedUsers.size === 0) {
          toast.error('No users selected');
          return;
        }
        
        const response = await fetch('/api/v1/user-backups/admin/backup-specific', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            user_ids: Array.from(selectedUsers),
            backup_type: 'manual' 
          }),
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        const result = await response.json();
        toast.success(`✅ ${result.message}`);
        setSelectedUsers(new Set());
      }
      
      // Refresh after delay
      setTimeout(() => {
        fetchUsersOverview();
        fetchUserBackups(selectedUserId || undefined);
      }, 2000);
      
    } catch (error: any) {
      console.error('Error triggering bulk user backup:', error);
      toast.error(`❌ Failed to start backup: ${error.message}`);
    } finally {
      setIsBulkBackupRunning(false);
    }
  };

  const restoreUserBackup = async (backup: UserBackup) => {
    setIsRestoreRunning(true);
    
    try {
      const targetEmail = prompt(`Enter email for restored user (original: ${backup.target_user_id}):`);
      if (!targetEmail) {
        setIsRestoreRunning(false);
        return;
      }

      const response = await fetch(`/api/v1/user-backups/${backup.id}/restore`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          target_user_email: targetEmail,
          conflict_strategy: 'smart'
        }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const result = await response.json();
      toast.success(`✅ User backup restored! New user: ${result.email}`);
      
      // Refresh lists
      setTimeout(() => {
        fetchUsersOverview();
      }, 2000);
      
    } catch (error: any) {
      console.error('Error restoring user backup:', error);
      toast.error(`❌ Failed to restore backup: ${error.message}`);
    } finally {
      setIsRestoreRunning(false);
    }
  };

  const downloadUserBackup = async (backup: UserBackup) => {
    try {
      const response = await fetch(`/api/v1/user-backups/${backup.id}/share`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          is_shareable: true,
          expiration_hours: 24
        }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const result = await response.json();
      if (result.download_url) {
        window.open(result.download_url, '_blank');
        toast.success('✅ Download started');
      }
      
    } catch (error: any) {
      console.error('Error downloading user backup:', error);
      toast.error(`❌ Failed to download backup: ${error.message}`);
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

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return 'Unknown';
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  };

  const getTotalBackups = () => users.reduce((sum, u) => sum + u.backup_count, 0);
  const getUsersWithBackups = () => users.filter(u => u.backup_count > 0).length;

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Shield className="h-8 w-8" />
            User Backup Management
          </h1>
          <p className="text-gray-600 mt-2">Complete user account backups for disaster recovery</p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            onClick={() => {
              fetchUsersOverview();
              fetchUserBackups(selectedUserId || undefined);
            }}
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
            Search Users
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 items-center">
            <div className="flex-1">
              <Input
                placeholder="Search users by email or name..."
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
              <Users className="h-5 w-5 text-blue-500" />
              <div>
                <p className="text-sm text-gray-600">Total Users</p>
                <p className="text-2xl font-bold">{users.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <HardDrive className="h-5 w-5 text-green-500" />
              <div>
                <p className="text-sm text-gray-600">Total User Backups</p>
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
                <p className="text-sm text-gray-600">Users with Backups</p>
                <p className="text-2xl font-bold">{getUsersWithBackups()}</p>
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

      {/* Disaster Recovery Actions */}
      <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950 dark:border-orange-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-orange-800 dark:text-orange-200">
            <AlertTriangle className="h-5 w-5" />
            Disaster Recovery Operations
          </CardTitle>
          <CardDescription className="text-orange-700 dark:text-orange-300">
            These operations create complete user account backups including all infospaces, assets, and annotations.
            Use these for disaster recovery scenarios after database loss.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h4 className="font-medium mb-2 text-orange-800 dark:text-orange-200">System-Wide Backup</h4>
            <div className="flex gap-2">
              <Button
                onClick={() => triggerBulkUserBackup('all')}
                disabled={isBulkBackupRunning}
                className="bg-orange-600 hover:bg-orange-700 text-white"
              >
                {isBulkBackupRunning ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Database className="h-4 w-4 mr-2" />
                )}
                Backup All Users (System)
              </Button>
              
              <Button
                variant="outline"
                onClick={() => triggerBulkUserBackup('selected')}
                disabled={isBulkBackupRunning || selectedUsers.size === 0}
                className="border-orange-300 text-orange-700 hover:bg-orange-100"
              >
                {isBulkBackupRunning ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Users className="h-4 w-4 mr-2" />
                )}
                Backup Selected ({selectedUsers.size})
              </Button>
            </div>
          </div>
          
          {(isBulkBackupRunning || isRestoreRunning) && (
            <Alert>
              <Clock className="h-4 w-4" />
              <AlertTitle>Processing</AlertTitle>
              <AlertDescription>
                {isBulkBackupRunning && "User backup tasks are running in the background."}
                {isRestoreRunning && "User restore operation is in progress."}
                {" "}Operations may take several minutes for large accounts.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Users List */}
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>Users Overview</CardTitle>
              <div className="flex items-center gap-2">
                <Checkbox 
                  checked={selectedUsers.size === users.length && users.length > 0}
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
                <p>Loading users...</p>
              </div>
            ) : (
              <ScrollArea className="h-[500px]">
                <div className="space-y-2">
                  {users.length === 0 ? (
                    <p className="text-center text-gray-500 py-8">No users found.</p>
                  ) : (
                    users.map((user) => (
                      <div
                        key={user.id}
                        className={`flex items-center gap-4 p-4 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer ${
                          selectedUserId === user.id ? 'ring-2 ring-blue-500' : ''
                        }`}
                        onClick={() => handleUserClick(user.id)}
                      >
                        <Checkbox
                          checked={selectedUsers.has(user.id)}
                          onCheckedChange={() => handleSelectUser(user.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-medium">{user.full_name}</h3>
                            <Badge variant="outline">ID: {user.id}</Badge>
                            {user.is_superuser && <Badge variant="destructive">Admin</Badge>}
                            {!user.is_active && <Badge variant="secondary">Inactive</Badge>}
                          </div>
                          <p className="text-sm text-gray-600">
                            {user.email} | Created: {formatDate(user.created_at)}
                          </p>
                        </div>
                        
                        <div className="text-center">
                          <p className="text-lg font-bold">{user.backup_count}</p>
                          <p className="text-xs text-gray-600">Backups</p>
                        </div>
                        
                        <div className="w-32">
                          {user.latest_backup ? (
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                {getStatusIcon(user.latest_backup.status)}
                                <Badge variant={getStatusBadgeVariant(user.latest_backup.status)} className="text-xs">
                                  {user.latest_backup.status}
                                </Badge>
                              </div>
                              <p className="text-xs text-gray-500">
                                {user.latest_backup.included_infospaces} infospaces
                              </p>
                              <p className="text-xs text-gray-500">
                                {formatDate(user.latest_backup.created_at)}
                              </p>
                            </div>
                          ) : (
                            <div className="text-center">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  createUserBackup(user.id, user.full_name);
                                }}
                                className="text-xs"
                              >
                                <UserPlus className="h-3 w-3 mr-1" />
                                Backup
                              </Button>
                            </div>
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

        {/* User Backups Details */}
        <Card>
          <CardHeader>
            <CardTitle>
              {selectedUserId ? `User Backups (ID: ${selectedUserId})` : 'All Recent User Backups'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingBackups ? (
              <div className="text-center py-8">
                <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2" />
                <p>Loading backups...</p>
              </div>
            ) : (
              <ScrollArea className="h-[500px]">
                <div className="space-y-3">
                  {userBackups.length === 0 ? (
                    <p className="text-center text-gray-500 py-8">
                      {selectedUserId ? 'No backups found for this user.' : 'No user backups found.'}
                    </p>
                  ) : (
                    userBackups.map((backup) => (
                      <div
                        key={backup.id}
                        className="p-4 border rounded-lg space-y-2"
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              {getStatusIcon(backup.status)}
                              <h4 className="font-medium">{backup.name}</h4>
                              <Badge variant={getStatusBadgeVariant(backup.status)}>
                                {backup.status}
                              </Badge>
                            </div>
                            <p className="text-sm text-gray-600 mb-2">
                              {backup.description || 'No description'}
                            </p>
                            <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                              <span>{backup.included_infospaces} infospaces</span>
                              <span>{backup.included_assets} assets</span>
                              <span>{backup.included_schemas} schemas</span>
                              <span>{backup.included_runs} runs</span>
                            </div>
                            <p className="text-xs text-gray-500 mt-2">
                              Created: {formatDate(backup.created_at)}
                            </p>
                            {backup.file_size_bytes && (
                              <p className="text-xs text-gray-500">
                                Size: {formatFileSize(backup.file_size_bytes)}
                              </p>
                            )}
                          </div>
                        </div>
                        
                        {backup.status === 'completed' && (
                          <div className="flex gap-2 pt-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => restoreUserBackup(backup)}
                              disabled={isRestoreRunning}
                              className="text-xs"
                            >
                              {isRestoreRunning ? (
                                <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                              ) : (
                                <UserPlus className="h-3 w-3 mr-1" />
                              )}
                              Restore User
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => downloadUserBackup(backup)}
                              className="text-xs"
                            >
                              <Download className="h-3 w-3 mr-1" />
                              Download
                            </Button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
} 
'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { 
  UserPlus, 
  RefreshCw, 
  Settings, 
  Users, 
  CheckCircle, 
  XCircle,
  Info,
  AlertTriangle
} from 'lucide-react';
import withAdminAuth from '@/hooks/withAdminAuth';
import { toast } from 'sonner';

interface RegistrationStats {
  total_users: number;
  users_created_today: number;
  users_created_this_week: number;
  users_created_this_month: number;
  open_registration_enabled: boolean;
  last_registration: string | null;
}

export default withAdminAuth(function AdminRegistrationPage() {
  const [stats, setStats] = useState<RegistrationStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRegistrationStats = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/v1/admin/registration/stats', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
        },
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data: RegistrationStats = await response.json();
      setStats(data);
    } catch (error: any) {
      console.error('Error fetching registration stats:', error);
      setError(`Failed to load registration stats: ${error.message}`);
      
      // Fallback mock data for development
      setStats({
        total_users: 12,
        users_created_today: 2,
        users_created_this_week: 7,
        users_created_this_month: 15,
        open_registration_enabled: false,
        last_registration: new Date(Date.now() - 3600000).toISOString() // 1 hour ago
      });
    } finally {
      setIsLoading(false);
    }
  };



  useEffect(() => {
    fetchRegistrationStats();
  }, []);

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleString();
  };

  const getRegistrationStatusColor = (enabled: boolean) => {
    return enabled ? 'text-green-600' : 'text-red-600';
  };

  const getRegistrationStatusIcon = (enabled: boolean) => {
    return enabled ? <CheckCircle className="h-5 w-5" /> : <XCircle className="h-5 w-5" />;
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Users className="h-8 w-8" />
            Registration Overview
          </h1>
          <p className="text-gray-600 mt-2">View public user registration status and statistics</p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            onClick={fetchRegistrationStats}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Registration Status Display */}
      <Card className="border-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Public Registration Status
          </CardTitle>
          <CardDescription>
            Current status of public user registration. To change this setting, update the USERS_OPEN_REGISTRATION environment variable.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {stats && (
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex items-center gap-3">
                <div className={getRegistrationStatusColor(stats.open_registration_enabled)}>
                  {getRegistrationStatusIcon(stats.open_registration_enabled)}
                </div>
                <div>
                  <h3 className="font-medium">Current Status</h3>
                  <p className={`text-sm ${getRegistrationStatusColor(stats.open_registration_enabled)}`}>
                    Public registration is {stats.open_registration_enabled ? 'enabled' : 'disabled'}
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                <Badge 
                  variant={stats.open_registration_enabled ? "default" : "secondary"}
                  className="flex items-center gap-1"
                >
                  {stats.open_registration_enabled ? (
                    <>
                      <CheckCircle className="h-3 w-3" />
                      Enabled
                    </>
                  ) : (
                    <>
                      <XCircle className="h-3 w-3" />
                      Disabled
                    </>
                  )}
                </Badge>
              </div>
            </div>
          )}
          
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>How to Change Registration Settings</AlertTitle>
            <AlertDescription>
              <ul className="list-disc list-inside space-y-1">
                <li>Set <code>USERS_OPEN_REGISTRATION=true</code> in your environment variables to enable</li>
                <li>Set <code>USERS_OPEN_REGISTRATION=false</code> to disable public registration</li>
                <li>Restart the server after changing environment variables</li>
                <li>When disabled, only administrators can create accounts through the admin panel</li>
                <li>Existing user sessions are not affected by this setting</li>
              </ul>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Registration Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-500" />
              <div>
                <p className="text-sm text-gray-600">Total Users</p>
                <p className="text-2xl font-bold">{stats?.total_users || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-green-500" />
              <div>
                <p className="text-sm text-gray-600">Today</p>
                <p className="text-2xl font-bold">{stats?.users_created_today || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-yellow-500" />
              <div>
                <p className="text-sm text-gray-600">This Week</p>
                <p className="text-2xl font-bold">{stats?.users_created_this_week || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-purple-500" />
              <div>
                <p className="text-sm text-gray-600">This Month</p>
                <p className="text-2xl font-bold">{stats?.users_created_this_month || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Additional Information */}
      <Card>
        <CardHeader>
          <CardTitle>Registration Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h4 className="font-medium mb-2">Last Registration</h4>
              <p className="text-sm text-gray-600">
                {formatDate(stats?.last_registration || null)}
              </p>
            </div>
            
            <div>
              <h4 className="font-medium mb-2">Registration Status</h4>
              <Badge 
                variant={stats?.open_registration_enabled ? "default" : "secondary"}
                className="flex items-center gap-1 w-fit"
              >
                {stats?.open_registration_enabled ? (
                  <>
                    <CheckCircle className="h-3 w-3" />
                    Open
                  </>
                ) : (
                  <>
                    <XCircle className="h-3 w-3" />
                    Closed
                  </>
                )}
              </Badge>
            </div>
          </div>
          
          <div>
            <h4 className="font-medium mb-2">Quick Actions</h4>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                onClick={() => window.open('/accounts/register', '_blank')}
              >
                Test Registration Page
              </Button>
              <Button 
                variant="outline" 
                onClick={() => window.open('/accounts/admin/users', '_blank')}
              >
                Manage Users
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}); 
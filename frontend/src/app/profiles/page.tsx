'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { UsersService, UserPublicProfile, UserProfileStats } from '@/client';
import { Search, Users, Calendar, FileText, Target, BarChart3 } from 'lucide-react';
import { toast } from 'sonner';

export default function ProfilesPage() {
  const [profiles, setProfiles] = useState<UserPublicProfile[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<UserPublicProfile | null>(null);
  const [profileStats, setProfileStats] = useState<UserProfileStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);

  const fetchProfiles = async (search?: string) => {
    setIsLoading(true);
    try {
      const result = await UsersService.listUserProfiles({
        search: search || undefined,
        limit: 50,
      });
      setProfiles(result);
    } catch (error: any) {
      console.error('Error fetching profiles:', error);
      toast.error('Failed to fetch user profiles');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchProfileStats = async (userId: number) => {
    setIsLoadingStats(true);
    try {
      const stats = await UsersService.getUserProfileStats({ userId });
      setProfileStats(stats);
    } catch (error: any) {
      console.error('Error fetching profile stats:', error);
      setProfileStats(null);
    } finally {
      setIsLoadingStats(false);
    }
  };

  const handleProfileClick = async (profile: UserPublicProfile) => {
    setSelectedProfile(profile);
    await fetchProfileStats(profile.id);
  };

  const handleSearch = () => {
    fetchProfiles(searchQuery);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  useEffect(() => {
    fetchProfiles();
  }, []);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="text-center space-y-4">
        <h1 className="text-3xl font-bold flex items-center justify-center gap-2">
          <Users className="h-8 w-8" />
          User Profiles
        </h1>
        <p className="text-gray-600 max-w-2xl mx-auto">
          Discover and connect with other users in the community. Search by name, bio, or expertise.
        </p>
      </div>

      {/* Search */}
      <Card className="max-w-2xl mx-auto">
        <CardContent className="pt-6">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Search users by name or bio..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={handleKeyPress}
                className="pl-10"
              />
            </div>
            <Button onClick={handleSearch} disabled={isLoading}>
              {isLoading ? 'Searching...' : 'Search'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {profiles.map((profile) => (
          <Card key={profile.id} className="cursor-pointer hover:shadow-lg transition-shadow">
            <CardContent className="pt-6">
              <div className="flex flex-col items-center space-y-4">
                <Avatar className="h-16 w-16">
                  <AvatarImage 
                    src={profile.profile_picture_url || undefined} 
                    alt={profile.full_name || 'User'} 
                  />
                  <AvatarFallback className="text-lg">
                    {profile.full_name ? 
                      profile.full_name.split(' ').map(n => n[0]).join('').toUpperCase() : 
                      'U'
                    }
                  </AvatarFallback>
                </Avatar>
                
                <div className="text-center space-y-2 w-full">
                  {profile.full_name && (
                    <h3 className="font-semibold text-lg">{profile.full_name}</h3>
                  )}
                  
                  {profile.bio && (
                    <p className="text-sm text-gray-600 line-clamp-3">
                      {profile.bio}
                    </p>
                  )}
                  
                  <div className="flex items-center justify-center gap-1 text-xs text-gray-500">
                    <Calendar className="h-3 w-3" />
                    Member since {formatDate(profile.created_at)}
                  </div>
                </div>
                
                <Dialog open={selectedProfile?.id === profile.id} onOpenChange={(open) => !open && setSelectedProfile(null)}>
                  <DialogTrigger asChild>
                    <Button 
                      variant="outline" 
                      className="w-full"
                      onClick={() => handleProfileClick(profile)}
                    >
                      View Profile
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <Avatar className="h-8 w-8">
                          <AvatarImage 
                            src={profile.profile_picture_url || undefined} 
                            alt={profile.full_name || 'User'} 
                          />
                          <AvatarFallback>
                            {profile.full_name ? 
                              profile.full_name.split(' ').map(n => n[0]).join('').toUpperCase() : 
                              'U'
                            }
                          </AvatarFallback>
                        </Avatar>
                        {profile.full_name || 'User Profile'}
                      </DialogTitle>
                    </DialogHeader>
                    
                    <div className="space-y-6 py-4">
                      {/* Profile Info */}
                      <div className="space-y-4">
                        {profile.bio && (
                          <div>
                            <h4 className="font-medium text-sm text-gray-700 mb-2">Bio</h4>
                            <p className="text-sm">{profile.bio}</p>
                          </div>
                        )}
                        
                        {profile.description && (
                          <div>
                            <h4 className="font-medium text-sm text-gray-700 mb-2">About</h4>
                            <p className="text-sm whitespace-pre-wrap">{profile.description}</p>
                          </div>
                        )}
                        
                        <div>
                          <h4 className="font-medium text-sm text-gray-700 mb-2">Member Since</h4>
                          <p className="text-sm">{formatDate(profile.created_at)}</p>
                        </div>
                      </div>

                      {/* Stats */}
                      {profileStats && (
                        <div>
                          <h4 className="font-medium text-sm text-gray-700 mb-3 flex items-center gap-2">
                            <BarChart3 className="h-4 w-4" />
                            Activity Stats
                          </h4>
                          <div className="grid grid-cols-3 gap-4">
                            <div className="text-center p-3 bg-gray-50 rounded-lg">
                              <div className="text-xl font-semibold text-blue-600">
                                {profileStats.infospaces_count}
                              </div>
                              <div className="text-xs text-gray-600">Infospaces</div>
                            </div>
                            <div className="text-center p-3 bg-gray-50 rounded-lg">
                              <div className="text-xl font-semibold text-green-600">
                                {profileStats.assets_count}
                              </div>
                              <div className="text-xs text-gray-600">Assets</div>
                            </div>
                            <div className="text-center p-3 bg-gray-50 rounded-lg">
                              <div className="text-xl font-semibold text-purple-600">
                                {profileStats.annotations_count}
                              </div>
                              <div className="text-xs text-gray-600">Annotations</div>
                            </div>
                          </div>
                        </div>
                      )}

                      {isLoadingStats && (
                        <div className="text-center py-4">
                          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto"></div>
                        </div>
                      )}
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Empty State */}
      {!isLoading && profiles.length === 0 && (
        <div className="text-center py-12">
          <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No profiles found</h3>
          <p className="text-gray-600">
            {searchQuery ? 'Try adjusting your search terms' : 'No user profiles are available yet'}
          </p>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-gray-600">Loading profiles...</p>
        </div>
      )}
    </div>
  );
} 
'use client';

import { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import useAuth from "@/hooks/useAuth";
import { Shield, User, Key, Trash2, Camera, Upload, CheckCircle2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { UsersService } from '@/client';
 

export default function AccountSettingsPage() {
  const { user, isLoading } = useAuth();
  const [hydrated, setHydrated] = useState(false);
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [description, setDescription] = useState(user?.description || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [statusBanner, setStatusBanner] = useState<{ type: 'loading' | 'success' | 'error'; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Populate fields when user data loads/changes
  useEffect(() => {
    setHydrated(true);
    if (user) {
      setFullName(user.full_name || '');
      setEmail(user.email || '');
      setBio(user.bio || '');
      setDescription(user.description || '');
    }
  }, [user]);
  
  const showStatus = (type: 'loading' | 'success' | 'error', message: string, autoHideMs?: number) => {
    setStatusBanner({ type, message });
    if (autoHideMs && autoHideMs > 0) {
      window.setTimeout(() => setStatusBanner(null), autoHideMs);
    }
  };

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUpdatingProfile(true);
    showStatus('loading', 'Saving settings...');
    
    try {
      await UsersService.updateUserProfile({
        requestBody: {
          full_name: fullName,
          bio: bio,
          description: description,
        }
      });
      
      // Update email separately if changed
      if (email !== user?.email) {
        await UsersService.updateUserMe({
          requestBody: {
            email: email,
          }
        });
      }
      
      showStatus('success', 'Profile updated successfully!', 2000);
    } catch (err: any) {
      const errorMsg = err?.body?.detail || 'Failed to update profile';
      showStatus('error', errorMsg, 4000);
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const handleProfilePictureUpload = async (file: File) => {
    if (!file) return;
    
    // Validate file type and size
    if (!file.type.startsWith('image/')) {
      showStatus('error', 'Please select an image file', 3000);
      return;
    }
    
    if (file.size > 5 * 1024 * 1024) { // 5MB limit
      showStatus('error', 'Image size must be less than 5MB', 3000);
      return;
    }
    
    setIsUploadingPhoto(true);
    showStatus('loading', 'Uploading photo...');
    
    try {
      await UsersService.uploadProfilePicture({
        formData: {
          file: file
        }
      });
      showStatus('success', 'Profile picture updated successfully!', 1200);
      // Slight delay to allow users to notice success before reload
      window.setTimeout(() => window.location.reload(), 800);
    } catch (err: any) {
      const errorMsg = err?.body?.detail || 'Failed to upload profile picture';
      showStatus('error', errorMsg, 4000);
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleProfilePictureUpload(file);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    showStatus('loading', 'Updating password...');
    try {
      await UsersService.updatePasswordMe({
        requestBody: {
          current_password: currentPassword,
          new_password: newPassword,
        }
      });
      showStatus('success', 'Password updated successfully', 2000);
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      showStatus('error', 'Failed to update password', 4000);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 space-y-4 mt-16">
      {statusBanner && (
        <div className="fixed top-20 right-4 z-50">
          <div
            className={
              `flex items-center gap-3 px-4 py-3 rounded-md border shadow-lg bg-background ` +
              (statusBanner.type === 'loading'
                ? 'border-primary text-primary'
                : statusBanner.type === 'success'
                ? 'border-green-500 text-green-600'
                : 'border-destructive text-destructive')
            }
          >
            {statusBanner.type === 'loading' && (
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-current border-t-transparent"></div>
            )}
            {statusBanner.type === 'success' && (
              <CheckCircle2 className="h-5 w-5" />
            )}
            {statusBanner.type === 'error' && (
              <XCircle className="h-5 w-5" />
            )}
            <span className="text-sm font-medium">{statusBanner.message}</span>
          </div>
        </div>
      )}
      {/* Profile Section */}
      <Card id="profile" className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="text-2xl font-bold flex items-center gap-2">
            <User className="h-6 w-6" />
            Profile Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Profile Picture Section */}
          <div className="flex flex-col items-center space-y-4">
            <div className="relative">
              <Avatar className="h-24 w-24">
                <AvatarImage 
                  src={user?.profile_picture_url || undefined} 
                  alt={user?.full_name || user?.email || 'Profile'} 
                />
                <AvatarFallback className="text-lg">
                  {user?.full_name ? 
                    user.full_name.split(' ').map(n => n[0]).join('').toUpperCase() : 
                    user?.email?.[0]?.toUpperCase() || 'U'
                  }
                </AvatarFallback>
              </Avatar>
              {isUploadingPhoto && (
                <div className="absolute top-0 left-0 h-24 w-24 rounded-full bg-black/40 flex items-center justify-center">
                  <div className="animate-spin rounded-full h-6 w-6 border-2 border-white border-t-transparent"></div>
                </div>
              )}
              <Button
                size="sm"
                variant="outline"
                className="absolute -bottom-2 -right-2 rounded-full h-8 w-8 p-0"
                onClick={() => fileInputRef.current?.click()}
                disabled={hydrated ? isUploadingPhoto : false}
              >
                {isUploadingPhoto ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                ) : (
                  <Camera className="h-4 w-4" />
                )}
              </Button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileSelect}
            />
            <p className="text-sm text-muted-foreground">
              Click the camera icon to upload a new profile picture (max 5MB)
            </p>
          </div>

          <form onSubmit={handleProfileUpdate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Enter your full name"
                maxLength={100}
                disabled={hydrated ? isLoading : false}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="mail"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="Enter your email"
                disabled={hydrated ? isLoading : false}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="bio">Bio</Label>
              <Textarea
                id="bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Write a short bio about yourself (max 500 characters)"
                className="resize-none"
                rows={3}
                maxLength={500}
                disabled={hydrated ? isLoading : false}
              />
              <p className="text-xs text-muted-foreground">
                {bio.length}/500 characters
              </p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Write a detailed description about yourself, your expertise, interests, etc. (max 2000 characters)"
                className="resize-none"
                rows={5}
                maxLength={2000}
                disabled={hydrated ? isLoading : false}
              />
              <p className="text-xs text-muted-foreground">
                {description.length}/2000 characters
              </p>
            </div>
            
            <Button type="submit" disabled={hydrated ? (isLoading || isUpdatingProfile) : false}>
              {isUpdatingProfile ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Updating...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Update Profile
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Password Section */}
      <Card id="password" className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="text-xl font-semibold flex items-center gap-2">
            <Key className="h-5 w-5" />
            Change Password
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            <div>
              <label className="text-sm font-medium">Current Password</label>
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">New Password</label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="mt-1"
              />
            </div>
            <Button type="submit">Change Password</Button>
          </form>
        </CardContent>
      </Card>

      {/* Admin Section */}
      {user?.is_superuser && (
        <Card id="admin" className="w-full max-w-2xl">
          <CardHeader>
            <CardTitle className="text-xl font-semibold flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Administration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button asChild variant="outline" className="w-full">
              <Link href="/accounts/admin/users">
                User Management
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link href="/accounts/admin/backups">
                Infospace Backups
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link href="/accounts/admin/user-backups">
                User Backups (Disaster Recovery)
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link href="/accounts/admin/registration">
                Registration Management
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Delete Account Section */}
      {!user?.is_superuser && (
        <Card id="delete" className="w-full max-w-2xl border-destructive">
          <CardHeader>
            <CardTitle className="text-xl font-semibold text-destructive flex items-center gap-2">
              <Trash2 className="h-5 w-5" />
              Delete Account
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button 
              variant="destructive"
              onClick={() => {
                // Add confirmation dialog and deletion logic
              }}
            >
              Delete My Account
            </Button>
          </CardContent>
        </Card>
      )}

    </div>
  );
}
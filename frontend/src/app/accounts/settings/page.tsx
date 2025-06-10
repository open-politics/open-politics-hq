'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import useAuth from "@/hooks/useAuth";
import { Shield, User, Key, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { UsersService } from '@/client/services';

export default function AccountSettingsPage() {
  const { user } = useAuth();
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await UsersService.updateUserMe({
        requestBody: {
          full_name: fullName,
          email: email !== user?.email ? email : undefined,
        }
      });
      setMessage('Profile updated successfully');
    } catch (err) {
      setError('Failed to update profile');
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await UsersService.updatePasswordMe({
        requestBody: {
          current_password: currentPassword,
          new_password: newPassword,
        }
      });
      setMessage('Password updated successfully');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      setError('Failed to update password');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 space-y-4">
      {/* Profile Section */}
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">Profile Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <form onSubmit={handleProfileUpdate} className="space-y-4">
            <div>
              <label className="text-sm font-medium">Full Name</label>
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Email</label>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1"
                type="email"
              />
            </div>
            <Button type="submit">Update Profile</Button>
          </form>
        </CardContent>
      </Card>

      {/* Password Section */}
      <Card className="w-full max-w-2xl">
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
        <Card className="w-full max-w-2xl">
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
              <Link href="/accounts/admin/Infospaces">
                Infospace Management
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Delete Account Section */}
      {!user?.is_superuser && (
        <Card className="w-full max-w-2xl border-destructive">
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

      {(message || error) && (
        <div className={`p-4 rounded ${error ? 'bg-destructive/10' : 'bg-green-100'}`}>
          {message || error}
        </div>
      )}
    </div>
  );
}
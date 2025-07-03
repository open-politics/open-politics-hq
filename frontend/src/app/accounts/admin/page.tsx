'use client'

import AdminLayout from "@/app/accounts/admin/layout"
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useRouter } from 'next/navigation';

export default function AdminPage() {
  const router = useRouter();

  return (
    <AdminLayout>
      <div className="flex flex-col items-center justify-center min-h-screen space-y-4">
        <Card className="w-full max-w-sm p-8">
          <CardHeader>
            <CardTitle className="text-2xl font-bold text-center">Admin Page</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div
                className="block p-4 border border-gray-300 rounded hover:bg-secondary/60 transition-all duration-300 cursor-pointer"
                onClick={() => router.push('/accounts/admin/users')}
              >
                <CardTitle className="text-xl font-bold">User Management</CardTitle>
              </div>
              <div
                className="block p-4 border border-gray-300 rounded hover:bg-secondary/60 transition-all duration-300 cursor-pointer"
                onClick={() => router.push('/accounts/admin/infospaces')}
              >
                <CardTitle className="text-xl font-bold">Infospace Management</CardTitle>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}

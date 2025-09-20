'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import useAuth from '@/hooks/useAuth';
import { Loader2 } from 'lucide-react';

function SSOCompleteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sso = searchParams.get('sso');
    const sig = searchParams.get('sig');

    if (!sso || !sig) {
      setError('Missing SSO parameters');
      return;
    }

    if (isLoading) return;

    if (!user) {
      // User not authenticated, redirect to login with return URL
      const returnUrl = encodeURIComponent(window.location.href);
      router.push(`/accounts/login?return_url=${returnUrl}`);
      return;
    }

    // User is authenticated, complete the SSO process
    const completSSO = async () => {
      setIsProcessing(true);
      try {
        const token = localStorage.getItem('access_token');
        if (!token) {
          throw new Error('No access token found');
        }

        const response = await fetch('/api/v1/sso/discourse/complete', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            sso: sso,
            sig: sig,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.redirect_url) {
            window.location.href = data.redirect_url;
          } else {
            // Fallback: redirect to forum
            window.location.href = 'https://forum.open-politics.org';
          }
        } else {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || `SSO completion failed: ${response.status}`);
        }
      } catch (err: any) {
        console.error('SSO completion error:', err);
        setError(err.message || 'Failed to complete SSO');
        setIsProcessing(false);
      }
    };

    completSSO();
  }, [user, isLoading, searchParams, router]);

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-4">SSO Error</h1>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={() => router.push('/accounts/login')}
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
        <h1 className="text-2xl font-bold mb-2">Completing Forum Login</h1>
        <p className="text-gray-600">
          {isLoading ? 'Checking authentication...' : 
           !user ? 'Redirecting to login...' : 
           isProcessing ? 'Completing SSO...' : 'Processing...'}
        </p>
      </div>
    </div>
  );
}

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
        <h1 className="text-2xl font-bold mb-2">Loading SSO</h1>
        <p className="text-gray-600">Preparing forum login...</p>
      </div>
    </div>
  );
}

export default function SSOCompletePage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <SSOCompleteContent />
    </Suspense>
  );
} 
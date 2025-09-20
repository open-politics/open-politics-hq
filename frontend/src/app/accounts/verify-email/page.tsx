'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle, XCircle, Loader2, Mail } from 'lucide-react';
import Link from 'next/link';

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isVerifying, setIsVerifying] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const token = searchParams.get('token');

  useEffect(() => {
    if (!token) {
      setError('No verification token provided');
      return;
    }

    const verifyEmail = async () => {
      setIsVerifying(true);
      try {
                 const response = await fetch(`/api/v1/users/verify-email?token=${encodeURIComponent(token)}`, {
           method: 'POST',
           headers: {
             'Content-Type': 'application/json',
           },
         });

        if (response.ok) {
          setIsVerified(true);
          
          // Redirect to login after 3 seconds
          setTimeout(() => {
            router.push('/accounts/login?message=Email verified! Please log in.');
          }, 3000);
        } else {
          const errorData = await response.json();
          setError(errorData.detail || 'Email verification failed');
        }
      } catch (err: any) {
        console.error('Verification error:', err);
        setError('Network error during verification');
      } finally {
        setIsVerifying(false);
      }
    };

    verifyEmail();
  }, [token, router]);

  if (isVerifying) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md p-8 bg-transparent bg-opacity-95 backdrop-blur-lg">
          <CardContent className="text-center space-y-4">
            <Loader2 className="w-16 h-16 animate-spin text-blue-500 mx-auto" />
            <h2 className="text-2xl font-bold">Verifying Your Email</h2>
            <p className="text-gray-600">
              Please wait while we verify your email address...
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isVerified) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md p-8 bg-transparent bg-opacity-95 backdrop-blur-lg">
          <CardContent className="text-center space-y-4">
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
            <h2 className="text-2xl font-bold text-green-600">Email Verified!</h2>
            <p className="text-gray-600">
              Your email has been successfully verified. Your account is now active.
            </p>
            <p className="text-sm text-gray-500">
              Redirecting to login in 3 seconds...
            </p>
            <Button 
              onClick={() => router.push('/accounts/login')}
              className="w-full"
            >
              Continue to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md p-8 bg-transparent bg-opacity-95 backdrop-blur-lg">
          <CardContent className="text-center space-y-4">
            <XCircle className="w-16 h-16 text-red-500 mx-auto" />
            <h2 className="text-2xl font-bold text-red-600">Verification Failed</h2>
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            
            <div className="space-y-2">
              <p className="text-sm text-gray-600">Common issues:</p>
              <ul className="text-sm text-gray-600 text-left space-y-1">
                <li>• The verification link may have expired (24 hours)</li>
                <li>• The link may have been used already</li>
                <li>• The link may be invalid or corrupted</li>
              </ul>
            </div>

            <div className="flex flex-col gap-2">
              <Button 
                variant="outline"
                onClick={() => router.push('/accounts/resend-verification')}
                className="w-full"
              >
                <Mail className="w-4 h-4 mr-2" />
                Request New Verification Email
              </Button>
              <Button 
                variant="ghost"
                onClick={() => router.push('/accounts/register')}
                className="w-full"
              >
                Back to Registration
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <Card className="w-full max-w-md p-8 bg-transparent bg-opacity-95 backdrop-blur-lg">
        <CardContent className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin mx-auto" />
          <h2 className="text-xl font-bold">Loading...</h2>
        </CardContent>
      </Card>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <VerifyEmailContent />
    </Suspense>
  );
} 
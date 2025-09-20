'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle, Mail, Loader2, Clock } from 'lucide-react';
import Link from 'next/link';

function ResendVerificationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);

  // Get email from URL params if available
  useEffect(() => {
    const emailParam = searchParams.get('email');
    if (emailParam) {
      setEmail(emailParam);
    }
  }, [searchParams]);

  // Countdown timer for rate limiting
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (countdown > 0) {
      timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/v1/users/resend-verification?email=${encodeURIComponent(email)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        setSuccess(true);
        setCountdown(60); // 60 second cooldown
      } else {
        const errorData = await response.json();
        if (response.status === 429) {
          setError('Please wait before requesting another verification email');
          setCountdown(60);
        } else {
          setError(errorData.detail || 'Failed to send verification email');
        }
      }
    } catch (err: any) {
      console.error('Resend verification error:', err);
      setError('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md p-8 bg-transparent bg-opacity-95 backdrop-blur-lg">
          <CardContent className="text-center space-y-4">
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
            <h2 className="text-2xl font-bold text-green-600">Verification Email Sent!</h2>
            <p className="text-gray-600">
              We've sent a new verification email to <strong>{email}</strong>
            </p>
            <div className="text-sm text-gray-500 space-y-2">
              <p>📧 Please check your email and click the verification link</p>
              <p>⏰ The verification link will expire in 24 hours</p>
              {countdown > 0 && (
                <p className="flex items-center justify-center gap-1">
                  <Clock className="w-4 h-4" />
                  You can request another email in {countdown} seconds
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2 mt-4">
              <Button 
                onClick={() => router.push('/accounts/login')}
                className="w-full"
              >
                Go to Login
              </Button>
              {countdown === 0 && (
                <Button 
                  variant="outline"
                  onClick={() => setSuccess(false)}
                  className="w-full"
                >
                  Send Another Email
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <Card className="w-full max-w-md p-8 bg-transparent bg-opacity-95 backdrop-blur-lg">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-center flex items-center justify-center gap-2">
            <Mail className="h-6 w-6" />
            Resend Verification Email
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Email Address</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email address"
                required
                className="w-full"
                disabled={isLoading || countdown > 0}
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {countdown > 0 && (
              <Alert>
                <Clock className="h-4 w-4" />
                <AlertDescription>
                  Please wait {countdown} seconds before requesting another email
                </AlertDescription>
              </Alert>
            )}

            <Button 
              type="submit" 
              className="w-full"
              disabled={isLoading || countdown > 0 || !email}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : countdown > 0 ? (
                `Wait ${countdown}s`
              ) : (
                <>
                  <Mail className="w-4 h-4 mr-2" />
                  Send Verification Email
                </>
              )}
            </Button>
          </form>

          <div className="mt-6 text-center space-y-2">
            <p className="text-sm text-gray-600">
              Remember your password?{' '}
              <Link href="/accounts/login" className="text-blue-500 hover:text-blue-600">
                Back to Login
              </Link>
            </p>
            <p className="text-sm text-gray-600">
              Need to register?{' '}
              <Link href="/accounts/register" className="text-blue-500 hover:text-blue-600">
                Create Account
              </Link>
            </p>
          </div>

          <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
            <h4 className="font-medium text-blue-800 dark:text-blue-200 mb-2">Tips:</h4>
            <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
              <li>• Check your spam/junk folder</li>
              <li>• Verification links expire after 24 hours</li>
              <li>• Make sure you use the most recent verification email</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
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

export default function ResendVerificationPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <ResendVerificationContent />
    </Suspense>
  );
} 
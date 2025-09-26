'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardFooter, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import useAuth from "@/hooks/useAuth";
import { Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const router = useRouter();
  const { loginMutation, error, isLoggedIn } = useAuth();

  // Get return URL from query params
  useEffect(() => {
    if (isLoggedIn && !isRedirecting) {
      const urlParams = new URLSearchParams(window.location.search);
      const returnUrl = urlParams.get('return_url');
      
      if (returnUrl) {
        setIsRedirecting(true);
        
        // For SSO flow, redirect back to the original URL to complete the flow
        console.log('SSO: Redirecting to return URL:', returnUrl);
        window.location.href = returnUrl;
      } else {
        router.push('/hq');
      }
    }
  }, [isLoggedIn, isRedirecting, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await loginMutation.mutateAsync({
        username: email,
        password,
        grant_type: 'password',
        scope: '',
        client_id: '',
        client_secret: '',
      });
    } catch (err) {
      console.error('Login error:', err);
    }
  };

  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword);
  };

  // Don't render anything if we're redirecting
  if (isRedirecting) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p>Redirecting...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <Card className="w-full max-w-4xl grid md:grid-cols-2 shadow-2xl bg-transparent bg-opacity-95 backdrop-blur-lg rounded-xl overflow-hidden">
        <div className="p-8 md:p-12 lg:p-16 space-y-6">
          <CardHeader className="p-0">
            <CardTitle className="text-3xl font-bold">Login</CardTitle>
            <CardDescription>Welcome back! Please enter your details.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <form id="login-form" onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm">Email</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  required
                  className="w-full p-2 border border-gray-300 rounded text-base"
                />
              </div>
              <div>
                <label className="block text-sm">Password</label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    required
                    className="w-full p-2 border border-gray-300 rounded text-base pr-10"
                  />
                  <button
                    type="button"
                    onClick={togglePasswordVisibility}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-sm leading-5"
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>
              {error && (
                <div className="space-y-2">
                  <p className="text-red-500 text-sm">{error}</p>
                  {error.includes('Inactive user') && (
                    <p className="text-sm text-gray-600">
                      Your account may need email verification.{' '}
                      <a 
                        href={`/accounts/resend-verification?email=${encodeURIComponent(email)}`}
                        className="text-blue-500 hover:text-blue-600"
                      >
                        Resend verification email
                      </a>
                    </p>
                  )}
                </div>
              )}
              <Button 
                type="submit" 
                className="w-full md:hidden"
                disabled={loginMutation.isPending}
              >
                {loginMutation.isPending ? 'Logging in...' : 'Login'}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="p-0 flex flex-col items-start space-y-2">
            <p className="text-sm">
              Don't have an account?{' '}
              <Link href="/accounts/register" className="text-blue-500 hover:text-blue-600">
                Register here
              </Link>
            </p>
            <p className="text-sm">
              For support, please contact us at{' '}
              <a 
                href="mailto:engage@open-politics.org"
                className="text-blue-500 hover:text-blue-600"
              >
                engage@open-politics.org
              </a>
            </p>
          </CardFooter>
        </div>
        <div className="hidden md:flex flex-col justify-center bg-background/60 bg-opacity-50 p-12">
        <h2 className="text-3xl font-bold">Open Politics HQ</h2>
        <div className="mt-6 flex items-center gap-3 font-mono text-sm">
          <span>&gt;</span>
          <Button
            className="w-32 md:w-48 border-blue-500"
            type="submit" 
            form="login-form" 
            disabled={loginMutation.isPending}
            variant="outline"
          >
            {loginMutation.isPending ? 'Logging in...' : 'Login'}
          </Button>
        </div>
        </div>
      </Card>
    </div>
  );
}

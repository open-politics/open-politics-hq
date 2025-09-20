import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  type Body_login_login_access_token as AccessToken,
  type ApiError,
  LoginService,
  UserOut,
  UsersOut,
  UsersService,
  OpenAPI,
} from "../client"
import { AxiosError } from 'axios';

type User = UserOut & {
  avatar?: string;
  is_superuser?: boolean;
};

const isLoggedIn = () => {
  return typeof window !== 'undefined' && localStorage.getItem("access_token") !== null;
}

const useAuth = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  // On mount or token change, update OpenAPI so requests include our token
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem("access_token");
      if (token) {
        OpenAPI.HEADERS = async () => ({
          Authorization: `Bearer ${token}`,
        });
      } else {
        // If no token, remove any custom Authorization header
        OpenAPI.HEADERS = undefined;
      }
    }
  }, []);

  // This query runs only if isLoggedIn() is true
  const { data: user, isLoading } = useQuery<User | null, Error>({
    queryKey: ["CurrentUser"],
    queryFn: UsersService.readUserMe,
    enabled: isLoggedIn(),
  })

  const loginMutation = useMutation({
    mutationFn: async (data: AccessToken) => {
      console.log('Attempting to log in with provided credentials...');
      const response = await LoginService.loginAccessToken({ formData: data });
      console.log('Login successful, storing access token.');
      localStorage.setItem('access_token', response.access_token);
      return response;
    },
    onSuccess: () => {
      console.log('Login mutation successful, navigating to home.');
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['CurrentUser'] });
      
      // Don't auto-redirect if there's a return URL (SSO flow)
      const urlParams = new URLSearchParams(window.location.search);
      const returnUrl = urlParams.get('return_url');
      
      if (!returnUrl) {
        router.push('/hq');
      }
      // If there is a return_url, let the login page handle the redirect
    },
    onError: (err: ApiError) => {
      let errDetail = (err.body as any)?.detail || 'Login failed';
      if (err instanceof AxiosError) {
        errDetail = err.message
      }
      setError(errDetail);
      console.error('Login error:', errDetail);
    },
  });

  const logout = () => {
    console.log('Logging out, removing access token.');
    localStorage.removeItem('access_token');
    router.push('/accounts/login');
    setError(null);
  };

  return {
    user,
    isLoading,
    isLoggedIn: !!user,
    loginMutation,
    logout,
    error,
    resetError: () => setError(null),
  };
};

export default useAuth;
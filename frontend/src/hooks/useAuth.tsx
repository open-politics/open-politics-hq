import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  type Body_login_login_access_token as AccessToken,
  type ApiError,
  LoginService,
  UserOut,
  UsersService,
  OpenAPI,
} from '@/client';
import { useProvidersStore } from '@/zustand_stores/storeProviders';
import { authHeaders } from '@/lib/authHeaders';
import { assert } from '@/lib/assert';

type User = UserOut & {
  avatar?: string;
  is_superuser?: boolean;
};

const useAuth = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [hasToken, setHasToken] = useState<boolean>(false);
  const [isLoggingOut, setIsLoggingOut] = useState<boolean>(false);
  const hydrateFromProfile = useProvidersStore((s) => s.hydrateFromProfile);

  // Check token on mount and listen for changes
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateTokenState = () => {
      const token = localStorage.getItem("access_token");
      setHasToken(!!token);
      OpenAPI.HEADERS = token ? async () => ({ ...authHeaders(token) }) : undefined;
    };

    updateTokenState();

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'access_token') updateTokenState();
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Drop the credential, keep the page: an expired session is "no user", not a redirect.
  const clearSession = () => {
    localStorage.removeItem('access_token');
    setHasToken(false);
    OpenAPI.HEADERS = undefined;
  };

  const { data: user, isLoading } = useQuery<User | null, Error>({
    queryKey: ["CurrentUser"],
    // A rejected token means signed out — clear it once here rather than retrying it on every mount.
    queryFn: () => UsersService.readUserMe().catch((e: ApiError) => {
      if (e.status !== 401) throw e;
      assert(hasToken, '401 on /users/me without a token sent');
      clearSession();
      return null;
    }),
    enabled: hasToken && !isLoggingOut,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  })

  // The provider store writes `provider_defaults` but had no reader, so a saved
  // default never came back and every picker fell through to its own heuristic.
  useEffect(() => {
    if (user?.provider_defaults) {
      hydrateFromProfile(user.provider_defaults as any);
    }
  }, [user?.provider_defaults, hydrateFromProfile]);

  const loginMutation = useMutation({
    mutationFn: async (data: AccessToken) => {
      // Login exchanges credentials; a stale Bearer riding along can get it rejected upstream.
      OpenAPI.HEADERS = undefined;
      const response = await LoginService.loginAccessToken({ formData: data });
      assert(response.access_token, 'login succeeded without a token');
      localStorage.setItem('access_token', response.access_token);
      OpenAPI.HEADERS = async () => ({ ...authHeaders(response.access_token) });
      return response;
    },
    onSuccess: () => {
      setError(null);
      setHasToken(true);
      queryClient.invalidateQueries({ queryKey: ['CurrentUser'] });
      
      const urlParams = new URLSearchParams(window.location.search);
      const returnUrl = urlParams.get('return_url');
      
      if (!returnUrl) {
        router.push('/hq');
      }
    },
    onError: (err: ApiError) => {
      const errDetail = (err.body as any)?.detail || err.message || 'Login failed';
      setError(errDetail);
    },
  });

  const logout = () => {
    if (isLoggingOut) return;
    
    setIsLoggingOut(true);
    
    // Cancel all ongoing queries and clear cache
    queryClient.cancelQueries();
    queryClient.clear();
    
    clearSession();
    setError(null);
    
    // Navigate to login page
    router.push('/accounts/login');
    
    // Reset logout state
    setTimeout(() => setIsLoggingOut(false), 500);
  };

  return {
    user,
    isLoading,
    isLoggedIn: !!user && !isLoading && !isLoggingOut,
    isLoggingOut,
    loginMutation,
    logout,
    error,
    resetError: () => setError(null),
  };
};

export default useAuth;
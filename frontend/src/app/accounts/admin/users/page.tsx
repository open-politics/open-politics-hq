'use client';

import { useState, useEffect, ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { UsersService, UserCreate, UserOut, UsersOut } from '@/client';
import useAuth from "@/hooks/useAuth";
import { Eye, EyeOff, Upload, Users, RefreshCw } from 'lucide-react';
import withAdminAuth from '@/hooks/withAdminAuth';
import { parse } from 'papaparse';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

export default withAdminAuth(function UserManagementPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [isProcessingCsv, setIsProcessingCsv] = useState(false);
  const [csvProcessLog, setCsvProcessLog] = useState<string[]>([]);
  const [csvError, setCsvError] = useState<string | null>(null);

  const [usersList, setUsersList] = useState<UserOut[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [fetchUsersError, setFetchUsersError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  const router = useRouter();
  const { user, isLoading } = useAuth();

  const fetchUsers = async () => {
    setIsLoadingUsers(true);
    setFetchUsersError(null);
    setSelectedUserId(null);
    try {
      const response: UsersOut = await UsersService.readUsers({});
      setUsersList(response.data || []);
    } catch (error) {
      console.error('Error fetching users:', error);
      setFetchUsersError('Failed to fetch users. Please try again.');
    } finally {
      setIsLoadingUsers(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleSingleUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    try {
      await UsersService.createUser({
        requestBody: {
          email,
          password,
          full_name: fullName || undefined,
          is_active: true,
          is_superuser: false,
        },
      });
      setEmail('');
      setPassword('');
      setFullName('');
      alert('User created successfully');
      fetchUsers();
    } catch (error) {
      setErrorMessage('Failed to create user. Please try again.');
      console.error('Error creating user:', error);
    }
  };

  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
        setCsvFile(file);
        setCsvError(null);
        setCsvProcessLog([]);
      } else {
        setCsvFile(null);
        setCsvError('Please select a valid CSV file.');
        setCsvProcessLog([]);
      }
    }
  };

  const processCsv = async () => {
    if (!csvFile) {
      setCsvError('No CSV file selected.');
      return;
    }

    setIsProcessingCsv(true);
    setCsvProcessLog([]);
    setCsvError(null);
    let processedCount = 0;
    let failedCount = 0;

    parse(csvFile, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const logs: string[] = [];
        logs.push(`Found ${results.data.length} rows in CSV.`);

        const expectedHeaders = ['Group', 'Email', 'Password', 'Name'];
        const actualHeaders = results.meta.fields;
        if (!actualHeaders || !expectedHeaders.every(h => actualHeaders.includes(h))) {
          setCsvError(`Invalid CSV headers. Expected: ${expectedHeaders.join(', ')}. Found: ${actualHeaders?.join(', ')}`);
          setIsProcessingCsv(false);
          setCsvProcessLog(logs);
          return;
        }

        for (let i = 0; i < results.data.length; i++) {
          const row = results.data[i] as any;
          const rowIndex = i + 1;

          const userEmail = row['Email']?.trim();
          const userPassword = row['Password']?.trim();
          const userFullName = row['Name']?.trim() || null;
          const userGroup = row['Group']?.trim().toLowerCase();

          if (!userEmail || !userPassword) {
            logs.push(`Row ${rowIndex}: Skipped - Missing Email or Password.`);
            failedCount++;
            continue;
          }

          const isSuperuser = userGroup === 'admin' || userGroup === 'superuser';

          const userPayload: UserCreate = {
            email: userEmail,
            password: userPassword,
            full_name: userFullName,
            is_active: true,
            is_superuser: isSuperuser,
          };

          try {
            await UsersService.createUser({ requestBody: userPayload });
            logs.push(`Row ${rowIndex}: User ${userEmail} created successfully.`);
            processedCount++;
          } catch (error: any) {
            const detail = error?.body?.detail || 'Unknown error';
            logs.push(`Row ${rowIndex}: Failed to create user ${userEmail}. Error: ${detail}`);
            failedCount++;
          }
          setCsvProcessLog([...logs]);
        }

        logs.push(`--- Processing Complete ---`);
        logs.push(`Successfully created: ${processedCount}`);
        logs.push(`Failed: ${failedCount}`);
        setCsvProcessLog(logs);
        setIsProcessingCsv(false);
        fetchUsers();
      },
      error: (error: Error) => {
        setCsvError(`Error parsing CSV: ${error.message}`);
        setIsProcessingCsv(false);
      }
    });
  };

  return (
    <div className="container mx-auto p-4 grid grid-cols-1 md:grid-cols-2 gap-8">
      <div className="space-y-8">
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="text-xl font-bold text-center">Create New User</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSingleUserSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Email</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="user@example.com"
                  required
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Password</label>
                <div className="relative mt-1">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    required
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm pr-10"
                  />
                  <button
                    type="button"
                    onClick={togglePasswordVisibility}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Full Name (Optional)</label>
                <Input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Full Name"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                />
              </div>
              {errorMessage && (
                <Alert variant="destructive">
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" className="w-full justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
                Create User
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="w-full">
          <CardHeader>
            <CardTitle className="text-xl font-bold text-center">Bulk Create Users via CSV</CardTitle>
            <CardDescription className="text-center text-sm text-gray-600">
              Upload a CSV file with columns: Group, Email, Password, Name.<br />
              Set Group to "admin" or "superuser" for admin privileges.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label htmlFor="csv-upload" className="block text-sm font-medium text-gray-700 mb-1">Select CSV File</label>
              <Input
                id="csv-upload"
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="block w-full text-sm text-gray-500
                         file:mr-4 file:py-2 file:px-4
                         file:rounded-md file:border-0
                         file:text-sm file:font-semibold
                         file:bg-indigo-50 file:text-indigo-700
                         hover:file:bg-indigo-100"
              />
            </div>

            {csvFile && (
              <Button
                onClick={processCsv}
                disabled={isProcessingCsv}
                className="w-full justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50"
              >
                {isProcessingCsv ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Processing...
                  </>
                ) : (
                  <><Upload className="mr-2 h-5 w-5" /> Process CSV File</>
                )}
              </Button>
            )}

            {csvError && (
              <Alert variant="destructive">
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{csvError}</AlertDescription>
              </Alert>
            )}

            {csvProcessLog.length > 0 && (
              <div className="mt-4 p-3 border rounded-md bg-gray-50 max-h-60 overflow-y-auto">
                <h4 className="text-sm font-medium mb-2">Processing Log:</h4>
                <pre className="text-xs whitespace-pre-wrap">
                  {csvProcessLog.join('\n')}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="w-full">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-xl font-bold">User List</CardTitle>
          <Button variant="outline" size="icon" onClick={fetchUsers} disabled={isLoadingUsers} aria-label="Refresh user list">
            <RefreshCw className={`h-4 w-4 ${isLoadingUsers ? 'animate-spin' : ''}`} />
          </Button>
        </CardHeader>
        <CardContent>
          {isLoadingUsers && <p className="text-center text-gray-500">Loading users...</p>}
          {fetchUsersError && (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{fetchUsersError}</AlertDescription>
            </Alert>
          )}
          {!isLoadingUsers && !fetchUsersError && (
            <ScrollArea className="min-h-96 max-h-[400px] border rounded-md">
              <div className="p-2 space-y-1">
                {usersList.length === 0 ? (
                  <p className="text-center text-gray-500 p-4">No users found.</p>
                ) : (
                  usersList.map((user) => (
                    <div
                      key={user.id}
                      onClick={() => setSelectedUserId(user.id)}
                      className={`p-2 border rounded-md cursor-pointer hover:bg-gray-100 transition-colors ${
                        selectedUserId === user.id ? 'bg-indigo-100 border-indigo-300' : 'border-transparent'
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-medium">{user.email}</span>
                        <div>
                          {user.is_superuser && (
                            <Badge variant="secondary" className="mr-2">Admin</Badge>
                          )}
                          <Badge variant={user.is_active ? "default" : "outline"}>
                            {user.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                      </div>
                      {user.full_name && (
                        <p className="text-sm text-gray-600">{user.full_name}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
});

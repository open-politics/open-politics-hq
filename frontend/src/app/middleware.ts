// Temporarily disabled - conflicts with custom JWT auth
// import { withAuth } from "next-auth/middleware";

// export default withAuth({
//   pages: {
//     signIn: "/login",
//   },
// });

// export const config = {
//   matcher: ["/((?!api|_next/static|_next/image|.*\\.png$).*)"],
// };

// No middleware for now - using client-side auth protection
export function middleware() {
  // No middleware logic
}


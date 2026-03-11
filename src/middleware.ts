import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Add CORS headers for API routes
  const response = NextResponse.next();
  response.headers.set('X-App-Name', 'ChefAI Recipe Finder');
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

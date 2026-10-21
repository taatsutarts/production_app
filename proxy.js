import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'

// Pages that logged-out visitors are allowed to see
const PUBLIC_PATHS = ['/login']

// API routes called by outside systems (Shopify, Zoho, cron, scripts).
// They skip the login check and MUST verify their own secret or signature.
// Any /api route NOT listed here requires a logged-in user.
const SELF_AUTH_PATHS = [
  '/api/webhooks',        // Shopify webhook (verifies HMAC signature)
  '/api/dispatch_import', // verifies its own bearer secret
  '/api/ck_stock_fetch',  // verifies its own bearer secret
  // add any other route that an outside system calls
]

// Matches the exact path or anything beneath it, so '/api/webhooks'
// matches '/api/webhooks/shopify' but not '/api/webhooks-old'
const matches = (pathname, list) =>
  list.some((p) => pathname === p || pathname.startsWith(p + '/'))

export async function proxy(request) {
  const { pathname } = request.nextUrl

  // Self-authenticating routes: no login check, no Supabase session lookup
  if (matches(pathname, SELF_AUTH_PATHS)) {
    return NextResponse.next()
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          list.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Verifies the session with Supabase and refreshes it if needed
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isPublic = matches(pathname, PUBLIC_PATHS)

  // Logged out and trying to open a protected route
  if (!user && !isPublic) {
    // API calls get a JSON error instead of a redirect to the login page
    if (pathname.startsWith('/api')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Already logged in and visiting /login -> send to the app
  if (user && pathname.startsWith('/login')) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: [
    // Run on every route except static files and images
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
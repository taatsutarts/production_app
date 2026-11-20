import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import { NO_ACCESS_PATH, STORE_HOME, storeMayOpen } from '@/lib/access'

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

  if (!user) return response // public page, logged out

  // Already logged in and visiting /login -> send to the app
  if (pathname.startsWith('/login')) return redirectTo(request, '/')

  // Role check (user_profiles; the login may read its own row). Stores only reach
  // their pages — and NO /api route, because those use the service key and
  // would ignore the per-outlet database rules.
  const { data: profile, error: profileErr } = await supabase
    .from('user_profiles')
    .select('role, outlet_id, outlets(name)')
    .eq('user_id', user.id)
    .maybeSingle()

  // table not created yet (supabase_migration_store_users.sql not run): keep the
  // old behaviour — the only logins that exist are the owner's
  if (profileErr?.code === 'PGRST205') return response

  // admin: the whole app, except /store/* (those pages need a store's outlet)
  if (profile?.role === 'admin') {
    return storeMayOpen(pathname) ? redirectTo(request, '/', response) : response
  }

  // store: the /store area only; every /api route is closed (service key, no RLS)
  if (profile?.role === 'store') {
    if (pathname.startsWith('/api')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!storeMayOpen(pathname)) return redirectTo(request, STORE_HOME, response)
    return response
  }

  // logged in but no role yet
  if (pathname === NO_ACCESS_PATH) return response
  if (pathname.startsWith('/api')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return redirectTo(request, NO_ACCESS_PATH, response)
}

// redirect that keeps any refreshed session cookies
function redirectTo(request, path, from) {
  const url = request.nextUrl.clone()
  url.pathname = path
  url.search = ''
  const res = NextResponse.redirect(url)
  if (from) from.cookies.getAll().forEach((c) => res.cookies.set(c))
  return res
}

export const config = {
  matcher: [
    // Run on every route except static files and images
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
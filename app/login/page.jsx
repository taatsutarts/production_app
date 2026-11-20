'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

function EyeIcon({ off }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {off ? (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </>
      ) : (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  )
}


export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()

  // accounts are created by the admin in Supabase (Authentication -> Users):
  // no self sign-up — store logins only see their own outlet
  const [role, setRole] = useState('admin') // 'admin' | 'store' — who is logging in
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    // the chosen role must match the account's real role (user_profiles); a store
    // login can't enter as admin and the other way round. Table missing (migration
    // not run yet) = old behaviour, everyone is admin.
    const { data: u } = await supabase.auth.getUser()
    const { data: prof, error: profErr } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('user_id', u?.user?.id)
      .maybeSingle()
    const actual = profErr?.code === 'PGRST205' ? 'admin' : prof?.role
    if (actual !== role) {
      await supabase.auth.signOut()
      setError(
        !actual
          ? 'This account has no access yet. Ask the admin to set it up.'
          : actual === 'admin'
            ? 'This is an admin account. Choose "Admin" to log in.'
            : 'This is a store account. Choose "Store" to log in.'
      )
      setLoading(false)
      return
    }
    setMessage('Logged in! Redirecting...')
    router.push(actual === 'store' ? '/store' : '/')
    router.refresh()
  }

  return (
    <main className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-gray-100 p-4">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-xl bg-white p-7 shadow-lg"
      >
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Welcome back Taatsu
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Log in as {role === 'admin' ? 'admin' : 'a store'} to continue
          </p>
        </div>

        <div role="radiogroup" aria-label="Log in as" className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1">
          {[['admin', 'Admin'], ['store', 'Store']].map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={role === v}
              onClick={() => {
                setRole(v)
                setError('')
              }}
              className={`rounded-md px-3 py-2 text-sm font-semibold transition ${
                role === v ? 'bg-black text-white shadow' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-semibold text-gray-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-gray-900 outline-none focus:border-black focus:ring-1 focus:ring-black"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-semibold text-gray-700">
            Password
          </label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-3 pr-11 text-gray-900 outline-none focus:border-black focus:ring-1 focus:ring-black"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-800"
            >
              <EyeIcon off={showPassword} />
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</div>
        )}
        {message && (
          <div className="rounded-lg bg-green-50 px-3 py-2.5 text-sm text-green-700">{message}</div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-black px-3 py-2.5 font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Please wait...' : 'Log in'}
        </button>

      </form>
    </main>
  )
}
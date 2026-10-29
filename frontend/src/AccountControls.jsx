import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient.js'

export default function AccountControls({ session, sessionLoading, signOutDisabled = false }) {
  const dialogRef = useRef(null)
  const openerRef = useRef(null)
  const [mode, setMode] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [signOutError, setSignOutError] = useState('')

  useEffect(() => {
    if (!mode) {
      openerRef.current?.focus()
      return
    }
    const firstInput = dialogRef.current?.querySelector('input:not(:disabled)')
    const focusTarget = firstInput || dialogRef.current?.querySelector('button:not(:disabled)')
    focusTarget?.focus()
  }, [mode])

  useEffect(() => {
    if (!mode) return
    function onKeyDown(event) {
      if (event.key === 'Escape' && !pending) setMode(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode, pending])

  function open(modeToOpen) {
    if (!mode) openerRef.current = document.activeElement
    setMode(modeToOpen)
    setEmail('')
    setPassword('')
    setConfirmPassword('')
    setMessage('')
    setError('')
    setSignOutError('')
  }

  async function submit(event) {
    event.preventDefault()
    if (!supabase || pending) return
    if (mode === 'sign-up' && password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setPending(true)
    setError('')
    setMessage('')
    try {
      const credentials = { email: email.trim(), password }
      const { data, error: authError } = mode === 'sign-up'
        ? await supabase.auth.signUp({ ...credentials, options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` } })
        : await supabase.auth.signInWithPassword(credentials)
      if (authError) throw authError
      if (data.session) {
        setMode(null)
      } else if (mode === 'sign-up') {
        setPassword('')
        setConfirmPassword('')
        setMessage('Check your email for a confirmation link, then sign in.')
      }
    } catch (authError) {
      setError(authError.message || 'Authentication failed. Please try again.')
    } finally {
      setPending(false)
    }
  }

  async function signOut() {
    if (!supabase || pending) return
    setPending(true)
    setSignOutError('')
    try {
      const { error: authError } = await supabase.auth.signOut({ scope: 'local' })
      if (authError) throw authError
    } catch (authError) {
      setSignOutError(authError.message || 'Could not sign out. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <div className="account-controls">
        {sessionLoading ? <span className="account-label">Loading account…</span> : session ? (
          <>
            <span className="account-email" title={session.user.email}>{session.user.email}</span>
            <button className="tool-button" type="button" onClick={signOut} disabled={pending || signOutDisabled}>Sign out</button>
          </>
        ) : (
          <>
            <button className="tool-button" type="button" onClick={() => open('sign-in')}>Sign in</button>
            <button className="tool-button account-sign-up" type="button" onClick={() => open('sign-up')}>Sign up</button>
          </>
        )}
        {signOutError && <span className="account-error" role="alert">{signOutError}</span>}
      </div>

      {mode && <div className="account-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setMode(null) }}>
        <section ref={dialogRef} className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-title" onKeyDown={(event) => {
          if (event.key !== 'Tab') return
          const focusable = [...event.currentTarget.querySelectorAll('button:not(:disabled), input:not(:disabled)')]
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }}>
          <button className="account-close" type="button" aria-label="Close account dialog" onClick={() => setMode(null)} disabled={pending}>×</button>
          <h2 id="account-title">{mode === 'sign-up' ? 'Create an account' : 'Sign in'}</h2>
          <p className="account-intro">{mode === 'sign-up' ? 'Create an OptiSuite account with your email.' : 'Welcome back to OptiSuite.'}</p>
          {!supabase ? <p className="account-message error" role="alert">Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to frontend/.env.local.</p> : (
            <form onSubmit={submit}>
              <label htmlFor="account-email">Email</label>
              <input id="account-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={pending} />
              <label htmlFor="account-password">Password</label>
              <input id="account-password" type="password" autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'} required minLength={mode === 'sign-up' ? 6 : undefined} value={password} onChange={(event) => setPassword(event.target.value)} disabled={pending} />
              {mode === 'sign-up' && <>
                <label htmlFor="account-confirm-password">Confirm password</label>
                <input id="account-confirm-password" type="password" autoComplete="new-password" required minLength={6} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} disabled={pending} />
              </>}
              {error && <p className="account-message error" role="alert">{error}</p>}
              {message && <p className="account-message" role="status">{message}</p>}
              <button className="account-submit" type="submit" disabled={pending}>{pending ? 'Please wait…' : mode === 'sign-up' ? 'Create account' : 'Sign in'}</button>
            </form>
          )}
          <p className="account-switch">
            {mode === 'sign-up' ? 'Already have an account?' : 'New to OptiSuite?'}{' '}
            <button type="button" onClick={() => open(mode === 'sign-up' ? 'sign-in' : 'sign-up')} disabled={pending}>{mode === 'sign-up' ? 'Sign in' : 'Sign up'}</button>
          </p>
        </section>
      </div>}
    </>
  )
}

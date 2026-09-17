import { useState } from 'react'
import { supabase, LOGIN_EMAIL } from './supabase.js'

export default function Login() {
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    const { error } = await supabase.auth.signInWithPassword({
      email: LOGIN_EMAIL,
      password: code,
    })
    if (error) {
      setErr('Wrong passcode')
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <img className="mark" src="/icon-192.png" alt="" />
      <h1 className="wordmark">Herd</h1>
      <form onSubmit={submit}>
        <input
          className="field"
          type="password"
          placeholder="Passcode"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
        />
        <button className="btn primary" disabled={busy || !code}>
          {busy ? 'Checking…' : 'Open'}
        </button>
        {err && <div className="err">{err}</div>}
      </form>
    </div>
  )
}

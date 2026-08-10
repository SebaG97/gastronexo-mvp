import { useState } from 'react'
import { ChefHat } from 'lucide-react'
import { Button } from '../../shared/components'
import { ApiError, type AuthSession, loginRequest, registerRequest } from '../../shared/lib/api'

type LoginViewProps = {
  onSuccess: (session: AuthSession) => void
}

type Mode = 'login' | 'register'

export function LoginView({ onSuccess }: LoginViewProps) {
  const [mode, setMode] = useState<Mode>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const isRegisterMode = mode === 'register'

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-card__brand">
          <ChefHat aria-hidden="true" />
          <span>Gastronexo</span>
        </div>
        <form
          className="login-card__form"
          onSubmit={async (event) => {
            event.preventDefault()
            setLoading(true)
            setError('')

            try {
              const session = isRegisterMode
                ? await registerRequest(name, email, password)
                : await loginRequest(email, password)

              onSuccess(session)
            } catch (caughtError) {
              setError(caughtError instanceof ApiError ? caughtError.message : 'No se pudo conectar con la API local')
            } finally {
              setLoading(false)
            }
          }}
        >
          <div>
            <h1 id="login-title">{isRegisterMode ? 'Crear acceso local' : 'Ingresar a Ops Console'}</h1>
            <p>Usá la API local y guardá el JWT en esta pestaña durante el desarrollo.</p>
          </div>
          <div className="auth-switch" role="tablist" aria-label="Modo de autenticación">
            <button
              className={`auth-switch__button ${!isRegisterMode ? 'auth-switch__button--active' : ''}`}
              onClick={() => setMode('login')}
              type="button"
            >
              Ingresar
            </button>
            <button
              className={`auth-switch__button ${isRegisterMode ? 'auth-switch__button--active' : ''}`}
              onClick={() => setMode('register')}
              type="button"
            >
              Registrarme
            </button>
          </div>
          {isRegisterMode && (
            <label className="field">
              Nombre
              <input
                autoComplete="name"
                onChange={(event) => setName(event.target.value)}
                placeholder="Nombre y apellido"
                required
                value={name}
              />
            </label>
          )}
          <label className="field">
            Email
            <input
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="operacion@negocio.com"
              required
              type="email"
              value={email}
            />
          </label>
          <label className="field">
            Contraseña
            <input
              autoComplete={isRegisterMode ? 'new-password' : 'current-password'}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              required
              type="password"
              value={password}
            />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <Button disabled={loading} type="submit">
            {loading ? 'Procesando...' : isRegisterMode ? 'Crear acceso' : 'Ingresar'}
          </Button>
        </form>
      </section>
    </main>
  )
}

import { ChefHat } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../shared/components'
import { ApiError } from '../../shared/lib/auth-api'

type LoginViewProps = {
  onLogin: (credentials: { email: string; password: string }) => Promise<void>
}

export function LoginView({ onLogin }: LoginViewProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)
    setIsSubmitting(true)

    try {
      await onLogin({ email, password })
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setErrorMessage('Email o contraseña incorrectos.')
      } else {
        setErrorMessage('No se pudo iniciar sesión. Intentá nuevamente.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-card__brand">
          <ChefHat aria-hidden="true" />
          <span>Gastronexo</span>
        </div>
        <form className="login-card__form" onSubmit={handleSubmit}>
          <div>
            <h1 id="login-title">Ingresar a Ops Console</h1>
            <p>Accedé a la operación diaria de tu negocio.</p>
          </div>
          <label className="field">
            Email
            <input
              type="email"
              placeholder="operacion@negocio.com"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              disabled={isSubmitting}
            />
          </label>
          <label className="field">
            Contraseña
            <input
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              disabled={isSubmitting}
            />
          </label>
          {errorMessage ? (
            <p className="login-card__error" role="alert" aria-live="polite">
              {errorMessage}
            </p>
          ) : null}
          <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting ? 'Ingresando...' : 'Ingresar'}
          </Button>
        </form>
      </section>
    </main>
  )
}

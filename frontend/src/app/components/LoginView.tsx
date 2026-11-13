import { ChefHat } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button } from '../../shared/components'
import { ApiError, type AuthRegisterRequest } from '../../shared/lib/auth-api'

type LoginViewProps = {
  onLogin: (credentials: { email: string; password: string }) => Promise<void>
  onRegister: (input: AuthRegisterRequest) => Promise<void>
}

type Mode = 'login' | 'register'

// Las mismas reglas que valida la API (auth.routes.ts).
const EMAIL_PATTERN = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MIN_PASSWORD = 10

/** "Verdulería Don José" -> "verduleria-don-jose" */
export function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '')
}

type RegisterForm = AuthRegisterRequest
type RegisterErrors = Partial<Record<keyof RegisterForm, string>>

const emptyRegister: RegisterForm = { fullName: '', email: '', password: '', organizationName: '', organizationSlug: '' }

function validateRegister(form: RegisterForm): RegisterErrors {
  const errors: RegisterErrors = {}
  if (form.fullName.trim().length < 2) errors.fullName = 'Escribí tu nombre.'
  if (!EMAIL_PATTERN.test(form.email.trim())) errors.email = 'Escribí un email válido (sin tildes ni ñ antes de la @).'
  if (form.password.length < MIN_PASSWORD) errors.password = `La contraseña necesita al menos ${MIN_PASSWORD} caracteres.`
  if (form.organizationName.trim().length < 2) errors.organizationName = 'Escribí el nombre del negocio.'
  if (form.organizationSlug.length < 3 || !SLUG_PATTERN.test(form.organizationSlug)) {
    errors.organizationSlug = 'Usá al menos 3 letras o números, separados por guiones.'
  }
  return errors
}

export function LoginView({ onLogin, onRegister }: LoginViewProps) {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginErrors, setLoginErrors] = useState<{ email?: string; password?: string }>({})
  const [form, setForm] = useState<RegisterForm>(emptyRegister)
  const [slugEdited, setSlugEdited] = useState(false)
  const [registerErrors, setRegisterErrors] = useState<RegisterErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  function switchMode(next: Mode) {
    setMode(next)
    setErrorMessage(null)
    setLoginErrors({})
    setRegisterErrors({})
    if (next === 'register' && email && !form.email) {
      setForm((current) => ({ ...current, email }))
    }
  }

  function updateForm<K extends keyof RegisterForm>(key: K, value: RegisterForm[K]) {
    setForm((current) => {
      const next = { ...current, [key]: value }
      if (key === 'organizationName' && !slugEdited) next.organizationSlug = slugify(String(value))
      return next
    })
    setRegisterErrors((current) => ({ ...current, [key]: undefined }))
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const errors: { email?: string; password?: string } = {}
    if (!email.trim()) errors.email = 'Escribí tu email.'
    if (!password) errors.password = 'Escribí tu contraseña.'
    setLoginErrors(errors)
    setErrorMessage(null)
    if (Object.keys(errors).length > 0) return

    setIsSubmitting(true)
    try {
      await onLogin({ email, password })
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setErrorMessage('Email o contraseña incorrectos.')
      } else if (error instanceof ApiError && (error.status === 429 || error.status === 403)) {
        setErrorMessage(error.message)
      } else {
        setErrorMessage('No se pudo iniciar sesión. Intentá nuevamente.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized: RegisterForm = {
      fullName: form.fullName.trim(),
      email: form.email.trim().toLowerCase(),
      password: form.password,
      organizationName: form.organizationName.trim(),
      organizationSlug: form.organizationSlug.trim(),
    }
    const errors = validateRegister(normalized)
    setRegisterErrors(errors)
    setErrorMessage(null)
    if (Object.keys(errors).length > 0) return

    setIsSubmitting(true)
    try {
      await onRegister(normalized)
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // La API distingue email y slug ocupados por el mensaje.
        if (/identificador/i.test(error.message)) {
          setRegisterErrors({ organizationSlug: 'Ese link ya lo usa otro negocio. Probá con otro.' })
        } else {
          setRegisterErrors({ email: 'Ya hay una cuenta con ese email. Ingresá con tu contraseña.' })
        }
      } else if (error instanceof ApiError && (error.status === 429 || error.status === 400)) {
        setErrorMessage(error.status === 400 ? 'Revisá los datos e intentá de nuevo.' : error.message)
      } else {
        setErrorMessage('No se pudo crear la cuenta. Intentá nuevamente.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const fieldError = (id: string, message?: string) =>
    message ? (
      <span className="field__error" id={id}>
        {message}
      </span>
    ) : null

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-card__brand">
          <ChefHat aria-hidden="true" />
          <span>Gastronexo</span>
        </div>

        {mode === 'login' ? (
          <form className="login-card__form" onSubmit={handleLogin} noValidate>
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
                aria-invalid={Boolean(loginErrors.email)}
                aria-describedby={loginErrors.email ? 'login-email-error' : undefined}
                disabled={isSubmitting}
              />
              {fieldError('login-email-error', loginErrors.email)}
            </label>
            <label className="field">
              Contraseña
              <input
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={Boolean(loginErrors.password)}
                aria-describedby={loginErrors.password ? 'login-password-error' : undefined}
                disabled={isSubmitting}
              />
              {fieldError('login-password-error', loginErrors.password)}
            </label>
            {errorMessage ? (
              <p className="login-card__error" role="alert" aria-live="polite">
                {errorMessage}
              </p>
            ) : null}
            <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
              {isSubmitting ? 'Ingresando...' : 'Ingresar'}
            </Button>
            <p className="login-card__switch">
              ¿Todavía no tenés cuenta?{' '}
              <button type="button" className="link-button" onClick={() => switchMode('register')}>
                Crear cuenta para tu negocio
              </button>
            </p>
          </form>
        ) : (
          <form className="login-card__form" onSubmit={handleRegister} noValidate>
            <div>
              <h1 id="login-title">Crear cuenta</h1>
              <p>Registrá tu negocio. Vas a ser el dueño de la cuenta y después podés sumar a tu equipo.</p>
            </div>
            <label className="field">
              Tu nombre
              <input
                autoComplete="name"
                value={form.fullName}
                onChange={(event) => updateForm('fullName', event.target.value)}
                aria-invalid={Boolean(registerErrors.fullName)}
                aria-describedby={registerErrors.fullName ? 'register-name-error' : undefined}
                disabled={isSubmitting}
                maxLength={120}
              />
              {fieldError('register-name-error', registerErrors.fullName)}
            </label>
            <label className="field">
              Email
              <input
                type="email"
                autoComplete="email"
                placeholder="operacion@negocio.com"
                value={form.email}
                onChange={(event) => updateForm('email', event.target.value)}
                aria-invalid={Boolean(registerErrors.email)}
                aria-describedby={registerErrors.email ? 'register-email-error' : undefined}
                disabled={isSubmitting}
                maxLength={320}
              />
              {fieldError('register-email-error', registerErrors.email)}
            </label>
            <label className="field">
              Contraseña
              <input
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(event) => updateForm('password', event.target.value)}
                aria-invalid={Boolean(registerErrors.password)}
                aria-describedby={registerErrors.password ? 'register-password-error' : 'register-password-hint'}
                disabled={isSubmitting}
                maxLength={128}
              />
              {registerErrors.password ? (
                fieldError('register-password-error', registerErrors.password)
              ) : (
                <span className="field__hint" id="register-password-hint">
                  Mínimo {MIN_PASSWORD} caracteres.
                </span>
              )}
            </label>
            <label className="field">
              Nombre del negocio
              <input
                autoComplete="organization"
                value={form.organizationName}
                onChange={(event) => updateForm('organizationName', event.target.value)}
                aria-invalid={Boolean(registerErrors.organizationName)}
                aria-describedby={registerErrors.organizationName ? 'register-org-error' : undefined}
                disabled={isSubmitting}
                maxLength={120}
              />
              {fieldError('register-org-error', registerErrors.organizationName)}
            </label>
            <label className="field">
              Link de tu tienda
              <span className="field__prefixed">
                <span aria-hidden="true">/tienda/</span>
                <input
                  value={form.organizationSlug}
                  onChange={(event) => {
                    setSlugEdited(true)
                    updateForm('organizationSlug', event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 63))
                  }}
                  aria-invalid={Boolean(registerErrors.organizationSlug)}
                  aria-describedby={registerErrors.organizationSlug ? 'register-slug-error' : 'register-slug-hint'}
                  disabled={isSubmitting}
                  placeholder="mi-negocio"
                />
              </span>
              {registerErrors.organizationSlug ? (
                fieldError('register-slug-error', registerErrors.organizationSlug)
              ) : (
                <span className="field__hint" id="register-slug-hint">
                  Es el link público de tu tienda online. Solo minúsculas, números y guiones.
                </span>
              )}
            </label>
            {errorMessage ? (
              <p className="login-card__error" role="alert" aria-live="polite">
                {errorMessage}
              </p>
            ) : null}
            <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
              {isSubmitting ? 'Creando cuenta...' : 'Crear cuenta'}
            </Button>
            <p className="login-card__switch">
              ¿Ya tenés cuenta?{' '}
              <button type="button" className="link-button" onClick={() => switchMode('login')}>
                Ingresar
              </button>
            </p>
          </form>
        )}
      </section>
    </main>
  )
}

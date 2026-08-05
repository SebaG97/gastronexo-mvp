import { ChefHat } from 'lucide-react'
import { Button } from '../../shared/components'

type LoginViewProps = {
  onLogin: () => void
}

export function LoginView({ onLogin }: LoginViewProps) {
  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-card__brand">
          <ChefHat aria-hidden="true" />
          <span>Gastronexo</span>
        </div>
        <form
          className="login-card__form"
          onSubmit={(event) => {
            event.preventDefault()
            onLogin()
          }}
        >
          <div>
            <h1 id="login-title">Ingresar a Ops Console</h1>
            <p>Accedé a la operación diaria de tu negocio.</p>
          </div>
          <label className="field">
            Email
            <input type="email" placeholder="operacion@negocio.com" required />
          </label>
          <label className="field">
            Contraseña
            <input type="password" placeholder="••••••••" required />
          </label>
          <Button type="submit">Ingresar</Button>
        </form>
      </section>
    </main>
  )
}

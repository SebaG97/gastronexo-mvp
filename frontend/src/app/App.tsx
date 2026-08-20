import { useEffect, useMemo, useState } from 'react'
import { DashboardView } from '../features/dashboard/DashboardView'
import { ProductsView } from '../features/products/ProductsView'
import { PurchasesView } from '../features/purchases/PurchasesView'
import { ProductionView } from '../features/production/ProductionView'
import { SalesView } from '../features/sales/SalesView'
import { StockView } from '../features/stock/StockView'
import { WasteView } from '../features/waste/WasteView'
import {
  clearStoredToken,
  getCurrentSession,
  getStoredToken,
  login,
  type AuthSession,
} from '../shared/lib/auth-api'
import { LoginView } from './components/LoginView'
import { SystemShell, type AppSection } from './components/SystemShell'

const sectionMetadata: Record<AppSection, { title: string; action: string }> = {
  dashboard: { title: 'Dashboard', action: 'Ver reporte' },
  products: { title: 'Productos', action: 'Nuevo producto' },
  purchases: { title: 'Compras', action: 'Registrar compra' },
  production: { title: 'Producción', action: 'Nueva producción' },
  waste: { title: 'Mermas', action: 'Registrar merma' },
  sales: { title: 'Ventas', action: 'Registrar venta' },
  stock: { title: 'Stock', action: 'Ajustar stock' },
}

export function App() {
  const [authStatus, setAuthStatus] = useState<'checking' | 'authenticated' | 'unauthenticated'>(
    'checking',
  )
  const [session, setSession] = useState<AuthSession | null>(null)
  const [activeSection, setActiveSection] = useState<AppSection>('dashboard')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const view = useMemo(() => {
    const views: Record<AppSection, JSX.Element> = {
      dashboard: <DashboardView />,
      products: <ProductsView />,
      purchases: <PurchasesView />,
      production: <ProductionView />,
      waste: <WasteView />,
      sales: <SalesView />,
      stock: <StockView />,
    }

    return views[activeSection]
  }, [activeSection])

  useEffect(() => {
    const token = getStoredToken()

    if (!token) {
      setAuthStatus('unauthenticated')
      return
    }

    let cancelled = false

    const recoverSession = async () => {
      try {
        const response = await getCurrentSession(token)

        if (cancelled) {
          return
        }

        setSession({
          token,
          user: response.user,
          organization: response.organization,
        })
        setAuthStatus('authenticated')
      } catch {
        if (cancelled) {
          return
        }

        clearStoredToken()
        setSession(null)
        setAuthStatus('unauthenticated')
      }
    }

    void recoverSession()

    return () => {
      cancelled = true
    }
  }, [])

  async function handleLogin(credentials: { email: string; password: string }) {
    const response = await login(credentials)

    setSession({
      token: response.token,
      user: response.user,
      organization: response.organization,
    })
    setAuthStatus('authenticated')
  }

  function handleLogout() {
    clearStoredToken()
    setSession(null)
    setAuthStatus('unauthenticated')
  }

  if (authStatus === 'checking') {
    return (
      <main className="login-page" aria-busy="true" aria-live="polite">
        <section className="login-card">
          <p>Validando sesión...</p>
        </section>
      </main>
    )
  }

  if (authStatus !== 'authenticated' || !session) {
    return <LoginView onLogin={handleLogin} />
  }

  const metadata = sectionMetadata[activeSection]

  return (
    <SystemShell
      activeSection={activeSection}
      onLogout={handleLogout}
      onNavigate={setActiveSection}
      onPrimaryAction={() => window.alert(`${metadata.action}: flujo pendiente de implementación.`)}
      onThemeToggle={() => setTheme((currentTheme) => (currentTheme === 'light' ? 'dark' : 'light'))}
      primaryAction={metadata.action}
      theme={theme}
      title={metadata.title}
    >
      {view}
    </SystemShell>
  )
}

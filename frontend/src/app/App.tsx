import { useEffect, useMemo, useState } from 'react'
import { DashboardView } from '../features/dashboard/DashboardView'
import { ProductsView } from '../features/products/ProductsView'
import { PurchasesView } from '../features/purchases/PurchasesView'
import { ProductionView } from '../features/production/ProductionView'
import { SalesView } from '../features/sales/SalesView'
import { StockView } from '../features/stock/StockView'
import { WasteView } from '../features/waste/WasteView'
import { LoginView } from './components/LoginView'
import { SystemShell, type AppSection } from './components/SystemShell'
import { type AuthSession, ApiError, getCurrentUser } from '../shared/lib/api'
import { clearSession, loadSession, saveSession } from '../shared/lib/session'

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
  const [session, setSession] = useState<AuthSession | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [activeSection, setActiveSection] = useState<AppSection>('dashboard')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    const storedSession = loadSession()

    if (!storedSession) {
      setAuthReady(true)
      return
    }

    void getCurrentUser(storedSession.token)
      .then((user) => {
        const nextSession = {
          token: storedSession.token,
          user,
        }

        setSession(nextSession)
        saveSession(nextSession)
      })
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) {
          clearSession()
          setSession(null)
          return
        }

        clearSession()
        setSession(null)
      })
      .finally(() => {
        setAuthReady(true)
      })
  }, [])

  const view = useMemo(() => {
    const views: Record<Exclude<AppSection, 'products'>, JSX.Element> = {
      dashboard: <DashboardView />,
      purchases: <PurchasesView />,
      production: <ProductionView />,
      waste: <WasteView />,
      sales: <SalesView />,
      stock: <StockView />,
    }

    if (activeSection === 'products') {
      return <></>
    }

    return views[activeSection]
  }, [activeSection])

  if (!authReady) {
    return (
      <main className="login-page">
        <section className="login-card">
          <p>Cargando sesión local...</p>
        </section>
      </main>
    )
  }

  if (!session) {
    return (
      <LoginView
        onSuccess={(nextSession) => {
          saveSession(nextSession)
          setSession(nextSession)
        }}
      />
    )
  }

  const metadata = sectionMetadata[activeSection]
  const handleAuthExpired = () => {
    clearSession()
    setSession(null)
  }

  return (
    <SystemShell
      activeSection={activeSection}
      onLogout={handleAuthExpired}
      onNavigate={setActiveSection}
      onPrimaryAction={() => window.alert(`${metadata.action}: flujo pendiente de implementación.`)}
      onThemeToggle={() => setTheme((currentTheme) => (currentTheme === 'light' ? 'dark' : 'light'))}
      primaryAction={metadata.action}
      theme={theme}
      title={metadata.title}
    >
      {activeSection === 'products' ? (
        <ProductsView onAuthExpired={handleAuthExpired} token={session.token} />
      ) : (
        view
      )}
    </SystemShell>
  )
}

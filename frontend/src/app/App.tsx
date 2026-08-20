import { useEffect, useMemo, useState } from 'react'
import { DashboardView } from '../features/dashboard/DashboardView'
import { MembersView } from '../features/organization/MembersView'
import { ProductsView } from '../features/products/ProductsView'
import { PurchasesView } from '../features/purchases/PurchasesView'
import { ProductionView } from '../features/production/ProductionView'
import { SalesView } from '../features/sales/SalesView'
import { StockView } from '../features/stock/StockView'
import { WasteView } from '../features/waste/WasteView'
import {
  clearStoredToken,
  getUserOrganizations,
  getCurrentSession,
  getStoredToken,
  login,
  saveStoredToken,
  switchOrganization,
  type AuthSession,
  type SessionOrganization,
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
  members: { title: 'Miembros', action: 'Gestionar accesos' },
}

export function App() {
  const [authStatus, setAuthStatus] = useState<'checking' | 'authenticated' | 'unauthenticated'>(
    'checking',
  )
  const [session, setSession] = useState<AuthSession | null>(null)
  const [organizations, setOrganizations] = useState<SessionOrganization[]>([])
  const [organizationSwitchError, setOrganizationSwitchError] = useState<string | null>(null)
  const [isSwitchingOrganization, setIsSwitchingOrganization] = useState(false)
  const [activeSection, setActiveSection] = useState<AppSection>('dashboard')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  const canManageMembers =
    session?.organization.role === 'owner' || session?.organization.role === 'admin'

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
      members: session ? <MembersView token={session.token} /> : <DashboardView />,
    }

    return views[activeSection]
  }, [activeSection, session])

  useEffect(() => {
    if (!canManageMembers && activeSection === 'members') {
      setActiveSection('dashboard')
    }
  }, [activeSection, canManageMembers])

  useEffect(() => {
    const token = getStoredToken()

    if (!token) {
      setAuthStatus('unauthenticated')
      return
    }

    let cancelled = false

    const recoverSession = async () => {
      try {
        const [sessionResponse, organizationsResponse] = await Promise.all([
          getCurrentSession(token),
          getUserOrganizations(token),
        ])

        if (cancelled) {
          return
        }

        setSession({
          token,
          user: sessionResponse.user,
          organization: sessionResponse.organization,
        })
        setOrganizations(organizationsResponse.organizations)
        setAuthStatus('authenticated')
      } catch {
        if (cancelled) {
          return
        }

        clearStoredToken()
        setSession(null)
        setOrganizations([])
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
    setOrganizations(response.organizations)
    setOrganizationSwitchError(null)
    setAuthStatus('authenticated')
  }

  async function handleSwitchOrganization(organizationId: string) {
    if (!session || organizationId === session.organization.id) {
      return
    }

    setOrganizationSwitchError(null)
    setIsSwitchingOrganization(true)

    try {
      const switchResponse = await switchOrganization({ organizationId }, session.token)
      const [sessionResponse, organizationsResponse] = await Promise.all([
        getCurrentSession(switchResponse.token),
        getUserOrganizations(switchResponse.token),
      ])

      saveStoredToken(switchResponse.token)
      setSession({
        token: switchResponse.token,
        user: sessionResponse.user,
        organization: sessionResponse.organization,
      })
      setOrganizations(organizationsResponse.organizations)
    } catch {
      setOrganizationSwitchError('No se pudo cambiar la organización activa. Intentá nuevamente.')
    } finally {
      setIsSwitchingOrganization(false)
    }
  }

  function handleLogout() {
    clearStoredToken()
    setSession(null)
    setOrganizations([])
    setOrganizationSwitchError(null)
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
  const isPrimaryActionDisabled =
    activeSection === 'products' && !session.organization.capabilities.canWriteProducts

  return (
    <SystemShell
      activeSection={activeSection}
      activeOrganizationId={session.organization.id}
      activeOrganizationName={session.organization.name}
      canManageMembers={canManageMembers}
      isPrimaryActionDisabled={isPrimaryActionDisabled}
      isSwitchingOrganization={isSwitchingOrganization}
      onLogout={handleLogout}
      onNavigate={setActiveSection}
      onPrimaryAction={() => window.alert(`${metadata.action}: flujo pendiente de implementación.`)}
      onSwitchOrganization={(organizationId) => {
        void handleSwitchOrganization(organizationId)
      }}
      onThemeToggle={() => setTheme((currentTheme) => (currentTheme === 'light' ? 'dark' : 'light'))}
      organizationSwitchError={organizationSwitchError}
      organizations={organizations}
      primaryAction={metadata.action}
      theme={theme}
      title={metadata.title}
    >
      {view}
    </SystemShell>
  )
}

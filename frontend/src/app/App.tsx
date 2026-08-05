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
  const [isAuthenticated, setIsAuthenticated] = useState(false)
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

  if (!isAuthenticated) {
    return <LoginView onLogin={() => setIsAuthenticated(true)} />
  }

  const metadata = sectionMetadata[activeSection]

  return (
    <SystemShell
      activeSection={activeSection}
      onLogout={() => setIsAuthenticated(false)}
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

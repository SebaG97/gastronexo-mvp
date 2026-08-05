import type { ReactNode } from 'react'
import {
  ChefHat,
  LayoutDashboard,
  LogOut,
  Moon,
  Package,
  ReceiptText,
  ShoppingCart,
  Sun,
  Truck,
  UtensilsCrossed,
  Warehouse,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '../../shared/components'

export type AppSection =
  | 'dashboard'
  | 'products'
  | 'purchases'
  | 'production'
  | 'waste'
  | 'sales'
  | 'stock'

type NavigationItem = {
  id: AppSection
  label: string
  icon: LucideIcon
}

const navigation: NavigationItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'products', label: 'Productos', icon: Package },
  { id: 'purchases', label: 'Compras', icon: Truck },
  { id: 'production', label: 'Producción', icon: UtensilsCrossed },
  { id: 'waste', label: 'Mermas', icon: ReceiptText },
  { id: 'sales', label: 'Ventas', icon: ShoppingCart },
  { id: 'stock', label: 'Stock', icon: Warehouse },
]

type SystemShellProps = {
  activeSection: AppSection
  title: string
  primaryAction: string
  children: ReactNode
  onNavigate: (section: AppSection) => void
  onLogout: () => void
  onPrimaryAction: () => void
  theme: 'light' | 'dark'
  onThemeToggle: () => void
}

export function SystemShell({
  activeSection,
  title,
  primaryAction,
  children,
  onNavigate,
  onLogout,
  onPrimaryAction,
  theme,
  onThemeToggle,
}: SystemShellProps) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <ChefHat className="brand__mark" aria-hidden="true" />
          <span>Gastronexo</span>
        </div>
        <nav className="nav" aria-label="Navegación principal">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              className={`nav__item ${activeSection === id ? 'nav__item--active' : ''}`}
              key={id}
              onClick={() => onNavigate(id)}
              type="button"
            >
              <Icon size={18} aria-hidden="true" />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar__footer">Ops Console · MVP</div>
      </aside>
      <div className="main-content">
        <header className="topbar">
          <h1 className="topbar__title">{title}</h1>
          <div className="topbar__actions">
            <button
              aria-label={theme === 'light' ? 'Activar modo oscuro' : 'Activar modo claro'}
              className="icon-button"
              onClick={onThemeToggle}
              type="button"
            >
              {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
            </button>
            <button aria-label="Cerrar sesión" className="icon-button" onClick={onLogout} type="button">
              <LogOut size={17} />
            </button>
            <Button onClick={onPrimaryAction}>{primaryAction}</Button>
          </div>
        </header>
        {children}
      </div>
    </div>
  )
}

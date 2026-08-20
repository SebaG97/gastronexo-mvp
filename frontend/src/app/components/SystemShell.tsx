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
  Users,
  Warehouse,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '../../shared/components'
import type { SessionOrganization } from '../../shared/lib/auth-api'

export type AppSection =
  | 'dashboard'
  | 'products'
  | 'purchases'
  | 'production'
  | 'waste'
  | 'sales'
  | 'stock'
  | 'members'

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
  { id: 'members', label: 'Miembros', icon: Users },
]

type SystemShellProps = {
  activeSection: AppSection
  title: string
  primaryAction: string
  isPrimaryActionDisabled?: boolean
  primaryActionDisabledReason?: string
  children: ReactNode
  onNavigate: (section: AppSection) => void
  onLogout: () => void
  onPrimaryAction: () => void
  theme: 'light' | 'dark'
  onThemeToggle: () => void
  activeOrganizationId: string
  activeOrganizationName: string
  organizations: SessionOrganization[]
  canManageMembers: boolean
  isSwitchingOrganization: boolean
  organizationSwitchError: string | null
  onSwitchOrganization: (organizationId: string) => void
}

export function SystemShell({
  activeSection,
  title,
  primaryAction,
  isPrimaryActionDisabled = false,
  primaryActionDisabledReason,
  children,
  onNavigate,
  onLogout,
  onPrimaryAction,
  theme,
  onThemeToggle,
  activeOrganizationId,
  activeOrganizationName,
  organizations,
  canManageMembers,
  isSwitchingOrganization,
  organizationSwitchError,
  onSwitchOrganization,
}: SystemShellProps) {
  const visibleNavigation = canManageMembers
    ? navigation
    : navigation.filter((item) => item.id !== 'members')

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <ChefHat className="brand__mark" aria-hidden="true" />
          <span>Gastronexo</span>
        </div>
        <nav className="nav" aria-label="Navegación principal">
          {visibleNavigation.map(({ id, label, icon: Icon }) => (
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
          <div className="topbar__identity">
            <h1 className="topbar__title">{title}</h1>
            <div className="organization-switcher">
              <span className="organization-switcher__label">Organización activa</span>
              <select
                className="select-input"
                value={activeOrganizationId}
                onChange={(event) => onSwitchOrganization(event.target.value)}
                disabled={isSwitchingOrganization}
              >
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
              <span className="organization-switcher__name">{activeOrganizationName}</span>
            </div>
          </div>
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
            <Button
              disabled={isPrimaryActionDisabled}
              onClick={onPrimaryAction}
              title={isPrimaryActionDisabled ? primaryActionDisabledReason : undefined}
            >
              {primaryAction}
            </Button>
          </div>
        </header>
        {organizationSwitchError ? (
          <p className="topbar__feedback topbar__feedback--error" role="alert" aria-live="polite">
            {organizationSwitchError}
          </p>
        ) : null}
        {isSwitchingOrganization ? (
          <p className="topbar__feedback" role="status" aria-live="polite">
            Cambiando organización...
          </p>
        ) : null}
        {children}
      </div>
    </div>
  )
}

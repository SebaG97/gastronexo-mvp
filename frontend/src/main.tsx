import { StrictMode, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'

// La tienda publica (/tienda/:slug) y la consola administrativa se cargan por separado:
// cada una trae solo su JS y sus estilos.
async function boot() {
  let Root: ComponentType

  if (window.location.pathname.startsWith('/tienda/')) {
    Root = (await import('./storefront/StorefrontApp')).StorefrontApp
  } else {
    await Promise.all([
      import('./shared/styles/tokens.css'),
      import('./shared/styles/index.css'),
      import('./shared/styles/app.css'),
    ])
    Root = (await import('./app/App')).App
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  )
}

void boot()

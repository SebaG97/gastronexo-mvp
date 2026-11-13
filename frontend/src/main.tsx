import { StrictMode, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { installSpanishValidation } from './shared/lib/spanish-validation'

// La tienda publica (/tienda/:slug) y la consola administrativa se cargan por separado:
// cada una trae solo su JS y sus estilos.
async function boot() {
  let Root: ComponentType
  // Mision 8.4 (H8): avisos de validacion del navegador en espanol, en la consola y la tienda.
  installSpanishValidation()

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

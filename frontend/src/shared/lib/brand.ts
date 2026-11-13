// Mision 8.8: color de la cabecera de la tienda.

export const DEFAULT_BRAND_COLOR = '#23412f'
// Texto claro de la cabecera (--sf-board-ink). La API exige contraste 4.5:1 contra este color.
export const HEADER_INK = '#eef3e6'

export const BRAND_COLOR_PRESETS = [
  { value: '#23412f', label: 'Verde huerta' },
  { value: '#1f2421', label: 'Carbón' },
  { value: '#8a3b12', label: 'Terracota' },
  { value: '#4a2545', label: 'Berenjena' },
]

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = parseInt(hex.slice(index, index + 2), 16) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastWithHeaderInk(hex: string) {
  const [light, dark] = [luminance(hex), luminance(HEADER_INK)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

export function isReadableBrandColor(hex: string) {
  return /^#[0-9a-f]{6}$/i.test(hex) && contrastWithHeaderInk(hex.toLowerCase()) >= 4.5
}

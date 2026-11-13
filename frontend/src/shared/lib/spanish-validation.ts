// Mision 8.4 (H8): los avisos nativos de validacion (required, type=email, min, maxLength...)
// salen en el idioma del navegador ("Please fill out this field."). Esto los reemplaza por
// mensajes en espanol en toda la app, sin tocar cada formulario: en el evento `invalid` se
// fija un mensaje propio y al editar el campo se limpia.

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

function isFormControl(target: EventTarget | null): target is FormControl {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement
}

export function spanishValidationMessage(control: FormControl): string {
  const validity = control.validity
  if (validity.valueMissing) {
    if (control instanceof HTMLSelectElement) return 'Elegí una opción.'
    if (control instanceof HTMLInputElement && control.type === 'checkbox') return 'Marcá esta opción para continuar.'
    if (control instanceof HTMLInputElement && control.type === 'file') return 'Elegí un archivo.'
    return 'Completá este campo.'
  }
  if (validity.typeMismatch) {
    if (control instanceof HTMLInputElement && control.type === 'email') return 'Escribí un email válido, por ejemplo nombre@negocio.com.'
    if (control instanceof HTMLInputElement && control.type === 'url') return 'Escribí una dirección web válida (https://...).'
    return 'El formato no es válido.'
  }
  if (validity.badInput) return 'Escribí un número válido.'
  if (validity.tooShort && 'minLength' in control) return `Usá al menos ${control.minLength} caracteres.`
  if (validity.tooLong && 'maxLength' in control) return `Usá como máximo ${control.maxLength} caracteres.`
  if (validity.rangeUnderflow && control instanceof HTMLInputElement) {
    return control.type === 'date' ? `La fecha no puede ser anterior a ${control.min}.` : `El valor mínimo es ${control.min}.`
  }
  if (validity.rangeOverflow && control instanceof HTMLInputElement) {
    return control.type === 'date' ? `La fecha no puede ser posterior a ${control.max}.` : `El valor máximo es ${control.max}.`
  }
  if (validity.stepMismatch && control instanceof HTMLInputElement) {
    return control.step && Number(control.step) >= 1 ? 'Usá un número entero.' : 'Usá un valor válido para este campo.'
  }
  if (validity.patternMismatch) return control.title || 'El formato no es válido.'
  return ''
}

let installed = false

export function installSpanishValidation() {
  if (installed || typeof document === 'undefined') return
  installed = true

  document.addEventListener(
    'invalid',
    (event) => {
      const control = event.target
      if (!isFormControl(control)) return
      // Un mensaje propio ya puesto por la app (setCustomValidity) se respeta.
      if (control.validity.customError && control.dataset.spanishValidation !== 'auto') return
      control.setCustomValidity('')
      const message = spanishValidationMessage(control)
      if (message) {
        control.dataset.spanishValidation = 'auto'
        control.setCustomValidity(message)
      }
    },
    true,
  )

  const clear = (event: Event) => {
    const control = event.target
    if (isFormControl(control) && control.dataset.spanishValidation === 'auto') {
      control.setCustomValidity('')
      delete control.dataset.spanishValidation
    }
  }
  document.addEventListener('input', clear, true)
  document.addEventListener('change', clear, true)
}

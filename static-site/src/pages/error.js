import { setTitle } from '../ui.js'
import errorTemplate from './error.html'

export function renderErrorPage({ app, error }) {
  console.error(error)
  setTitle('Error')
  app.innerHTML = errorTemplate
  app.querySelector('[data-error-message]').textContent = error.message || error
}

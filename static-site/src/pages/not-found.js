import { setTitle } from '../ui.js'
import notFoundTemplate from './not-found.html'

export function renderNotFoundPage({ app }) {
  setTitle('Not Found')
  app.innerHTML = notFoundTemplate
  app.querySelector('[data-not-found-path]').textContent = window.location.pathname
}

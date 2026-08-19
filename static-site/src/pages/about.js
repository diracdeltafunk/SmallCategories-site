import { setTitle } from '../ui.js'
import aboutTemplate from './about.html'

export function renderAboutPage({ app }) {
  setTitle('About')
  app.innerHTML = aboutTemplate
}

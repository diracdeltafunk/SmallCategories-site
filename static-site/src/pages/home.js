import { getManifest } from '../data.js'
import { numberFormat, setTitle } from '../ui.js'
import homeTemplate from './home.html'

export async function renderHomePage({ app, isCurrent }) {
  const manifest = await getManifest()
  if (!isCurrent()) return

  setTitle('')
  app.innerHTML = homeTemplate
  app.querySelector('[data-home-category-count]').textContent = numberFormat.format(manifest.categoryCount)
  if (!manifest.factsAvailable) {
    app.querySelector('[data-home-facts-notice]').innerHTML = '<div class="notification is-info is-light">Proposition data is not included in this build.</div>'
  }
}

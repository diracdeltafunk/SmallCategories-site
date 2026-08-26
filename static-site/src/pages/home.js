import { getManifest } from '../data.js'
import { numberFormat, setTitle } from '../ui.js'
import homeTemplate from './home.html'

export async function renderHomePage({ app, isCurrent }) {
  const manifest = await getManifest()
  if (!isCurrent()) return

  setTitle('')
  app.innerHTML = homeTemplate
  app.querySelector('[data-home-category-count]').textContent = numberFormat.format(manifest.categoryCount)
}

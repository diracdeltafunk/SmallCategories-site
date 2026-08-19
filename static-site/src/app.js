import { categoryHref, getManifest, ordinalToCategory } from './data.js'
import { renderAboutPage } from './pages/about.js'
import { renderCategoriesPage } from './pages/categories.js'
import { renderCategoryPage } from './pages/category.js'
import { renderEnumerationPage } from './pages/enumeration.js'
import { renderErrorPage } from './pages/error.js'
import { renderHomePage } from './pages/home.js'
import { renderNotFoundPage } from './pages/not-found.js'
import { renderPropositionPage } from './pages/proposition.js'
import { renderPropositionsPage } from './pages/propositions.js'
import { renderQueryPage } from './pages/query.js'
import { renderSmallCatPage } from './pages/smolcats.js'
import { renderStatsPage } from './pages/stats.js'

const app = document.querySelector('#app')
let routeGeneration = 0
let visualizationCleanup = () => {}

function setCurrentNavigation(path) {
  const firstSegment = path.split('/').filter(Boolean)[0] || ''
  for (const link of document.querySelectorAll('.nav-links a')) {
    const segment = new URL(link.href).pathname.split('/').filter(Boolean)[0] || ''
    if (segment === firstSegment && firstSegment !== 'random') link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  }
}

function showError(error) {
  renderErrorPage({ app, error })
}

function navigate(path, { replace = false } = {}) {
  if (replace) window.history.replaceState({}, '', path)
  else window.history.pushState({}, '', path)
  renderRoute()
}

async function renderCategoryAt(morphisms, objects, index, generation) {
  const isCurrent = () => generation === routeGeneration
  const result = await renderCategoryPage({
    app,
    morphisms,
    objects,
    index,
    isCurrent,
  })
  if (!isCurrent()) return
  if (!result.found) {
    renderNotFoundPage({ app })
    return
  }
  visualizationCleanup = result.cleanup
}

async function renderRandom(generation) {
  const manifest = await getManifest()
  if (generation !== routeGeneration) return
  const ordinal = Math.floor(Math.random() * manifest.categoryCount)
  const category = ordinalToCategory(manifest, ordinal)
  if (!category) throw new Error('Could not choose a random category')
  const path = categoryHref(category.morphisms, category.objects, category.index)
  window.history.replaceState({}, '', path)
  await renderCategoryAt(category.morphisms, category.objects, category.index, generation)
}

async function renderRoute() {
  visualizationCleanup()
  visualizationCleanup = () => {}
  const generation = ++routeGeneration
  const isCurrent = () => generation === routeGeneration
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  const pageContext = { app, isCurrent, onError: showError }

  setCurrentNavigation(path)
  document.querySelector('#nav-links').classList.remove('is-active')
  document.querySelector('.nav-toggle').classList.remove('is-active')
  document.querySelector('.nav-toggle').setAttribute('aria-expanded', 'false')
  app.innerHTML = '<section class="section container"><p class="loading"><span class="icon"><i class="fa-solid fa-ellipsis fa-fade" aria-hidden="true"></i></span> Loading…</p></section>'
  window.scrollTo({ top: 0, behavior: 'instant' })

  try {
    if (path === '/') await renderHomePage(pageContext)
    else if (path === '/cats') await renderCategoriesPage(pageContext)
    else if (path === '/props') await renderPropositionsPage(pageContext)
    else if (path === '/query' || path === '/query_mobile') await renderQueryPage(pageContext)
    else if (path === '/stats') await renderStatsPage(pageContext)
    else if (path === '/enumeration') await renderEnumerationPage(pageContext)
    else if (path === '/about') renderAboutPage(pageContext)
    else if (path === '/smolcats') await renderSmallCatPage(pageContext)
    else if (path === '/random') await renderRandom(generation)
    else {
      const categoryMatch = /^\/category\/(\d+)\/(\d+)\/(\d+)$/.exec(path)
      const propositionMatch = /^\/proposition\/([^/]+)$/.exec(path)
      if (categoryMatch) {
        await renderCategoryAt(
          Number(categoryMatch[1]),
          Number(categoryMatch[2]),
          Number(categoryMatch[3]),
          generation,
        )
      } else if (propositionMatch) {
        const found = await renderPropositionPage({
          ...pageContext,
          name: decodeURIComponent(propositionMatch[1]),
        })
        if (isCurrent() && !found) renderNotFoundPage({ app })
      } else {
        renderNotFoundPage({ app })
      }
    }
    if (isCurrent()) app.focus({ preventScroll: true })
  } catch (error) {
    if (isCurrent()) showError(error)
  }
}

document.addEventListener('click', event => {
  const link = event.target.closest('a[data-link]')
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const url = new URL(link.href)
  if (url.origin !== window.location.origin) return
  event.preventDefault()
  navigate(url.pathname + url.search + url.hash)
})

document.querySelector('.nav-toggle').addEventListener('click', event => {
  const links = document.querySelector('#nav-links')
  const open = links.classList.toggle('is-active')
  event.currentTarget.classList.toggle('is-active', open)
  event.currentTarget.setAttribute('aria-expanded', String(open))
})

window.addEventListener('popstate', renderRoute)
renderRoute()

import { escapeHtml, setTitle } from '../ui.js'
import smolcatsTemplate from './smolcats.html'

const CAT_API_URL = 'https://api.thecatapi.com/v1/images/search?limit=1'

export async function renderSmallCatPage({ app, isCurrent }) {
  setTitle('Small Cat')
  app.innerHTML = smolcatsTemplate

  try {
    const response = await fetch(CAT_API_URL, { headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`The Cat API returned ${response.status}`)
    const cats = await response.json()
    const imageUrl = new URL(cats?.[0]?.url)
    if (imageUrl.protocol !== 'https:') throw new Error('The Cat API returned an invalid image URL')
    if (!isCurrent()) return

    app.querySelector('#smolcat-content').innerHTML = `
      <img width="100" src="${escapeHtml(imageUrl.toString())}" alt="A small cat" referrerpolicy="no-referrer">
      <p class="help">Small cats provided by <a href="https://thecatapi.com">The Cat API</a>.</p>`
  } catch (error) {
    if (!isCurrent()) return
    console.error(error)
    app.querySelector('#smolcat-content').innerHTML = '<p>Sorry, couldn\'t fetch a cat 😿. Maybe the API usage limit has been exceeded?</p>'
  }
}

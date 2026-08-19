import enumerationTemplate from './enumeration.html'

let katexRendererPromise

function getKatexRenderer() {
  katexRendererPromise ??= import('katex/contrib/auto-render').then(module => module.default)
  return katexRendererPromise
}

export async function renderEnumerationPage({ app, isCurrent, setTitle }) {
  const renderMathInElement = await getKatexRenderer()
  if (!isCurrent()) return

  setTitle('Enumeration & Verification')
  app.innerHTML = enumerationTemplate
  renderMathInElement(app.querySelector('.methodology-content'), {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$', right: '$', display: false },
    ],
    throwOnError: false,
    strict: 'warn',
    trust: false,
  })
}

import { drag } from 'd3-drag'
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force'
import { select } from 'd3-selection'

let nextVisualizationId = 0

function categoryGraph(table, objects, morphisms) {
  const groups = new Map()
  for (let morphism = objects; morphism < morphisms; morphism += 1) {
    const source = Array.from({ length: objects }, (_, object) => object)
      .find(object => table[morphism][object] < morphisms)
    const target = Array.from({ length: objects }, (_, object) => object)
      .find(object => table[object][morphism] < morphisms)
    if (source === undefined || target === undefined) continue
    const key = `${source}-${target}`
    if (!groups.has(key)) groups.set(key, { source, target, members: [] })
    groups.get(key).members.push(morphism)
  }
  return {
    nodes: Array.from({ length: objects }, (_, id) => ({ id })),
    links: [...groups.values()],
  }
}

export function mountCategoryVisualization(element, table, objects, morphisms) {
  if (!element || morphisms === 0 || objects === 0) return () => {}

  const { nodes, links } = categoryGraph(table, objects, morphisms)
  const nonEndomorphisms = links.filter(link => link.source !== link.target)
  const endomorphisms = links.filter(link => link.source === link.target)
  const id = `category-quiver-${nextVisualizationId++}`
  const height = 260
  let width = Math.max(320, element.getBoundingClientRect().width)

  const svg = select(element)
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('role', 'img')
    .attr('aria-label', 'Category quiver; object nodes can be dragged')

  svg.append('defs')
    .append('marker')
    .attr('id', `${id}-arrow`)
    .attr('viewBox', '0 0 10 10')
    .attr('refX', 27)
    .attr('refY', 5)
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .attr('orient', 'auto-start-reverse')
    .append('path')
    .attr('d', 'M 0 0 L 10 5 L 0 10 z')

  const link = svg.append('g')
    .attr('class', 'viz-links')
    .selectAll('g')
    .data(nonEndomorphisms)
    .join('g')

  link.append('path')
    .attr('id', (_, index) => `${id}-edge-${index}`)
    .attr('marker-end', `url(#${id}-arrow)`)

  link.append('text')
    .append('textPath')
    .attr('href', (_, index) => `#${id}-edge-${index}`)
    .attr('startOffset', '50%')
    .text(link => link.members.join(', '))

  const loop = svg.append('g')
    .attr('class', 'viz-loops')
    .selectAll('g')
    .data(endomorphisms)
    .join('g')

  loop.append('path')
    .attr('id', (_, index) => `${id}-loop-${index}`)
    .attr('marker-end', `url(#${id}-arrow)`)

  loop.append('text')
    .append('textPath')
    .attr('href', (_, index) => `#${id}-loop-${index}`)
    .attr('startOffset', '50%')
    .text(link => link.members.join(', '))

  const node = svg.append('g')
    .attr('class', 'viz-nodes')
    .selectAll('g')
    .data(nodes)
    .join('g')
    .attr('role', 'button')
    .attr('aria-label', node => `Object ${node.id}; drag to rearrange`)

  node.append('circle').attr('r', 17)
  node.append('text').attr('dy', '0.35em').text(node => node.id)

  function seedPositions() {
    const radius = Math.min(width * 0.3, 100)
    nodes.forEach((node, index) => {
      const angle = objects === 1 ? 0 : -Math.PI / 2 + (2 * Math.PI * index) / objects
      node.x = width / 2 + (objects === 1 ? 0 : radius * Math.cos(angle))
      node.y = height / 2 + (objects === 1 ? 0 : radius * Math.sin(angle))
      node.fx = null
      node.fy = null
    })
  }

  seedPositions()
  const simulation = forceSimulation(nodes)
    .force('link', forceLink(links).id(node => node.id).distance(105).strength(0.08))
    .force('charge', forceManyBody().strength(-180))
    .force('center', forceCenter(width / 2, height / 2))
    .force('collide', forceCollide(28))
    .on('tick', () => {
      for (const item of nodes) {
        item.x = Math.max(30, Math.min(width - 30, item.x))
        item.y = Math.max(48, Math.min(height - 30, item.y))
      }
      link.select('path').attr('d', item => `M${item.source.x},${item.source.y}L${item.target.x},${item.target.y}`)
      loop.select('path').attr('d', item => {
        const x = item.source.x
        const y = item.source.y
        return `M${x - 9},${y - 16}C${x - 46},${y - 67} ${x + 46},${y - 67} ${x + 9},${y - 16}`
      })
      node.attr('transform', item => `translate(${item.x},${item.y})`)
    })

  node.call(drag()
    .on('start', (event, subject) => {
      if (!event.active) simulation.alphaTarget(0.3).restart()
      subject.fx = subject.x
      subject.fy = subject.y
    })
    .on('drag', (event, subject) => {
      subject.fx = Math.max(30, Math.min(width - 30, event.x))
      subject.fy = Math.max(48, Math.min(height - 30, event.y))
    })
    .on('end', (event, subject) => {
      if (!event.active) simulation.alphaTarget(0)
      subject.fx = null
      subject.fy = null
    }))

  const reset = element.closest('.viz-box')?.querySelector('[data-reset-viz]')
  const resetLayout = () => {
    seedPositions()
    simulation.alpha(1).restart()
  }
  reset?.addEventListener('click', resetLayout)

  const observer = new ResizeObserver(entries => {
    const nextWidth = Math.max(320, entries[0].contentRect.width)
    if (Math.abs(nextWidth - width) < 1) return
    width = nextWidth
    svg.attr('viewBox', `0 0 ${width} ${height}`)
    simulation.force('center', forceCenter(width / 2, height / 2)).alpha(0.4).restart()
  })
  observer.observe(element)

  return () => {
    observer.disconnect()
    reset?.removeEventListener('click', resetLayout)
    simulation.stop()
  }
}

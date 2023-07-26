import 'dotenv/config'

import path from 'path'

import express from 'express'
const app = express()
const port = process.env.PORT

const supabaseUrl = 'https://znxyuwheorjbdymlnrxe.supabase.co'
const supabaseKey = process.env.SUPABASE_KEY
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

// Cache views iff in production
import { Eta } from "eta"
const eta = new Eta({ views: "views", cache: process.env.NODE_ENV == 'production' })

app.use(express.static('static'))

app.get('/', (req, res) => {
  res.send(eta.render("./index"))
})

app.get('/browse', (req, res) => {
  res.send(eta.render("./browse"))
})

app.get('/morphisms_nav_list', async (req, res) => {
  let { data, error, status } = await supabase
    .from('morphisms_list')
    .select('*')
  if (error) {
    console.error(error)
  }
  let response = `
  <div class="select is-small">
  <select name="morphisms" hx-get="/objects_nav_list" hx-target="#objects-nav">
  `
  for (const i of data) {
    response += `<option value="${i.morphisms}">${i.morphisms}</option>`
  }
  response += `
  </select>
  </div>
  `
  res.send(response)
})

app.get('/objects_nav_list', async (req, res) => {
  const morphisms = req.query.morphisms
  const { data, error, status } = await supabase
    .from('objects_list')
    .select('objects')
    .eq('morphisms', morphisms)
  if (error) {
    console.error(error)
  }
  let response = `
  <div class="control" id="submit" hx-swap-oob="true"></div>
  <div class="select is-small">
  <select name="objects" hx-get="/browse_button" hx-target="#submit">
  `
  for (const i of data) {
    response += `<option value="${i.objects}">${i.objects}</option>`
  }
  response += `
  </select>
  </div>
  `
  res.send(response)
})

app.get('/category_listing', async (req, res) => {
  const page_size = 10
  const start_index = req.query.from ? parseInt(req.query.from) : 0
  const morphisms = req.query.morphisms
  const objects = req.query.objects
  const { data, error, status, count } = await supabase
    .from('Categories')
    .select('id,index,friendly_name', { count: 'exact' })
    .eq('morphisms', morphisms)
    .eq('objects', objects)
    .order('index', { ascending: true })
    .range(start_index, start_index + page_size - 1)
  if (error) {
    console.error(error)
  }
  const cur_page = Math.ceil((start_index + 1) / page_size)
  const num_pages = Math.ceil(count / page_size)
  let response = ``
  if (num_pages > 1) {
    response += `
    <nav class="pagination is-centered">
      ${start_index - page_size >= 0 ?
        `<a class="pagination-previous is-left" hx-get="/category_listing?from=${start_index - page_size}&morphisms=${morphisms}&objects=${objects}" hx-target="#results" hx-indicator=".pagination-list">«</a>`
        : ``}
      <span class="pagination-list">Page ${cur_page} of ${num_pages} <span class="icon htmx-indicator"><i class="fa-solid fa-ellipsis fa-fade"></i></span></span>
      ${start_index + page_size < count ?
        `<a class="pagination-next is-right" hx-get="/category_listing?from=${start_index + page_size}&morphisms=${morphisms}&objects=${objects}" hx-target="#results" hx-indicator=".pagination-list">»</a>`
        : ``}
    </nav>
    `
  }
  response += `
  <table class="table is-fullwidth">
  <thead>
    <tr>
      <th>Index</th>
      <th>Name</th>
      <th>ID <i class="fa-solid fa-link"></i></th>
    </tr>
  </thead>
  <tbody>`
  for (const i of data) {
    response += `
    <tr>
      <th>${i.index}</th>
      <td>${i.friendly_name == null ? '<span class="has-text-grey">N/A</span>' : i.friendly_name}</td>
      <td><a href="/category/${i.id}">${i.id.slice(0, 7)}...</a></td>
    </tr>`
  }
  response += "</tbody></table>"
  res.send(response)
})

app.get('/props', (req, res) => {
  res.send(eta.render("./props"))
})

app.get('/prop_listing', async (req, res) => {
  const page_size = 10
  const start_index = req.query.from ? parseInt(req.query.from) : 0
  const { data, error, status, count } = await supabase
    .from('Propositions')
    .select('*', { count: 'exact' })
    .range(start_index, start_index + page_size - 1)
  if (error) {
    console.error(error)
  }
  const cur_page = Math.ceil((start_index + 1) / page_size)
  const num_pages = Math.ceil(count / page_size)
  let response = ``
  if (num_pages > 1) {
    response += `
      <nav class="pagination is-centered">
        ${start_index - page_size >= 0 ?
        `<a class="pagination-previous is-left" hx-get="/prop_listing?from=${start_index - page_size}&morphisms=${morphisms}&objects=${objects}" hx-target="#results" hx-indicator=".pagination-list">«</a>`
        : ``}
        <span class="pagination-list">Page ${cur_page} of ${num_pages} <span class="icon htmx-indicator"><i class="fa-solid fa-ellipsis fa-fade"></i></span></span>
        ${start_index + page_size < count ?
        `<a class="pagination-next is-right" hx-get="/prop_listing?from=${start_index + page_size}&morphisms=${morphisms}&objects=${objects}" hx-target="#results" hx-indicator=".pagination-list">»</a>`
        : ``}
      </nav>
      `
  }
  response += `
    <table class="table is-fullwidth">
    <thead>
      <tr>
        <th>ID</th>
        <th>Name</th>
        <th>Description</th>
      </tr>
    </thead>
    <tbody>`
  for (const i of data) {
    response += `
      <tr>
        <td>${i.id.slice(0, 7)}...</td>
        <td>${i.name == null ? '<span class="has-text-grey">N/A</span>' : i.name}</td>
        <td>${i.description == null ? '<span class="has-text-grey">N/A</span>' : i.description}</td>
      </tr>`
  }
  response += "</tbody></table>"
  res.send(response)
})

app.get('/query', (req, res) => {
  res.send(eta.render("./query"))
})

app.get('/query_listing', async (req, res) => {
  const morphisms = req.query.morphisms != '' ? parseInt(req.query.morphisms) : null
  const objects = req.query.objects != '' ? parseInt(req.query.objects) : null
  const sat = req.query.satisfying
  const nonsat = req.query.not_satisfying
  const { data: true_prop_ids, error: e0 } = await supabase
    .from('Propositions')
    .select('id')
    .in('name', sat.split(','))
  if (e0) {
    console.error(e0)
  }
  const { data: false_prop_ids, error: e1 } = await supabase
    .from('Propositions')
    .select('id')
    .in('name', nonsat.split(','))
  if (e1) {
    console.error(e1)
  }
  const cols = ['id', 'index', 'friendly_name', ...true_prop_ids.map((_, i) => `truekb${i}:KnowledgeBase!inner(proposition,value)`), ...false_prop_ids.map((_, i) => `falsekb${i}:KnowledgeBase!inner(proposition,value)`)]
  const { data, error, status, count } = await supabase
    .from('Categories')
    .select(cols.join(','), { count: 'exact' })
    .or(morphisms == null ? 'morphisms.gte.0' : `morphisms.eq.${morphisms}`)
    .or(objects == null ? 'objects.gte.0' : `objects.eq.${objects}`)
    .match(Object.fromEntries(true_prop_ids.flatMap((p, i) => [[`truekb${i}.proposition`, p.id], [`truekb${i}.value`, true]])))
    .match(Object.fromEntries(false_prop_ids.flatMap((p, i) => [[`falsekb${i}.proposition`, p.id], [`falsekb${i}.value`, false]])))
    .range(0, 9)
  if (status >= 500 && status < 600) {
    res.send(`
    <div class="notification is-danger">
      <strong>Server Error.</strong>
      <br>
      This is most likely a timeout -- all queries are limited to 5s of compute time. Please try a more selective query.
    </div>
    <span class="icon htmx-indicator"><i class="fa-solid fa-ellipsis fa-fade"></i></span>
    `)
    return
  }
  if (error) {
    console.error(error)
  }
  let response = `
  <span class="icon htmx-indicator"><i class="fa-solid fa-ellipsis fa-fade"></i></span>
  <table class="table is-fullwidth">
  <thead>
    <tr>
      <th>Index</th>
      <th>Name</th>
      <th>ID <i class="fa-solid fa-link"></i></a></th>
    </tr>
  </thead>
  <tbody>
  `
  for (const i of data) {
    response += `
    <tr>
      <th>${i.index}</th>
      <td>${i.friendly_name == null ? '<span class="has-text-grey">N/A</span>' : i.friendly_name}</td>
      <td><a href="/category/${i.id}">${i.id.slice(0, 7)}...</a></td>
    </tr>`
  }
  response += "</tbody></table>"
  response += `
    <p>Showing ${count > 10 ? `10 of ${count}` : `${count}`} results.</p>
    `
  res.send(response)
})

app.get('/stats', (req, res) => {
  res.send(eta.render("./stats"))
})

app.get('/about', (req, res) => {
  res.send(eta.render("./about"))
})

app.get('/support', (req, res) => {
  res.send(eta.render("./support"))
})

app.get('/category/:id', async (req, res) => {
  let { data, error, status, count } = await supabase
    .from('Categories')
    .select('*')
    .eq('id', req.params.id)
  if (error) {
    console.error(error)
  }
  if (data.length == 1) {
    res.send(eta.render("./view-category", data[0]))
  }
  else {
    res.send("There is not a unique category with this id!")
  }
})

app.get('/count_cats', async (req, res) => {
  let { data, error, status, count } = await supabase
    .from('Categories')
    .select('*', { count: 'exact', head: true })
  if (error) {
    console.error(error)
  }
  res.send(count.toString())
})

app.get('/count_props', async (req, res) => {
  let { data, error, status, count } = await supabase
    .from('Propositions')
    .select('*', { count: 'exact', head: true })
  if (error) {
    console.error(error)
  }
  res.send(count.toString())
})

app.get('/count_rels', async (req, res) => {
  let { data, error, status, count } = await supabase
    .from('KnowledgeBase')
    .select('*', { count: 'exact', head: true })
  if (error) {
    console.error(error)
  }
  res.send(count.toString())
})

// Return 200 OK on /health
app.get('/health', async (req, res) => {
  res.sendStatus(200)
})

// If nothing caught, return 404
app.use((req, res) => {
  res.status(404)
  if (req.accepts('html')) {
    res.send(eta.render("./404", { url: req.url }))
    return
  }
  if (req.accepts('json')) {
    res.json({ error: 'Not found' })
    return
  }
  res.type('txt').send('Not found')
})

app.listen(port, () => {
  console.log(`App listening on port ${port}`)
})

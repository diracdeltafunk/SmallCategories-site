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
  let response = ""
  for (const i of data) {
    response += `
    <label class="radio">
      <input type="radio" name="morphisms" value="${i.morphisms}" hx-get="objects_nav_list" hx-target="#objects-nav">
      ${i.morphisms}
    </label>`
  }
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
  let response = `<div class="control" id="submit" hx-swap-oob="true"></div>`
  for (const i of data) {
    response += `
    <label class="radio">
      <input type="radio" name="objects" value="${i.objects}" hx-get="/submit_button" hx-target="#submit">
      ${i.objects}
    </label>`
  }
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
      <th>ID <i class="fa-solid fa-link"></i></a></th>
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

app.get('/submit_button', (req, res) => {
  res.send('<input type="submit" value="Search" class="button is-link"></input>')
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

app.get('/category_modal/:id', async (req, res) => {
  res.send("test")
})

app.get('/count', async (req, res) => {
  let { data, error, status, count } = await supabase
    .from('Categories')
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

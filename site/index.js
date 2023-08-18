import 'dotenv/config'

import fetch from 'node-fetch'

if (process.env.NODE_ENV === 'production') {
  console.log("Running in production mode")
}
else {
  console.log("Running in development mode")
}

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


import { Eta } from "eta"
const eta = new Eta({
  views: "views",
  cache: process.env.NODE_ENV === 'production' // Cache views iff in production
})

// First, try to serve static files
app.use(express.static('static'))

app.get('/', (req, res) => {
  res.send(eta.render("./index"))
})

app.get('/cats', (req, res) => {
  res.send(eta.render("./cats"))
})

app.get('/morphisms_nav_list', async (req, res) => {
  let { data, error } = await supabase
    .from('morphisms_list')
    .select('*')
  if (error) {
    console.error(error)
  }
  res.send(eta.render("./morphisms_nav_list", { data: data }))
})

app.get('/objects_nav_list', async (req, res) => {
  const morphisms = req.query.morphisms
  const { data, error } = await supabase
    .from('objects_list')
    .select('objects')
    .eq('morphisms', morphisms)
  if (error) {
    console.error(error)
  }
  res.send(eta.render("./objects_nav_list", { data: data }))
})

app.get('/browse_listing', async (req, res) => {
  const page_size = 10
  const start_index = req.query.from ? parseInt(req.query.from) : 0
  const morphisms = parseInt(req.query.morphisms)
  const objects = parseInt(req.query.objects)
  const { data, error, count } = await supabase
    .from('Categories')
    .select('*', { count: 'exact' })
    .eq('morphisms', morphisms)
    .eq('objects', objects)
    .order('index', { ascending: true })
    .range(start_index, start_index + page_size - 1)
  if (error) {
    console.error(error)
  }
  const cur_page = Math.ceil((start_index + 1) / page_size)
  const num_pages = Math.ceil(count / page_size)
  res.send(eta.render('/browse_listing', { data: data, cur_page: cur_page, num_pages: num_pages, page_size: page_size, start_index: start_index, count: count, morphisms: morphisms, objects: objects }))
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
  res.send(eta.render('/prop_listing', { data: data, cur_page: cur_page, num_pages: num_pages, page_size: page_size, start_index: start_index, count: count }))
})

app.get('/props_search/:partial', async (req, res) => {
  const { data, error } = await supabase
    .from('Propositions')
    .select('id, name')
    .ilike('name', `%${req.params.partial}%`)
  if (error) {
    console.error(error)
  }
  res.json(data)
})

app.get('/query', (req, res) => {
  res.send(eta.render("./query"))
})

app.get('/query_mobile', async (req, res) => {
  const { data, error } = await supabase
    .from('Propositions')
    .select('id, name')
  if (error) {
    console.error(error)
  }
  res.send(eta.render("./query", { mobile_hotfix: true, propositions: data }))
})

app.get('/query_listing', async (req, res) => {
  const morphisms_lb = req.query.morphisms_lb ? parseInt(req.query.morphisms_lb) : 0
  const morphisms_ub = req.query.morphisms_ub ? parseInt(req.query.morphisms_ub) : 32767
  const objects_lb = req.query.objects_lb ? parseInt(req.query.objects_lb) : 0
  const objects_ub = req.query.objects_ub ? parseInt(req.query.objects_ub) : 32767
  const true_prop_ids = req.query.satisfying ? [].concat(req.query.satisfying) : []
  const false_prop_ids = req.query.not_satisfying ? [].concat(req.query.not_satisfying) : []
  const { data, error, status, count } = await supabase
    .rpc('query_listing', {
      morphisms_lb: morphisms_lb,
      morphisms_ub: morphisms_ub,
      objects_lb: objects_lb,
      objects_ub: objects_ub,
      spec: [
        ...true_prop_ids.map(x => `(${x}, true)`),
        ...false_prop_ids.map(x => `(${x}, false)`)
      ]
    }, { count: 'exact' })
    .limit(10)

  if (status >= 500 && status < 600) {
    res.send(eta.render('./timeout.eta'))
    return
  }
  if (error) {
    console.error(error)
  }
  res.send(eta.render('./query_listing', { data: data, count: count }))
})

app.get('/stats', (req, res) => {
  res.send(eta.render("./stats"))
})

app.get('/stats_table', async (req, res) => {
  const { data, error } = await supabase
    .from('stats_table')
    .select('*')
  if (error) {
    console.error(error)
  }
  res.send(eta.render("./stats_table", data))
})

app.get('/about', (req, res) => {
  res.send(eta.render("./about"))
})

app.get('/support', (req, res) => {
  res.send(eta.render("./support"))
})

app.get('/random', async (req, res) => {
  const { data, error } = await supabase
    .rpc('random_cat_id')
  if (error) {
    console.error(error)
  }
  if (data.length < 1) {
    res.send("Database Error: There are no categories!")
    return
  }
  res.redirect('/category/' + data)
})

app.get('/category/:id', async (req, res) => {
  const { data: cdata, error: cerror } = await supabase
    .from('Categories')
    .select('*')
    .eq('id', req.params.id)
  if (cerror) {
    console.error(cerror)
  }
  if (cdata.length == 1) {
    const { data: pdata, error: perror } = await supabase
      .from('named_kb')
      .select('prop, prop_id, value')
      .eq('cat', req.params.id)
    if (perror) {
      console.error(perror)
    }
    res.send(eta.render("./category", { cat: cdata[0], props: pdata }))
  }
  else {
    res.send("Database Error: There is not a unique category with this id!")
  }
})

app.get('/proposition/:id', async (req, res) => {
  let { data, error } = await supabase
    .from('Propositions')
    .select('*')
    .eq('id', req.params.id)
  if (error) {
    console.error(error)
  }
  if (data.length == 1) {
    res.send(eta.render("./proposition", data[0]))
  }
  else {
    res.send("Database Error: There is not a unique proposition with this id!")
  }
})

app.get('/count_cats', async (req, res) => {
  let { error, count } = await supabase
    .from('Categories')
    .select('*', { count: 'exact', head: true })
  if (error) {
    console.error(error)
  }
  res.send(count.toString())
})

app.get('/count_props', async (req, res) => {
  let { error, count } = await supabase
    .from('Propositions')
    .select('*', { count: 'exact', head: true })
  if (error) {
    console.error(error)
  }
  res.send(count.toString())
})

app.get('/count_rels', async (req, res) => {
  let { error, count } = await supabase
    .from('KnowledgeBase')
    .select('*', { count: 'exact', head: true })
  if (error) {
    console.error(error)
  }
  res.send(count.toString())
})

app.get('/smolcats', async (req, res) => {
  const response = await fetch('https://api.thecatapi.com/v1/images/search',
    { headers: { 'x-api-key': 'live_xR5d8KNnBBDR6fOQCIwhoK5cDBajMg7UNAgmCHgL6SnP0FJBcPmtNkmmYNgxHpmm' } }
  )
  res.send(eta.render("./smolcats", { ok: response.ok, data: await response.json() }))
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

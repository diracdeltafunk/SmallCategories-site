import 'dotenv/config'

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

app.get('/browse', (req, res) => {
  res.send(eta.render("./browse"))
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

app.get('/query', (req, res) => {
  res.send(eta.render("./query"))
})

app.get('/query_listing', async (req, res) => {
  const morphisms_lb = req.query.morphisms_lb != '' ? parseInt(req.query.morphisms_lb) : 0
  const morphisms_ub = req.query.morphisms_ub != '' ? parseInt(req.query.morphisms_ub) : 32767
  const objects_lb = req.query.objects_lb != '' ? parseInt(req.query.objects_lb) : 0
  const objects_ub = req.query.objects_ub != '' ? parseInt(req.query.objects_ub) : 32767
  const sat = req.query.satisfying
  const nonsat = req.query.not_satisfying
  const { data: true_prop_ids, error: e0 } = await supabase
    .from('Propositions')
    .select('id')
    .in('name', sat.replace(/\s/g, '').split(','))
  if (e0) {
    console.error(e0)
  }
  const { data: false_prop_ids, error: e1 } = await supabase
    .from('Propositions')
    .select('id')
    .in('name', nonsat.replace(/\s/g, '').split(','))
  if (e1) {
    console.error(e1)
  }

  const { data, error, status, count } = await supabase
    .rpc('query_listing', {
      morphisms_lb: morphisms_lb,
      morphisms_ub: morphisms_ub,
      objects_lb: objects_lb,
      objects_ub: objects_ub,
      spec: [
        ...true_prop_ids.map(x => `(${x.id}, true)`),
        ...false_prop_ids.map(x => `(${x.id}, false)`)
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

app.get('/about', (req, res) => {
  res.send(eta.render("./about"))
})

app.get('/support', (req, res) => {
  res.send(eta.render("./support"))
})

app.get('/category/:id', async (req, res) => {
  let { data, error } = await supabase
    .from('Categories')
    .select('*')
    .eq('id', req.params.id)
  if (error) {
    console.error(error)
  }
  if (data.length == 1) {
    res.send(eta.render("./category", data[0]))
  }
  else {
    res.send("Database Error: There is not a unique category with this id!")
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

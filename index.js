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

app.get('/category/:id', async (req, res) => {
  let { data, error, status, count } = await supabase
    .from('Categories')
    .select('*')
    .eq('id', req.params.id)
  if (data.length == 1) {
    res.send(eta.render("./view-category", data[0]))
  }
  else {
    res.send("There is not a unique category with this id!")
  }
})

app.get('/count', async (req, res) => {
  let { data, error, status, count } = await supabase
    .from('Categories')
    .select('*', { count: 'exact', head: true })
  res.send(count.toString())
})

// Return 200 OK on /health
app.get('/health', async (req, res) => {
  res.sendStatus(200)
})

app.listen(port, () => {
  console.log(`App listening on port ${port}`)
})

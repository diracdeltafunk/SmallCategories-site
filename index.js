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

import { Eta } from "eta"
const eta = new Eta({ views: "templates" })

// Home page shows number of categories in database
app.get('/', async (req, res) => {
  let { data, error, status, count } = await supabase
    .from('Categories')
    .select('*', { count: 'exact', head: true })
  res.send(count + " categories in database!")
})

app.get('/category/:id', async (req, res) => {
  let { data, error, status, count } = await supabase
    .from('Categories')
    .select('*', { count: 'exact' })
    .eq('id', req.params.id)
  if (count == 1) {
    res.send(eta.render("./view-category", { name: data[0].friendly_name }))
  }
  else {
    res.send("There is not a unique category with this id!")
  }
})

// Return 200 OK on /health
app.get('/health', async (req, res) => {
  res.sendStatus(200)
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})

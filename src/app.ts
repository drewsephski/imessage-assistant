import * as Sentry from '@sentry/node'
import { Hono } from 'hono'
import { upgradeUrl } from './billing.js'
import { type LandingLinks, landingPage } from './landing.js'
import { linqWebhook } from './linq-webhook.js'
import { telegramWebhook } from './telegram-webhook.js'

const app = new Hono()

// Registered first: traces each request and reports unhandled 5xx errors. The automatic
// Hono integration does the same when instrument.ts is preloaded; requests are deduplicated.
app.use(Sentry.honoMiddleware(app))

// Where the landing page sends people. Each value is public by nature (the number and bot people
// message, the hosted account page) and is left off the page when unset or malformed, so a
// misconfigured environment shows fewer buttons rather than a broken link.
const landingLinks = (): LandingLinks => {
  const number = process.env.LINQ_PHONE_NUMBER?.replace(/[\s().-]/g, '')
  const username = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '')
  let accountUrl: string | undefined
  try {
    accountUrl = upgradeUrl()
  } catch {
    // No (or an unparseable) Clerk publishable key: the page simply has no account link
  }
  return {
    imessageNumber: number && /^\+[1-9]\d{6,14}$/.test(number) ? number : undefined,
    telegramUsername: username && /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username) ? username : undefined,
    accountUrl,
  }
}

// Rendered once: the page only depends on configuration read at startup
let landing: ReturnType<typeof landingPage> | undefined

app.get('/', (c) => {
  landing ??= landingPage(landingLinks())
  c.header('Cache-Control', 'public, max-age=300')
  return c.html(landing)
})

app.route('/telegram/webhook', telegramWebhook)
app.route('/linq/webhook', linqWebhook)

export default app

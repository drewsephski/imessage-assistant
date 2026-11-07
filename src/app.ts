import { serveStatic } from '@hono/node-server/serve-static'
import * as Sentry from '@sentry/node'
import { Hono } from 'hono'
import { accountUrl, clerkFrontendApi } from './billing.js'
import { calendarConfig } from './integrations/composio-calendar.js'
import { type LandingLinks, landingPage } from './landing.js'
import { linqWebhook } from './linq-webhook.js'
import { type PricingConfig, pricingPage } from './pricing.js'
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
  let account: string | undefined
  try {
    account = accountUrl()
  } catch {
    // No (or an unparseable) Clerk publishable key: the page simply has no account link
  }
  return {
    imessageNumber: number && /^\+[1-9]\d{6,14}$/.test(number) ? number : undefined,
    telegramUsername: username && /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username) ? username : undefined,
    accountUrl: account,
    // The pricing page needs the same Clerk key as the account link
    pricingUrl: account && '/pricing',
    // Advertising is a separate rollout choice from installing credentials.
    calendarEnabled: process.env.CALENDAR_LANDING_ENABLED === 'true' && Boolean(calendarConfig()),
    productName: productName(),
  }
}

// The product's public name, shared by every page. Unset means the pages say "Assistant"
const productName = () => process.env.PRODUCT_NAME?.trim() || undefined

// Rendered once: the page only depends on configuration read at startup
let landing: ReturnType<typeof landingPage> | undefined

app.get('/', (c) => {
  landing ??= landingPage(landingLinks())
  c.header('Cache-Control', 'public, max-age=300')
  return c.html(landing)
})

const pricingConfig = (): PricingConfig | undefined => {
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY
  if (!publishableKey) return undefined
  try {
    return { publishableKey, frontendApi: clerkFrontendApi(publishableKey), productName: productName() }
  } catch {
    return undefined
  }
}

// Plans and prices are fetched from Clerk in the browser, so the page itself is as static as "/"
app.get('/pricing', (c) => {
  const config = pricingConfig()
  if (!config) return c.notFound()
  c.header('Cache-Control', 'public, max-age=300')
  return c.html(pricingPage(config))
})

// The landing page's script and images. Only these are served from disk, relative to the working
// directory the server starts in (the repository root, for both `dev` and `start`).
app.get('/landing.js', serveStatic({ root: './public' }))

app.use(
  '/blobs/*',
  async (c, next) => {
    await next()
    if (c.res.ok) c.header('Cache-Control', 'public, max-age=86400')
  },
  serveStatic({ root: './public' }),
)

app.route('/telegram/webhook', telegramWebhook)
app.route('/linq/webhook', linqWebhook)

export default app

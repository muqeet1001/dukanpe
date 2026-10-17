# Dukanpe WhatsApp order bot

Node.js + Express + whatsapp-web.js + MongoDB + Groq + PDFKit. This is a single-shop prototype. It connects through WhatsApp Web and a QR, without Meta Cloud API credentials. SQLite remains available for offline development and unit tests when no MongoDB URI is configured.

## Run on Windows

Use Node **22.14 or newer**. From the app folder:

```powershell
npm run bot:install
# Copy server/.env.example to server/.env and add your private MongoDB URI and Groq key.
npm run bot
```

The server uses port 4000 and prints its LAN address. Keep the Expo phone and computer on the same Wi-Fi. Chrome is automatically detected on Windows, with Edge as a fallback. You can set `CHROME_EXECUTABLE_PATH` in `server/.env` for a different installation; see `.env.example`. If using an installed browser, `PUPPETEER_SKIP_DOWNLOAD=true` during dependency installation avoids Puppeteer's browser download. Otherwise Puppeteer installs its bundled browser.

1. Open Dukanpe → **Khata → Connect WhatsApp**.
2. Enter the bot server URL. Web uses `http://localhost:4000`; a phone uses the computer's LAN address.
3. Paste the private code from **server/data/pairing-code.txt** and choose **Connect bot server**. Do not commit or share that code.
4. Review `catalogue.json` before first launch: its initial products and prices are samples. Saved prices can be updated through the protected catalogue API.
5. Choose **Connect WhatsApp**. On the business/test phone open WhatsApp → Linked devices → Link a device, then scan the QR shown in Dukanpe.
6. From a **different WhatsApp number**, send `HI` to the linked business number. The bot welcomes the customer by shop name. Reply `1` or `MENU` for current prices, `2` or `ORDER` for ordering help, then send `2 kg rice, 1 kg sugar`.
7. The customer receives an unpaid order invoice as a PDF with an itemised caption. Dukanpe imports the customer, invoice, original order and one credit sale into khata within about 2.5 seconds while open.

The first sample order is INR 165: 2 kg rice at INR 60/kg plus 1 kg sugar at INR 45/kg. It increases customer dues, with no receipt or paid balance fabricated.

## Groq AI replies

Set `GROQ_API_KEY` privately in `server/.env`. The default model is `openai/gpt-oss-20b`, hosted by Groq. Groq has a rate-limited free plan; actual quotas and billing depend on your Groq account. This app does not enable billing or switch to another paid provider. Set `AI_PROVIDER=off` to disable AI.

HI, MENU, numbered choices and exact catalogue-format orders use deterministic handlers. Other messages go to Groq for shop-related help and natural-language order extraction. For example, `do kilo chawal aur ek kilo cheeni chahiye` becomes a priced preview. The customer must reply **CONFIRM** before that AI-interpreted order creates an invoice or debt. **CANCEL** discards the preview. Previews expire after 15 minutes; changed prices require a new confirmation. Duplicate confirmations and restarts cannot add a second debit.

Only the current customer message and catalogue IDs/names/aliases/units go to Groq. Customer phone numbers, stored account histories, database credentials and API keys are not included in the prompt. Customer text itself may contain personal information. Never rely on model-generated prices: the server validates known products and quantities, then computes integer-paise totals from saved catalogue prices. Unsupported products/units stay unbilled. When Groq is unavailable or rate limited, catalogue commands and explicit-format orders continue working.

## Customer flow

After connection, the complete customer conversation happens in WhatsApp. The app's connection screen has no order form, simulated chat, price editor or invoice list. The merchant opens Khata to see customer names and their unpaid totals; opening the customer account shows the order and invoice records. The bot keeps answering while the Node process runs, even if the merchant leaves the connection screen or closes the app. Reopening Dukanpe syncs saved orders. Greetings and help create no customer, invoice or debt.

If a reply does not arrive, open **Connection settings** and check **Last incoming** and **Last reply**. These show activity since the current WhatsApp connection started, without exposing chat contents. Test using a separate account: outgoing messages and **Message yourself** are intentionally ignored. Keep the Node process running; Expo alone cannot answer WhatsApp. A reply failure appears in the app and the server logs a redacted diagnostic. Send a fresh `HI` after reconnecting; old messages are not replayed.

## Order formats

- `2 kg rice, 1 kg sugar`
- `rice 2kg` on one line and `sugar 1kg` on the next
- `500 g chawal aur 1 litre oil`
- `५०० ग्राम चावल और १ किलो चीनी`
- `HI`, `Hello`, `Namaste`, `नमस्ते`, `START`: welcome and choices
- `1`, `MENU`, `HELP`: catalogue and prices
- `2`, `ORDER`: instructions for placing an order

Explicit-format orders use catalogue matching and do not need an AI call. Other messages use Groq when configured. Orders accept up to ten lines with known items and clear quantities. Unsupported products, wrong units, mixed payment instructions, vague requests and unsupported units produce clarification; the whole order remains unbilled. Zero/negative quantities and fractional packets are rejected. Gram/ml quantities convert to kg/litre, and money is rounded once per combined product line to integer paise.

Add more products/aliases in `catalogue.json` and restart. Existing product prices are stored in SQLite and edited through the protected catalogue API; reloading the seed file does not overwrite saved prices. Historical invoices freeze their item prices. PDFs use built-in Latin fonts and INR currency text; a non-Latin customer name falls back to their phone number on the PDF. The app retains Unicode names and text.

## Data and behaviour

- When `MONGODB_URI` is set, MongoDB stores the catalogue, customers, messages, invoices, ledger, outbox and pending AI conversations. A configured MongoDB failure stops startup; it never silently books orders in a different database.
- When `MONGODB_URI` is omitted, `data/dukanpe.sqlite` provides offline persistence. Existing SQLite demo data is preserved, without automatic migration into the configured cloud database.
- `data/whatsapp-session/`: LocalAuth session. Restarting restores the session; scanning is needed again when WhatsApp invalidates it.
- Customer identity is a resolved phone number when available, otherwise the WhatsApp chat ID. Display names never match or merge customer accounts. Existing fictional app customers are not linked by name.
- An invoice, one positive ledger debit, the customer balance increment, incoming message and delivery job are committed in one MongoDB transaction. Unique message/invoice indexes prevent duplicate charges; concurrent orders for the same customer update the balance atomically. The local adapter uses a SQLite transaction.
- Only incoming one-to-one text messages after linking are handled. Groups, statuses, broadcasts, outgoing messages and old-history messages are ignored. The bot does not read invoices/images or record payments in this version.
- A PDF-send failure or restart during sending is marked **uncertain**. Check the customer chat before choosing **Resend same invoice**. Resending never creates another debit. Only confirmed library send results are labelled sent; this is not a read/recipient-delivery guarantee.
- The app imports one confirmed credit-sale record per invoice. Invoice and source-message records are evidence and do not add debt again. Repeated polling is idempotent and existing local records are preserved.
- Invoice balances cover the bot's orders only. Local manual app entries are included in the customer account balance but are not sent back to this first-version bot database.
- Bot records coexist with the app's fictional sample shop. A live customer has its own phone/chat identity. App totals are labelled **Sample + WhatsApp** when real bot entries exist.
- The server remembers an enabled connection and restores it automatically after a process restart using the saved session. Choosing **Stop WhatsApp replies** disables automatic reconnection while preserving the session. Disconnecting the app only stops app sync. Resetting sample data does not delete server invoices; paired sync imports them again.

## Local API

Every `/api/*` route requires `Authorization: Bearer <pairing-code>`. The pairing code stays out of Expo public environment variables: native uses Expo SecureStore; web keeps pairing in tab-scoped sessionStorage. Public health returns no financial information. CORS allows the local Expo dev origin and exact origins listed in `CORS_ORIGINS`.

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | Process health |
| GET | `/api/snapshot` | Bot status/QR, products and invoice/khata data |
| POST | `/api/whatsapp/start` | Start headless WhatsApp Web and generate a QR |
| POST | `/api/whatsapp/stop` | Stop without logging out |
| PUT | `/api/catalogue/:id` | Update unit price using integer `pricePaise` |
| POST | `/api/demo/order` | Simulated order; `messageId`, `name`, `phone`, `body` |
| GET | `/api/invoices/:id/pdf-link` | Issue a signed PDF link valid for five minutes |
| POST | `/api/invoices/:id/resend` | Send the same real invoice after checking delivery |

## MongoDB collections

Database name comes from `MONGODB_DB`, or the URI path when that setting is absent. All app collections use the `dukanpe_` prefix so unrelated collections are untouched.

| Collection | Stored data |
|---|---|
| `dukanpe_products` | Product ID, name, aliases, sale unit and price in paise |
| `dukanpe_customers` | Phone/chat identity, name, phone, live/demo mode and balance in paise |
| `dukanpe_messages` | Unique incoming message ID, original text, reply and optional invoice ID |
| `dukanpe_invoices` | Frozen item quantities/prices, total, customer, source message and time |
| `dukanpe_ledger` | One unpaid sale/debit per invoice |
| `dukanpe_outbox` | Invoice destination, delivery state, sent message ID and delivery error |
| `dukanpe_conversations` | Pending AI order preview, customer identity and expiry; TTL cleanup |

`server/data/`, browser sessions, pairing credentials and the database are Git-ignored. The server binds the LAN for phone testing. Do not expose this prototype directly to the public internet: a deployment needs HTTPS, proper merchant accounts/authorisation, backups, stronger operational controls and a production persistence design. Keep this Node process running for WhatsApp replies; Expo Go alone cannot host it.

## Verify

```powershell
npm test
# Optional real MongoDB integration check, run from server/ with a configured .env:
node --env-file=.env --test test/mongo.test.js
```

Tests cover parsing, greeting/menu flow, complete-order rejection, invoice/debit deduplication, account separation, frozen pricing, persistence/restart, PDF output, mocked WhatsApp delivery, protected API/PDF links, Groq response validation, AI confirmation, expiry, cancellation and price-change review. The MongoDB integration test uses fresh uniquely named disposable collections, verifies transactions/concurrent deduplication, then removes only those test collections. Tests send no real WhatsApp messages. Physical delivery must be tested from a separate WhatsApp number after linking.

See [Groq models](https://console.groq.com/docs/models), [free-plan limits](https://console.groq.com/docs/rate-limits) and the [MongoDB Node driver](https://www.mongodb.com/docs/drivers/node/current/).

This unofficial library can break when WhatsApp Web changes and does not guarantee protection from account restrictions. See the [maintainer's notice](https://github.com/wwebjs/whatsapp-web.js), [LocalAuth guide](https://wwebjs.dev/guide/creating-your-bot/authentication.html) and [document sending guide](https://wwebjs.dev/guide/creating-your-bot/handling-attachments.html).

The installed whatsapp-web.js dependency tree currently reports upstream high-severity advisories in Puppeteer's browser-download/proxy dependencies, including `extract-zip` without an available fixed release. This setup was installed without downloading a browser and uses the installed Chrome. Do not force npm's suggested downgrade of whatsapp-web.js; review upstream updates before a production deployment.

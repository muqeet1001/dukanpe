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
2. The app discovers the local service automatically and displays the actual **WhatsApp linked-device QR**. No merchant-facing server address, pairing code or setup QR is required.
3. On the merchant's phone open **WhatsApp → Linked devices → Link a device** and scan the displayed QR. The app authorises that device and starts syncing only after the merchant account is confirmed. Display Dukanpe on a second device if WhatsApp is on the same phone.
4. Review `catalogue.json` before first launch: its initial products and prices are samples. Saved prices can be updated through the protected catalogue API.
5. Keep the linking screen open until it shows **Merchant WhatsApp connected**. If another linking screen is active, use **Show QR on this device** to replace the pending scan.
6. From a **different WhatsApp number**, send `HI` to the linked business number. Reply `1` or `MENU` for current prices, `2` or `ORDER` for ordering help, `3` for your balance, `4` for your orders or `5` for your latest invoice. To order directly, send `2 kg rice, 1 kg sugar`.
7. The customer receives an unpaid invoice PDF, then chooses **1 Pay now / 2 Khata** in its caption. Dukanpe imports the customer, invoice, original order and one credit sale into khata within about 2.5 seconds while open.

The first sample order is INR 165: 2 kg rice at INR 60/kg plus 1 kg sugar at INR 45/kg. It increases customer dues, with no receipt or paid balance fabricated.

### Direct linking in Expo Go

Open Expo Go normally, then **Khata → Connect WhatsApp**. The linking QR opens automatically. Native discovers the service from Expo's host address; web uses the page hostname. Both default to port 4000. A deployed service address may be configured with `EXPO_PUBLIC_BOT_URL` by the developer; it is not a merchant form field.

Only connection status and a fresh linking QR are available before a scan. A random pending-link capability binds the scan to the requesting app. After the WhatsApp ready event verifies the merchant identity, the app receives a device access token, saved in native SecureStore or web sessionStorage. The server stores only its hash in ignored `data/authorised-devices.json`; the merchant account is pinned in ignored `data/merchant-account.json`. Business APIs still require authentication.

If the shop bot is already connected, a temporary, message-free WhatsApp session generates a fresh QR for the new app. It must be scanned by the same pinned merchant. The existing bot keeps answering customers, and the temporary verification session logs out after approval. A shop session restored during startup also switches to this flow, rather than granting access without a scan or showing an error. QR expiry, retry and reconnect states appear directly on the linking screen.

The original administrator pairing file and protected setup endpoints remain for developer compatibility; they are no longer part of the merchant UI. Physical scanning must be completed by the merchant on their phone.

## Groq AI replies

Set `GROQ_API_KEY` privately in `server/.env`. The default model is `openai/gpt-oss-20b`, hosted by Groq. Groq has a rate-limited free plan; actual quotas and billing depend on your Groq account. This app does not enable billing or switch to another paid provider. Set `AI_PROVIDER=off` to disable AI.

HI, MENU, numbered choices and exact catalogue-format orders use deterministic handlers. Other messages go to Groq for shop-related help and natural-language order extraction. For example, `do kilo chawal aur ek kilo cheeni chahiye` becomes a priced preview. The customer must reply **CONFIRM** before that AI-interpreted order creates an invoice or debt. **CANCEL** discards the preview. Previews expire after 15 minutes; changed prices require a new confirmation. Duplicate confirmations and restarts cannot add a second debit.

The current customer message, catalogue IDs/names/aliases/units and the current chat's pending product quantities go to Groq. Customer phone numbers, stored account histories, database credentials and API keys are not included in the prompt. Customer text itself may contain personal information. Never rely on model-generated prices: the server validates known products and quantities, then computes integer-paise totals from saved catalogue prices. Unsupported products/units stay unbilled. When Groq is unavailable or rate limited, catalogue commands, account shortcuts and explicit-format orders continue working.

## Replies from database records

The agent uses Groq to select an operation, then the server queries the configured database and formats factual amounts itself. The model cannot choose a customer identity or execute database queries. Identity comes from the WhatsApp sender's resolved phone/chat metadata. Display names and phone numbers typed into a message never select another account. A known original chat can still find its existing records if phone resolution temporarily fails. Live and simulated accounts stay separate.

| Customer message | What the agent does |
|---|---|
| `What is the rice price?` | Reads the current saved catalogue price; does not claim stock availability |
| `BALANCE`, `What do I owe?`, `3` | Reads only the sender's recorded WhatsApp-order balance |
| `MY ORDERS`, `4` | Lists the sender's five latest recorded orders and invoice numbers |
| `INVOICE`, `5`, `INVOICE DK-...` | Retrieves the sender's own invoice and sends a PDF copy without another debit |
| `ORDER STATUS` | Shows recorded invoice/payment data; explains that fulfilment is not tracked |
| `REPEAT LAST ORDER` | Loads the sender's previous items and asks confirmation at current prices |
| `I want rice`, then `2 kg` | Remembers the requested product and produces a priced preview |
| `Make the rice 3 kg` | Updates a pending preview; does not edit an issued invoice |
| `CART` / `CANCEL` | Shows or discards the current chat's pending order |

Account reads and PDF copies are restricted again by customer ownership at the data/transport boundaries. An explicit invoice number from another account returns the same not-found reply as a nonexistent invoice. PDF copies do not change the original delivery status or create another sale. Chat claims such as `I paid 500` never record receipts or clear balances. These balances cover the bot database's orders; manual entries still held only on the app device are not silently included.

## Customer flow

Set `SHOP_NAME` and `MERCHANT_UPI_ID` privately in `server/.env`. **Pay now** generates a PNG QR encoding the merchant UPI address, invoice reference, exact amount and INR currency. The customer pays in their own UPI app; this server never executes a transfer. `PAY NOW` can resume checkout for the customer's latest invoice. Choosing **Khata** keeps the existing debit without adding another charge. Already-paid invoices never request another payment.

After scanning, the customer sends a **JPG/PNG screenshot under 5 MB** in the same WhatsApp chat. Free, local **Tesseract.js** OCR extracts visible amount, payee, success text and transaction reference; no image is sent to Groq. English OCR data downloads on first use and is cached. Unreadable images remain available for manual review. The image is stored under ignored `data/payment-proofs/`, with its hash and checks in the database. Back up both the database and this directory.

The app shows **Awaiting verification** in payment records and Follow-ups. Open a review → **View original screenshot** → check receipt in your own bank/UPI app → acknowledge receipt → **Confirm received · Update khata**. A screenshot alone never clears debt. Confirmation creates one receipt, marks the invoice paid, reduces the server balance, and updates Home, Khata, history, Ask and PDFs through polling. Rejection keeps the debt unchanged and permits a new screenshot. Repeated confirmations, reused images across invoices, stale proof IDs and already-used readable UPI references cannot create duplicate receipts. This version supports full-invoice settlement only; partial payments/refunds and bank/provider webhooks are not implemented.

`ORDER STATUS`, `BALANCE`, `MY ORDERS` and `INVOICE` read the resulting payment state from the database. Screenshot matching is not bank verification. Use a payment provider/acquiring-bank integration with authenticated settlement callbacks for automatic confirmation; see [NPCI UPI FAQs](https://www.npci.org.in/what-we-do/upi/faqs). [Tesseract.js](https://github.com/naptha/tesseract.js) runs locally without a paid OCR API.

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

Add more products/aliases in `catalogue.json` and restart. Existing product prices are stored in the configured database and edited through the protected catalogue API; reloading the seed file does not overwrite saved prices. Historical invoices freeze their item prices. PDFs use built-in Latin fonts and INR currency text; a non-Latin customer name falls back to their phone number on the PDF. The app retains Unicode names and text.

## Data and behaviour

- When `MONGODB_URI` is set, MongoDB stores the catalogue, customers, messages, invoices, ledger, outbox and pending AI conversations. A configured MongoDB failure stops startup; it never silently books orders in a different database.
- When `MONGODB_URI` is omitted, `data/dukanpe.sqlite` provides offline persistence. Existing SQLite demo data is preserved, without automatic migration into the configured cloud database.
- `data/whatsapp-session/`: LocalAuth session. Restarting restores the session; scanning is needed again when WhatsApp invalidates it.
- Customer identity is a resolved phone number when available, otherwise the WhatsApp chat ID. Display names never match or merge customer accounts. Existing fictional app customers are not linked by name.
- An invoice, one positive ledger debit, the customer balance increment, incoming message and delivery job are committed in one MongoDB transaction. Unique message/invoice indexes prevent duplicate charges; concurrent orders for the same customer update the balance atomically. The local adapter uses a SQLite transaction.
- Incoming one-to-one text and payment screenshot images after linking are handled. Groups, statuses, broadcasts, outgoing messages and old-history messages are ignored. Unrelated images cannot settle an invoice.
- A PDF-send failure or restart during sending is marked **uncertain**. Check the customer chat before choosing **Resend same invoice**. Resending never creates another debit. Only confirmed library send results are labelled sent; this is not a read/recipient-delivery guarantee.
- The app imports one confirmed credit-sale record per invoice. Invoice and source-message records are evidence and do not add debt again. Repeated polling is idempotent and existing local records are preserved.
- Invoice balances cover the bot's orders only. Local manual app entries are included in the customer account balance but are not sent back to this first-version bot database.
- New app workspaces start empty. A storage migration removes known fictional records and their opening balances while preserving real manual entries and live WhatsApp records. The normal API snapshot excludes simulated orders; the explicit development endpoint and test fixtures remain separate. A live customer has its own phone/chat identity.
- The server remembers an enabled connection and restores it automatically after a process restart using the saved session. Choosing **Stop WhatsApp replies** disables automatic reconnection while preserving the session. Disconnecting the app only stops app sync.

## Local API

Every `/api/*` route requires `Authorization: Bearer <pairing-code>`. The pairing code stays out of Expo public environment variables: native uses Expo SecureStore; web keeps pairing in tab-scoped sessionStorage. Public health returns no financial information. CORS allows the local Expo dev origin and exact origins listed in `CORS_ORIGINS`.

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | Process health |
| POST | `/connect/whatsapp` | Open/resume a fresh WhatsApp QR challenge; no business records or API credential before scan |
| POST | `/connect/whatsapp/status` | Poll using the pending-link capability; verified scan returns a device credential |
| GET | `/api/snapshot` | Bot status/QR, products and invoice/khata data |
| POST | `/api/whatsapp/start` | Start headless WhatsApp Web and generate a QR |
| POST | `/api/whatsapp/stop` | Stop without logging out |
| PUT | `/api/catalogue/:id` | Update unit price using integer `pricePaise` |
| POST | `/api/demo/order` | Simulated order; `messageId`, `name`, `phone`, `body` |
| GET | `/api/invoices/:id/pdf-link` | Issue a signed PDF link valid for five minutes |
| POST | `/api/invoices/:id/resend` | Send the same real invoice after checking delivery |
| POST | `/api/pairing/qr` | Authenticated generation of a single-use, two-minute phone setup QR |
| POST | `/pairing/exchange` | Exchange a valid setup ticket once for the app pairing credential; rate limited |
| GET | `/api/payments/:id/proof-link` | Signed screenshot link, five-minute expiry |
| POST | `/api/payments/:id/review` | Current `proofId`, `decision` confirmed/rejected; confirmation requires `receivedInAccount: true` |

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
| `dukanpe_payments` | Latest screenshot checks, expected amount/payee, review/confirmed/rejected state and merchant confirmation time |
| `dukanpe_payment_proofs` | Unique screenshot hashes linked to invoice IDs to prevent reuse |

`server/data/`, browser sessions, pairing credentials and the database are Git-ignored. The server binds the LAN for phone testing. Do not expose this prototype directly to the public internet: a deployment needs HTTPS, proper merchant accounts/authorisation, backups, stronger operational controls and a production persistence design. Keep this Node process running for WhatsApp replies; Expo Go alone cannot host it.

## Verify

```powershell
npm test
# Optional real MongoDB integration check, run from server/ with a configured .env:
node --env-file=.env --test test/mongo.test.js
```

Tests cover parsing, greeting/menu flow, complete-order rejection, invoice/debit deduplication, account separation, frozen pricing, persistence/restart, PDF output, mocked WhatsApp delivery, protected API/PDF links, Groq response validation, AI confirmation, expiry, cancellation and price-change review. The MongoDB integration test uses fresh uniquely named disposable collections, verifies transactions/concurrent deduplication, then removes only those test collections. Tests send no real WhatsApp messages. Physical delivery must be tested from a separate WhatsApp number after linking.

Customer-agent tests additionally cover live database price changes, sender-scoped balance/history/invoice reads, equal-name account separation, missing phone resolution, cross-account invoice refusal, draft follow-ups/edits, repeat orders, PDF copies and current WhatsApp message-key variants.

Payment tests cover exact QR parameters, numbered checkout, screenshot scope/mismatches, OCR failure, signed-image access, explicit merchant acknowledgement, rejection/resubmission, duplicate receipt/UTR protection and live-only snapshots. MongoDB integration checks concurrent receipt confirmation in disposable collections. No test transfers money or sends a real WhatsApp message.

## WhatsApp Web compatibility

The library is pinned to 1.34.7. `scripts/patch-whatsapp.js` runs after installation and before startup. It applies two guarded, idempotent changes: looking up the outgoing message using `_serialized` or `$1`, and discarding an inherited media `__x_id` field before constructing the outgoing message. These address the observed missing send confirmations and PDF getter error, documented in upstream [message-key issue #201852](https://github.com/wwebjs/whatsapp-web.js/issues/201852) and [media issue #201921](https://github.com/wwebjs/whatsapp-web.js/issues/201921). The script refuses unknown package versions/source layouts so an upgrade cannot silently retain an invalid patch. Review and remove it when an upstream release includes both fixes.

See [Groq models](https://console.groq.com/docs/models), [free-plan limits](https://console.groq.com/docs/rate-limits) and the [MongoDB Node driver](https://www.mongodb.com/docs/drivers/node/current/).

This unofficial library can break when WhatsApp Web changes and does not guarantee protection from account restrictions. See the [maintainer's notice](https://github.com/wwebjs/whatsapp-web.js), [LocalAuth guide](https://wwebjs.dev/guide/creating-your-bot/authentication.html) and [document sending guide](https://wwebjs.dev/guide/creating-your-bot/handling-attachments.html).

The installed whatsapp-web.js dependency tree currently reports upstream high-severity advisories in Puppeteer's browser-download/proxy dependencies, including `extract-zip` without an available fixed release. This setup was installed without downloading a browser and uses the installed Chrome. Do not force npm's suggested downgrade of whatsapp-web.js; review upstream updates before a production deployment.

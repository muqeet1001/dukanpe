# Dukanpe WhatsApp order bot

Node.js + Express + whatsapp-web.js + SQLite + PDFKit. This is a single-shop local prototype. It connects through WhatsApp Web and a QR, without Meta Cloud API credentials.

## Run on Windows

Use Node **22.14 or newer**. From the app folder:

```powershell
npm run bot:install
npm run bot
```

The server uses port 4000 and prints its LAN address. Keep the Expo phone and computer on the same Wi-Fi. Chrome is automatically detected on Windows, with Edge as a fallback. You can set `CHROME_EXECUTABLE_PATH` in `server/.env` for a different installation; see `.env.example`. If using an installed browser, `PUPPETEER_SKIP_DOWNLOAD=true` during dependency installation avoids Puppeteer's browser download. Otherwise Puppeteer installs its bundled browser.

1. Open Dukanpe → **Khata → WhatsApp orders**.
2. Enter the bot server URL. Web uses `http://localhost:4000`; a phone uses the computer's LAN address.
3. Paste the private code from **server/data/pairing-code.txt** and choose **Pair bot server**. Do not commit or share that code.
4. Check **Your prices**. The initial catalogue contains sample prices; tap a product to change its price.
5. Choose **Link WhatsApp**. On the business/test phone open WhatsApp → Linked devices → Link a device, then scan the QR shown in Dukanpe.
6. From a **different phone**, message `MENU`, then `2 kg rice, 1 kg sugar`.
7. The customer receives an unpaid order invoice as a PDF with an itemised caption. Dukanpe imports the customer, invoice, original order and one credit sale into khata within about 2.5 seconds while open.

The first sample order is INR 165: 2 kg rice at INR 60/kg plus 1 kg sugar at INR 45/kg. It increases customer dues, with no receipt or paid balance fabricated.

## Demonstrate without connecting a WhatsApp account

After pairing the server, use **Try an order**. It runs the same parser, database transaction, PDF generation and app-sync path. Simulated customers are separate from real contacts and their invoices can never be sent by the live bot. Repeating **Check same order again** reuses the same message ID and does not add another debit.

## Order formats

- `2 kg rice, 1 kg sugar`
- `rice 2kg` on one line and `sugar 1kg` on the next
- `500 g chawal aur 1 litre oil`
- `५०० ग्राम चावल और १ किलो चीनी`
- `MENU`, `HELP`, `HI`

This is catalogue matching, not a hosted AI model. It accepts up to ten order lines with explicit quantities and known items. Unsupported products, wrong units, mixed payment instructions, vague requests and unsupported units produce clarification; the whole order remains unbilled. Zero/negative quantities and fractional packets are rejected. Gram/ml quantities convert to kg/litre, and money is rounded once per combined product line to integer paise.

Add more products/aliases in `catalogue.json` and restart. Existing product prices are stored in SQLite and edited from the app; reloading the seed file does not overwrite saved prices. Historical invoices freeze their item prices. PDFs use built-in Latin fonts and INR currency text; a non-Latin customer name falls back to their phone number on the PDF. The app and WhatsApp caption retain Unicode names and text.

## Data and behaviour

- `data/dukanpe.sqlite`: customers, catalogue, incoming message IDs, invoices, ledger and delivery outbox.
- `data/whatsapp-session/`: LocalAuth session. Restarting restores the session; scanning is needed again when WhatsApp invalidates it.
- Customer identity is a resolved phone number when available, otherwise the WhatsApp chat ID. Display names never match or merge customer accounts. Existing fictional app customers are not linked by name.
- An invoice, one positive ledger debit and its delivery job are committed in one SQLite transaction. WhatsApp redelivery cannot create another debit.
- Only incoming one-to-one text messages after linking are handled. Groups, statuses, broadcasts, outgoing messages and old-history messages are ignored. The bot does not read invoices/images or record payments in this version.
- A PDF-send failure or restart during sending is marked **uncertain**. Check the customer chat before choosing **Resend same invoice**. Resending never creates another debit. Only confirmed library send results are labelled sent; this is not a read/recipient-delivery guarantee.
- The app imports one confirmed credit-sale record per invoice. Invoice and source-message records are evidence and do not add debt again. Repeated polling is idempotent and existing local records are preserved.
- Invoice balances cover the bot's orders only. Local manual app entries are included in the customer account balance but are not sent back to this first-version bot database.
- Bot records coexist with the app's fictional sample shop. A live customer has its own phone/chat identity. App totals are labelled **Sample + WhatsApp** when real bot entries exist.
- Stopping WhatsApp disables replies and preserves its session. Disconnecting the app only stops app sync. Resetting sample data does not delete server invoices; paired sync imports them again.

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

`server/data/`, browser sessions, pairing credentials and the database are Git-ignored. The server binds the LAN for phone testing. Do not expose this prototype directly to the public internet: a deployment needs HTTPS, proper merchant accounts/authorisation, backups, stronger operational controls and a production persistence design. Keep this Node process running for WhatsApp replies; Expo Go alone cannot host it.

## Verify

```powershell
npm test
```

Tests cover parsing/conversion, complete-order rejection, invoice/debit deduplication, account separation, immutable pricing, persistence/restart, PDF output, mocked WhatsApp send/failure and protected API/PDF links. They send no real messages. Physical WhatsApp delivery must be tested after the owner scans the QR.

This unofficial library can break when WhatsApp Web changes and does not guarantee protection from account restrictions. See the [maintainer's notice](https://github.com/wwebjs/whatsapp-web.js), [LocalAuth guide](https://wwebjs.dev/guide/creating-your-bot/authentication.html) and [document sending guide](https://wwebjs.dev/guide/creating-your-bot/handling-attachments.html).

The installed whatsapp-web.js dependency tree currently reports upstream high-severity advisories in Puppeteer's browser-download/proxy dependencies, including `extract-zip` without an available fixed release. This setup was installed without downloading a browser and uses the installed Chrome. Do not force npm's suggested downgrade of whatsapp-web.js; review upstream updates before a production deployment.

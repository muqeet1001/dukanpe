# Dukanpe

A mobile merchant workspace built with React Native, Expo and TypeScript. The interface uses Paytm's published app screen as a visual reference: a compact profile and logo header, circular navy action icons, system typography, white service panels and cyan accents. The Dukanpe wordmark and app icon use navy and cyan, with actual source-app logos bundled locally; see assets/README.md for their public sources. Four tabs keep the product simple: **Home, Khata, Follow-ups and Ask**.

## Run

Requirements: Node.js 22.13 or newer and npm.

    npm install
    npm run web

For native development:

    npm start

This project uses Expo SDK 57 for the current Expo Go phone preview. Put the phone and computer on the same Wi-Fi, run the command below, and scan the terminal QR using Expo Go:

    npx expo start --go --lan

If your Expo Go is older, update it to a version supporting SDK 57. For an Android development build with the SDK/JDK installed:

    npx expo run:android

Native iOS builds require macOS/Xcode or an EAS build. No account, API key or paid service is required for the web demo.

## What works

- A Node + whatsapp-web.js bot with QR linking, Groq AI conversation, MongoDB persistence, PDF invoices and automatic khata sync. See [bot setup](server/README.md).
- WhatsApp answers from the saved catalogue and the sender's own balances, orders and invoices, with pending-order edits, repeat orders and invoice PDF copies.
- Phone setup by scanning a single-use QR from the computer, with manual pairing as a fallback.
- Pay now / Khata choices, exact-amount merchant UPI QRs, local screenshot OCR and merchant receipt confirmation. Paid invoices, customer balances and Home totals update together.
- Home with three separate summary boxes above search: white for recorded sales, light blue for confirmed receipts and navy for customer dues.
- Home search carries the typed query into matching records; quick actions open sales, udhaar and payment history.
- Recent activity on Home shows the five newest records, with a link to the complete searchable history.
- Search across saved WhatsApp orders, invoices, sales and payment records.
- Source-filtered records and supporting evidence.
- Screenshot payment reviews linked to the correct invoice and customer.
- Khata balances and a connected customer timeline.
- Cash sales and credit sales, with validation and duplicate-command protection.
- Follow-up filters, evidence, completion/reopening and editable reminder drafts.
- Explicit copy-to-clipboard for reminder drafts. No messages are sent automatically.
- An in-app assistant that answers supported English/Hindi business questions using deterministic calculations and links to saved records.
- Device text-to-speech for answers where available.
- Empty new workspaces, migration of old sample transactions, local persistence and visible storage-error handling.
- Responsive web preview and native safe-area/bottom-tab layouts.

## Demo script

1. Start the bot, pair the computer, and link the business WhatsApp account. Set the shop name and merchant UPI address in the private server environment.
2. In Expo Go, choose Scan setup QR and scan the computer's Connect phone app QR.
3. From another WhatsApp number, send HI and place an order. Natural-language orders require CONFIRM.
4. See the invoice, one sale and customer dues appear in Dukanpe. Choose 2 Khata to retain the debt or 1 Pay now to receive the exact-amount UPI QR.
5. After paying using the customer's own UPI app, send a screenshot in the same WhatsApp chat. It appears in Follow-ups; the balance is unchanged.
6. The merchant checks their own received payment, opens the screenshot review, acknowledges receipt and confirms. The invoice becomes paid, customer dues decrease and Home receipts increase once. Use BALANCE or INVOICE in WhatsApp to see the saved result.

The app contains no fictional transactions in normal use. Development fixtures and simulated API orders are excluded from the normal data feed.

## Project structure

    src/app/                  Expo Router screens and four tabs
    src/components/ui.tsx     Shared native UI components
    src/lib/domain.ts        Types, financial rules, fixture cleanup and record-based answers
    src/state/business.tsx   Shared state and AsyncStorage persistence
    src/theme.ts             Colour and font tokens
    tests/domain.test.ts     Financial and idempotency checks

## Check

    npm run typecheck
    npm run lint
    npm test
    npm run export:web

## Integration boundary

The mobile app starts empty. The Node bot connects WhatsApp after its owner links the account. Groq helps interpret text; prices, balances, order booking and receipt accounting come from validated database operations. MongoDB persists bot customers, invoices, khata and payment review metadata. Tesseract.js reads submitted screenshot images locally. Screenshots alone never prove bank settlement: merchant confirmation is required. This version does not read GPay/PhonePe histories, capture Android notifications, read SMS, handle partial settlements/refunds or receive bank/provider webhooks. Speech input is not implemented; the speaker uses device text-to-speech.

AsyncStorage is an unencrypted device cache for records; credentials use native SecureStore or web sessionStorage. The server remains authoritative for WhatsApp orders and payments. Manual entries stay on the device. See the [bot setup](server/README.md) for implemented behaviour; architecture documents also describe future integrations.

Navigation, financial rules and source evidence are separated from the API and persistence adapters.

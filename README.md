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

- A Node + whatsapp-web.js order bot with QR linking, product prices, PDF invoices and automatic khata sync. See [bot setup](server/README.md).
- Home with three separate summary boxes above search: white for recorded sales, light blue for confirmed receipts and navy for customer dues.
- Home search carries the typed query into matching records; quick actions open sales, udhaar and payment history.
- Recent activity on Home shows the five newest records, with a link to the complete searchable history.
- Search across the sample WhatsApp conversations, bills, sales and payment records.
- Source-filtered records and original sample evidence.
- Payment confirmation with customer selection or an unmatched receipt.
- Khata balances and a connected customer timeline.
- Cash sales and credit sales, with validation and duplicate-command protection.
- Follow-up filters, evidence, completion/reopening and editable reminder drafts.
- Explicit copy-to-clipboard for reminder drafts. No messages are sent automatically.
- A local demo assistant that answers supported English/Hindi business questions using deterministic calculations and links to records.
- Device text-to-speech for answers where available.
- Local persistence, visible storage-error handling and a confirmed sample-data reset.
- Responsive web preview and native safe-area/bottom-tab layouts.

## Demo script

1. On Home, see recorded sales of INR 12,450, confirmed receipts of INR 9,200 and customer dues of INR 18,750.
2. Search for Roy, then open his INR 200 PhonePe sample alert. His confirmed khata still shows INR 500.
3. Confirm the payment for Roy. His balance becomes INR 300 and receipts increase by INR 200. Repeat confirmation does not double count.
4. Open Follow-ups and inspect the supplier quote/invoice difference, or prepare a payment reminder.
5. Ask “What does Roy owe?” and open the supporting records.
6. Add a cash or credit sale, refresh, and verify that the entry persists.

Use Your sources → Restore fresh sample data to restart the demo. Sample timestamps are created on first launch/reset; a demo reopened on a later day correctly has different “today” totals until it is reset.

## Project structure

    src/app/                  Expo Router screens and four tabs
    src/components/ui.tsx     Shared native UI components
    src/lib/domain.ts        Types, sample records, financial rules and demo answers
    src/state/business.tsx   Shared state and AsyncStorage persistence
    src/theme.ts             Colour and font tokens
    tests/domain.test.ts     Financial and idempotency checks

## Check

    npm run typecheck
    npm run lint
    npm test
    npm run export:web

## Integration boundary

The mobile app starts with fictional sample records. The separate Node bot can connect WhatsApp after its owner scans a linking QR; clear catalogue orders generate unpaid PDF invoices and sync to customer khata. The bot's simulated chat works without WhatsApp. It does not access real GPay/PhonePe histories, capture Android notifications, read SMS, run OCR, implement production merchant accounts or call a hosted AI model. The voice control opens Ask; speech input is not implemented. The speaker button uses device text-to-speech.

AsyncStorage is an unencrypted demo store and must not hold production financial records or credentials. The server remains authoritative when backend services are connected. See the [app architecture](docs/expo-mern-app-architecture.md) and [automatic-payment architecture](docs/automatic-payment-tracking-architecture.md) for the native capture, ingestion, MongoDB, evidence and confirmation design.

Navigation, financial rules and source evidence are separated so a real API can replace the sample state without rebuilding the screens.

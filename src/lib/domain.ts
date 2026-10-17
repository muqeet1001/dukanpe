export type Source = 'PhonePe' | 'GPay' | 'WhatsApp' | 'Bill' | 'Manual';
export type RecordKind = 'sale' | 'receipt' | 'invoice' | 'message';
export type RecordStatus = 'confirmed' | 'review' | 'saved' | 'open';
export type Party = {
  id: string;
  name: string;
  initials: string;
  color: string;
  openingBalancePaise: number;
  note: string;
  phone?: string;
  origin?: 'whatsapp-bot';
};
export type BusinessRecord = {
  id: string;
  kind: RecordKind;
  title: string;
  subtitle: string;
  partyId?: string;
  amountPaise?: number;
  source: Source;
  status: RecordStatus;
  createdAt: string;
  evidence: string;
  note?: string;
  linkedSaleId?: string;
  origin?: 'whatsapp-bot';
  invoiceId?: string;
  isDemo?: boolean;
};
export type FollowUp = {
  id: string;
  kind: 'collection' | 'invoice' | 'delivery' | 'payment';
  title: string;
  description: string;
  due: string;
  priority: 'high' | 'normal';
  status: 'open' | 'done';
  partyId?: string;
  recordId?: string;
  amountPaise?: number;
  evidence: string;
};
export type BusinessState = {
  version: 1;
  parties: Party[];
  records: BusinessRecord[];
  followUps: FollowUp[];
};
export type SaleInput = {
  id: string;
  partyId?: string;
  description: string;
  amountPaise: number;
  paid: boolean;
  createdAt: string;
};
export type Action =
  | { type: 'hydrate'; state: BusinessState }
  | { type: 'confirm-payment'; id: string; partyId?: string | null }
  | { type: 'add-sale'; input: SaleInput }
  | { type: 'follow-up'; id: string; done: boolean }
  | { type: 'import-whatsapp'; parties: Party[]; records: BusinessRecord[] }
  | { type: 'reset'; state: BusinessState };

export function money(paise: number): string {
  return '₹' + (paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function parseAmount(value: string): number | null {
  const clean = value.trim().replace(/,/g, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, fraction = ''] = clean.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

export function partyBalance(state: BusinessState, partyId: string): number {
  const party = state.parties.find((item) => item.id === partyId);
  return state.records.reduce((total, record) => {
    if (record.partyId !== partyId || record.status !== 'confirmed') return total;
    if (record.kind === 'sale') return total + (record.amountPaise ?? 0);
    if (record.kind === 'receipt') return total - (record.amountPaise ?? 0);
    return total;
  }, party?.openingBalancePaise ?? 0);
}

export function sameLocalDay(first: string, second: Date): boolean {
  const date = new Date(first);
  return date.getFullYear() === second.getFullYear()
    && date.getMonth() === second.getMonth() && date.getDate() === second.getDate();
}

export function totals(state: BusinessState, today = new Date()) {
  const confirmedToday = state.records.filter((record) =>
    record.status === 'confirmed' && sameLocalDay(record.createdAt, today));
  return {
    sales: confirmedToday.filter((record) => record.kind === 'sale')
      .reduce((sum, record) => sum + (record.amountPaise ?? 0), 0),
    receipts: confirmedToday.filter((record) => record.kind === 'receipt')
      .reduce((sum, record) => sum + (record.amountPaise ?? 0), 0),
    dues: state.parties.reduce((sum, party) => sum + Math.max(0, partyBalance(state, party.id)), 0),
    review: state.records.filter((record) => record.status === 'review').length,
    followUps: state.followUps.filter((item) => item.status === 'open').length,
  };
}

export function businessReducer(state: BusinessState, action: Action): BusinessState {
  switch (action.type) {
    case 'import-whatsapp': {
      const validParties = action.parties.filter((party) => party.id.startsWith('wa-customer-') && party.origin === 'whatsapp-bot'
        && typeof party.name === 'string' && party.openingBalancePaise === 0);
      const partyIds = new Set([...state.parties.filter((party) => party.origin === 'whatsapp-bot'), ...validParties].map((party) => party.id));
      const parties = new Map(state.parties.map((party) => [party.id, party]));
      const records = new Map(state.records.map((record) => [record.id, record]));
      for (const party of validParties) parties.set(party.id, party);
      for (const record of action.records) {
        if (record.isDemo || record.origin !== 'whatsapp-bot' || record.source !== 'WhatsApp' || !record.invoiceId
          || !record.partyId || !partyIds.has(record.partyId) || !['sale', 'invoice', 'message', 'receipt'].includes(record.kind)
          || !record.id.startsWith('wa-' + record.kind + '-') || !Number.isFinite(Date.parse(record.createdAt))
          || (record.kind !== 'message' && (!Number.isSafeInteger(record.amountPaise) || (record.amountPaise ?? 0) < 1))
          || (record.kind === 'receipt' ? !['review', 'confirmed'].includes(record.status) : record.status !== (record.kind === 'sale' ? 'confirmed' : 'saved'))) continue;
        if (records.has(record.id) && records.get(record.id)?.origin !== 'whatsapp-bot') continue;
        if (record.kind === 'receipt' && record.status === 'review' && records.get(record.id)?.status === 'confirmed') continue;
        records.set(record.id, record);
      }
      // A rejected proof disappears from the authoritative snapshot; remove its review row.
      const incomingIds = new Set(action.records.map((r) => r.id));
      for (const [id, record] of records) if (record.origin === 'whatsapp-bot' && record.kind === 'receipt' && record.status === 'review' && !incomingIds.has(id)) records.delete(id);
      const reviewTasks: FollowUp[] = [...records.values()].filter((r) => r.origin === 'whatsapp-bot' && r.kind === 'receipt').map((r) => ({
        id: 'wa-payment-' + r.invoiceId, kind: 'payment', title: r.status === 'review' ? 'Review ' + r.title : r.title,
        description: 'Check the payment screenshot against money received in your account.', due: 'Today', priority: 'high',
        status: r.status === 'review' ? 'open' : 'done', partyId: r.partyId, recordId: r.id, amountPaise: r.amountPaise, evidence: r.evidence,
      }));
      const next = { ...state, parties: [...parties.values()], records: [...records.values()], followUps: [...state.followUps.filter((f) => !f.id.startsWith('wa-payment-')), ...reviewTasks] };
      return JSON.stringify(next) === JSON.stringify(state) ? state : next;
    }
    case 'hydrate':
    case 'reset':
      return action.state;
    case 'confirm-payment': {
      const record = state.records.find((item) => item.id === action.id);
      if (!record || record.origin === 'whatsapp-bot' || record.kind !== 'receipt' || record.status !== 'review') return state;
      const partyId = action.partyId === null ? undefined : action.partyId ?? record.partyId;
      if (partyId && !state.parties.some((party) => party.id === partyId)) return state;
      return {
        ...state,
        records: state.records.map((item) => item.id === action.id
          ? { ...item, partyId, status: 'confirmed', subtitle: 'Merchant confirmed · UPI', note: 'Confirmed from a sample device alert. This is not bank verification.' }
          : item),
        followUps: state.followUps.map((item) => item.recordId === action.id && item.kind === 'payment'
          ? { ...item, status: 'done' } : item),
      };
    }
    case 'add-sale': {
      const { input } = action;
      if (state.records.some((record) => record.id === input.id)) return state;
      if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) return state;
      if (input.partyId && !state.parties.some((party) => party.id === input.partyId)) return state;
      if (!input.paid && !input.partyId) return state;
      const party = state.parties.find((item) => item.id === input.partyId);
      const sale: BusinessRecord = {
        id: input.id, kind: 'sale', title: input.description.trim() || 'Shop sale',
        subtitle: (party?.name ?? 'Walk-in customer') + (input.paid ? ' · Paid' : ' · On credit'),
        partyId: input.partyId, amountPaise: input.amountPaise,
        source: 'Manual', status: 'confirmed', createdAt: input.createdAt,
        evidence: 'Sale recorded by you in Dukanpe. ' + (input.paid ? 'Paid at the counter.' : 'Added to customer khata.'),
      };
      const records = [sale];
      if (input.paid) records.push({
        ...sale, id: input.id + '-receipt', kind: 'receipt',
        title: 'Payment for ' + sale.title, subtitle: 'Merchant recorded · Cash',
        linkedSaleId: sale.id, evidence: 'Cash receipt recorded with sale ' + sale.id + '.',
      });
      return { ...state, records: [...records, ...state.records] };
    }
    case 'follow-up':
      return { ...state, followUps: state.followUps.map((item) => item.id === action.id
        ? { ...item, status: action.done ? 'done' : 'open' } : item) };
    default:
      return state;
  }
}

export const createEmptyState = (): BusinessState => ({ version: 1, parties: [], records: [], followUps: [] });

export function removeDemoData(state: BusinessState): BusinessState {
  const fixture = createDemoState();
  const sampleRecords = new Set(fixture.records.map((r) => r.id));
  const sampleTasks = new Set(fixture.followUps.map((f) => f.id));
  const sampleParties = new Set(fixture.parties.map((p) => p.id));
  const records = state.records.filter((r) => !sampleRecords.has(r.id) && !r.isDemo);
  const usedParties = new Set(records.map((r) => r.partyId));
  return { ...state, records, followUps: state.followUps.filter((f) => !sampleTasks.has(f.id)),
    parties: state.parties.filter((p) => usedParties.has(p.id) || (!sampleParties.has(p.id) && p.origin !== 'whatsapp-bot'))
      .map((p) => sampleParties.has(p.id) ? { ...p, openingBalancePaise: 0, note: 'Customer linked to your recorded entries' } : p) };
}

// Retained only as an explicit test fixture. Production starts empty.
export function createDemoState(now = new Date()): BusinessState {
  const at = (hours: number, minutes: number) => {
    const date = new Date(now); date.setHours(hours, minutes, 0, 0); return date.toISOString();
  };
  return {
    version: 1,
    parties: [
      { id: 'roy', name: 'Roy Sharma', initials: 'RS', color: 'blue', openingBalancePaise: 0, note: 'Regular customer · Payment promised today' },
      { id: 'neha', name: 'Neha Gupta', initials: 'NG', color: 'pink', openingBalancePaise: 400000, note: 'Monthly grocery account' },
      { id: 'imran', name: 'Imran Khan', initials: 'IK', color: 'mint', openingBalancePaise: 400000, note: 'Usually pays every Saturday' },
      { id: 'meena', name: 'Meena Patel', initials: 'MP', color: 'peach', openingBalancePaise: 750000, note: 'Household essentials · Monthly account' },
    ],
    records: [
      { id: 'roy-alert', kind: 'receipt', title: 'Roy · Payment alert', subtitle: 'PhonePe · Needs confirmation', partyId: 'roy', amountPaise: 20000, source: 'PhonePe', status: 'review', createdAt: at(11, 42), evidence: 'Sample PhonePe alert: Received ₹200 from Roy Sharma. Ref DEMO-UPI-001.', note: 'Imported alert, not a bank-verified payment. Confirm the money and customer before updating khata.' },
      { id: 'supplier-invoice', kind: 'invoice', title: 'Shree Foods invoice', subtitle: 'Bill saved · 5 bags of rice', amountPaise: 250000, source: 'Bill', status: 'saved', createdAt: at(11, 35), evidence: 'Sample invoice SF-1042: 5 bags of rice × ₹500 = ₹2,500. Previous accepted quote: 5 × ₹480 = ₹2,400.', note: 'Possible ₹100 difference from the accepted quote. Review with your supplier.' },
      { id: 'roy-message', kind: 'message', title: 'Roy · WhatsApp', subtitle: 'Order request · Open', partyId: 'roy', source: 'WhatsApp', status: 'open', createdAt: at(11, 30), evidence: 'Sample WhatsApp message from Roy: “2 kg atta aur 1 litre oil rakh dena. Bache hue paise aaj de dunga.”', note: 'This request has not been counted as a completed sale.' },
      { id: 'neha-alert', kind: 'receipt', title: 'Neha · Payment alert', subtitle: 'GPay · Needs confirmation', partyId: 'neha', amountPaise: 35000, source: 'GPay', status: 'review', createdAt: at(11, 20), evidence: 'Sample Google Pay alert: ₹350 received from Neha Gupta. Ref DEMO-UPI-002.' },
      { id: 'unknown-alert', kind: 'receipt', title: 'Unmatched payment', subtitle: 'PhonePe · Customer unknown', amountPaise: 50000, source: 'PhonePe', status: 'review', createdAt: at(11, 12), evidence: 'Sample PhonePe alert: ₹500 received. Customer name unavailable. Ref DEMO-UPI-003.' },
      { id: 'delivery-note', kind: 'message', title: 'Shree Foods · Delivery', subtitle: 'WhatsApp · Tomorrow morning', source: 'WhatsApp', status: 'open', createdAt: at(10, 50), evidence: 'Sample supplier message: “Your rice order will arrive tomorrow before 10 am.”' },
      { id: 'sale-roy', kind: 'sale', title: 'Groceries for Roy', subtitle: 'Roy Sharma · On credit', partyId: 'roy', amountPaise: 50000, source: 'Manual', status: 'confirmed', createdAt: at(10, 40), evidence: 'Confirmed sale: household groceries, ₹500, credit to Roy Sharma.' },
      { id: 'sale-neha', kind: 'sale', title: 'Monthly groceries', subtitle: 'Neha Gupta · On credit', partyId: 'neha', amountPaise: 320000, source: 'Manual', status: 'confirmed', createdAt: at(10, 25), evidence: 'Confirmed grocery sale to Neha Gupta: ₹3,200.' },
      { id: 'sale-imran', kind: 'sale', title: 'Household essentials', subtitle: 'Imran Khan · On credit', partyId: 'imran', amountPaise: 240000, source: 'Manual', status: 'confirmed', createdAt: at(10, 5), evidence: 'Confirmed sale to Imran Khan: ₹2,400.' },
      { id: 'sale-meena', kind: 'sale', title: 'Weekly groceries', subtitle: 'Meena Patel · On credit', partyId: 'meena', amountPaise: 210000, source: 'Manual', status: 'confirmed', createdAt: at(9, 50), evidence: 'Confirmed sale to Meena Patel: ₹2,100.' },
      { id: 'sale-walkin', kind: 'sale', title: 'Counter sales', subtitle: 'Walk-in customers · Paid', amountPaise: 425000, source: 'Manual', status: 'confirmed', createdAt: at(9, 30), evidence: 'Confirmed sample counter sales: ₹4,250, fully received in cash.' },
      { id: 'cash-walkin', kind: 'receipt', title: 'Counter collections', subtitle: 'Cash · Merchant recorded', amountPaise: 425000, source: 'Manual', status: 'confirmed', createdAt: at(9, 30), linkedSaleId: 'sale-walkin', evidence: 'Cash received for counter sales: ₹4,250.' },
      { id: 'receipt-neha', kind: 'receipt', title: 'Neha · Payment received', subtitle: 'UPI · Merchant confirmed', partyId: 'neha', amountPaise: 250000, source: 'GPay', status: 'confirmed', createdAt: at(9, 15), evidence: 'Sample ₹2,500 receipt confirmed by the merchant for Neha Gupta.' },
      { id: 'receipt-imran', kind: 'receipt', title: 'Imran · Payment received', subtitle: 'UPI · Merchant confirmed', partyId: 'imran', amountPaise: 245000, source: 'PhonePe', status: 'confirmed', createdAt: at(9, 5), evidence: 'Sample ₹2,450 receipt confirmed by the merchant for Imran Khan.' },
    ],
    followUps: [
      { id: 'roy-promise', kind: 'collection', title: 'Roy promised to pay today', description: 'A promise from your WhatsApp chat, linked to his khata.', due: 'Today', priority: 'high', status: 'open', partyId: 'roy', recordId: 'roy-message', evidence: '“Bache hue paise aaj de dunga.” — Roy, sample WhatsApp message' },
      { id: 'invoice-check', kind: 'invoice', title: 'An invoice is ₹100 higher', description: 'Shree Foods billed ₹500 per bag. Your accepted quote was ₹480.', due: 'Today', priority: 'high', status: 'open', recordId: 'supplier-invoice', amountPaise: 10000, evidence: 'Accepted quote: 5 × ₹480 = ₹2,400. Invoice: 5 × ₹500 = ₹2,500.' },
      { id: 'payment-review', kind: 'payment', title: 'Confirm Roy’s ₹200 payment', description: 'An alert was found. Review it before updating his balance.', due: 'Today', priority: 'normal', status: 'open', partyId: 'roy', recordId: 'roy-alert', amountPaise: 20000, evidence: 'Sample PhonePe transaction reference DEMO-UPI-001.' },
      { id: 'supplier-delivery', kind: 'delivery', title: 'Rice delivery expected tomorrow', description: 'Shree Foods promised delivery before 10 am.', due: 'Tomorrow', priority: 'normal', status: 'open', recordId: 'delivery-note', evidence: '“Your rice order will arrive tomorrow before 10 am.” — sample supplier chat' },
    ],
  };
}

export type AssistantAnswer = { text: string; recordIds: string[]; partyId?: string };
export function answerQuestion(question: string, state: BusinessState, hindi = false): AssistantAnswer {
  const q = question.toLowerCase();
  const summary = totals(state);
  const party = state.parties.find((item) => q.includes(item.name.split(' ')[0].toLowerCase()));
  if (party) {
    const balance = partyBalance(state, party.id);
    const pending = state.records.filter((record) => record.partyId === party.id && record.status === 'review');
    return {
      text: hindi
        ? party.name + ' का पक्का बकाया ' + money(balance) + ' है।' + (pending.length ? ' ' + pending.length + ' भुगतान की पुष्टि बाकी है; वे बकाया में शामिल नहीं हैं।' : '')
        : party.name + ' has ' + money(balance) + ' outstanding in the confirmed khata.' + (pending.length ? ' There ' + (pending.length === 1 ? 'is ' : 'are ') + pending.length + ' payment alert(s) awaiting confirmation. Those have not reduced the balance.' : ''),
      recordIds: state.records.filter((record) => record.partyId === party.id && (record.kind === 'sale' || record.kind === 'receipt')).map((record) => record.id),
      partyId: party.id,
    };
  }
  if (/sale|bikri|बिक्री/.test(q)) return {
    text: hindi ? 'आज की दर्ज बिक्री ' + money(summary.sales) + ' है। पक्की प्राप्त रकम ' + money(summary.receipts) + ' है। बिक्री और भुगतान अलग हैं।'
      : 'Today’s recorded sales are ' + money(summary.sales) + '. Confirmed receipts are ' + money(summary.receipts) + '. These are separate totals: some receipts may settle earlier credit.',
    recordIds: state.records.filter((record) => record.kind === 'sale' && record.status === 'confirmed' && sameLocalDay(record.createdAt, new Date())).map((record) => record.id),
  };
  if (/review|pending|alert|payment|receipt|collection|भुगतान|पैसे/.test(q)) return {
    text: hindi ? 'आज की पक्की प्राप्त रकम ' + money(summary.receipts) + ' है। ' + summary.review + ' अलर्ट की पुष्टि बाकी है।'
      : 'You have ' + summary.review + ' payment alerts to review. Today’s confirmed receipts total ' + money(summary.receipts) + '. Alerts stay separate until you confirm them.',
    recordIds: state.records.filter((record) => record.status === 'review').map((record) => record.id),
  };
  if (/follow|task|attention|supplier|invoice|delivery|करना/.test(q)) return {
    text: hindi ? summary.followUps + ' फॉलो-अप बाकी हैं। अपने रिकॉर्ड और भुगतान की जाँच करें।'
      : 'There are ' + summary.followUps + ' open follow-ups. ' + state.followUps.filter((f) => f.status === 'open').map((f) => f.title).join(' · '),
    recordIds: [...new Set(state.followUps.filter((item) => item.status === 'open').flatMap((item) => item.recordId ? [item.recordId] : []))],
  };
  if (/owe|due|udhaar|khata|balance|बकाया|उधार/.test(q)) return {
    text: hindi ? 'कुल ग्राहक बकाया ' + money(summary.dues) + ' है। यह पक्के खाता रिकॉर्ड से निकाला गया है।'
      : 'Customers owe a total of ' + money(summary.dues) + '. ' + state.parties.map((item) => item.name.split(' ')[0] + ': ' + money(partyBalance(state, item.id))).join(' · ') + '. Unconfirmed alerts are excluded.',
    recordIds: [],
  };
  return { text: hindi ? 'मैं आपके रिकॉर्ड से बिक्री, भुगतान, खाता और फॉलो-अप बता सकता हूँ। पूछें: “आज की बिक्री?” या “कुल बकाया?”'
    : 'I can explain your saved sales, receipts, customer balances and follow-ups. Try “What are today’s sales?”, “What are customer dues?” or “What needs my attention?”.', recordIds: [] };
}

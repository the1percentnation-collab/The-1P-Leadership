// The SMS consent wording, exactly as it appears on every declared opt-in page
// (/webinar, /financial-services, /corporate).
//
// This file is not imported at runtime. The pages carry the markup statically
// so a reviewer fetching raw HTML sees it; this module is the single source
// tests/consent-labels.test.cjs compares each page against, byte for byte.
// Change the wording here and on every page together, or the test fails —
// which is the point. /webinar is the canonical copy.

export const SMS_CONSENT_LABEL_HTML =
  'By checking this box, you agree to receive text messages from <strong>The One Percent Nation</strong> related to your inquiry, bookings, or program updates. Message frequency may vary. Message and data rates may apply. Reply <strong>HELP</strong> for assistance or <strong>STOP</strong> to opt out. Consent is not a condition of purchase.';

export const MARKETING_CONSENT_LABEL_HTML =
  'By checking this box, you agree to receive marketing and promotional messages from <strong>The One Percent Nation</strong>, including special offers, discounts, and new program updates. Message frequency may vary. Message and data rates may apply. Reply <strong>HELP</strong> for assistance or <strong>STOP</strong> to opt out at any time.';

const stripTags = (html) => html.replace(/<[^>]+>/g, '');

/** The same two strings as a person reads them, tags removed. */
export const SMS_CONSENT_LABEL_TEXT = stripTags(SMS_CONSENT_LABEL_HTML);
export const MARKETING_CONSENT_LABEL_TEXT = stripTags(MARKETING_CONSENT_LABEL_HTML);

/** The pages that are declared SMS opt-in points, and their input ids. */
export const OPT_IN_PAGES = [
  { page: 'webinar.html', sms: 'c1', marketing: 'c2' },
  { page: 'financial-services.html', sms: 'bk-sms', marketing: 'bk-mkt' },
  { page: 'corporate.html', sms: 'a-sms', marketing: 'a-mkt' }
];

export const MESSAGES = {
  'SS-01': 'contains hidden or direction-changing Unicode characters',
  'SS-02': 'downloads and runs remote code in one step',
  'SS-03': 'reads SSH key, cloud credential, browser data or .env paths',
  'SS-04': 'references a raw IP address or a known data-capture host',
  'SS-05': 'contains instructions that try to override the agent or hide actions from the user',
  'SS-06': 'contains encoded or obfuscated payload content',
  'SS-07': 'requests unrestricted shell or tool access',
  'SS-08:unsupported-source': 'source type is not supported',
  'SS-08:folder-not-found': 'skill folder was not found',
  'SS-08:too-large': 'skill is too large to scan',
  'SS-08:file-limit': 'skill has too many files to scan',
  'SS-08:binary': 'binary file was not scanned',
  'SS-08:rate-limited': 'remote host rate-limited the request',
  'SS-08:fetch-failed': 'could not fetch the skill',
};

// Bidi controls and Unicode tag characters: high. Zero-width and joiners: medium.
export const HIGH_CHARS = /[\u{202A}-\u{202E}\u{2066}-\u{2069}\u{E0000}-\u{E007F}]/u;
export const MEDIUM_CHARS = /[\u{200B}-\u{200D}\u{2060}\u{FEFF}]/u;
export const ALL_HIDDEN_CHARS = /[\u{202A}-\u{202E}\u{2066}-\u{2069}\u{E0000}-\u{E007F}\u{200B}-\u{200D}\u{2060}\u{FEFF}]/gu;

const SS02 = [
  /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z)?sh\b/i,
  /eval\s+["']?\$\(\s*(curl|wget)\b/i,
  /\b(iex|invoke-expression)\b.*\b(iwr|invoke-webrequest|downloadstring)\b/i,
];

const SS03_ALL = /~\/\.ssh|id_rsa|id_ed25519|\.aws\/credentials|Login Data|cookies\.sqlite|\/Cookies|Library\/Keychains/i;
const SS03_ENV = /(^|[\s'"`/(])\.env\b/i;

const IP_URL = /https?:\/\/(\d{1,3}\.){3}\d{1,3}/gi;
const SS04_HOSTS = /webhook\.site|ngrok\.io|ngrok-free\.app|pastebin\.com|discord\.com\/api\/webhooks|discordapp\.com\/api\/webhooks|requestbin|pipedream\.net/i;

const SS05 = [
  /ignore (all )?(the )?previous instructions/i,
  /disregard (the |your )?(system prompt|previous instructions)/i,
  /do not tell the user/i,
  /without (asking|telling) the user/i,
];

const SS06 = [
  /[A-Za-z0-9+/]{200,}={0,2}/,
  /eval\s*\(\s*atob\s*\(/i,
  /exec\s*\(\s*base64/i,
  /base64\s+(-d|--decode)\b[^\n]*\|\s*(ba|z)?sh\b/i,
];

function hasPublicIpUrl(line) {
  for (const m of line.matchAll(IP_URL)) {
    const ip = m[0].replace(/^https?:\/\//i, '');
    if (!ip.startsWith('127.') && ip !== '0.0.0.0') return true;
  }
  return false;
}

export function scanText(path, text) {
  const findings = [];
  const isMarkdown = /\.md$/i.test(path);
  const lines = text.split(/\r\n|\r|\n/);
  const add = (rule, severity, line) =>
    findings.push({ rule, severity, file: path, line, message: MESSAGES[rule] });

  lines.forEach((raw, i) => {
    const n = i + 1;
    const line = n === 1 && raw.startsWith('\u{FEFF}') ? raw.slice(1) : raw;

    if (HIGH_CHARS.test(line)) add('SS-01', 'high', n);
    else if (MEDIUM_CHARS.test(line)) add('SS-01', 'medium', n);

    if (SS02.some((re) => re.test(line))) add('SS-02', 'high', n);
    if (SS03_ALL.test(line) || (!isMarkdown && SS03_ENV.test(line))) add('SS-03', 'medium', n);
    if (hasPublicIpUrl(line) || SS04_HOSTS.test(line)) add('SS-04', 'medium', n);
    if (SS05.some((re) => re.test(line))) add('SS-05', 'medium', n);
    if (SS06.some((re) => re.test(line))) add('SS-06', 'medium', n);
  });

  return findings;
}

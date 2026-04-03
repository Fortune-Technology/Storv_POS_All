/**
 * AAMVA PDF417 driver's license barcode parser.
 * The 2D scanner sends the raw AAMVA string over HID (keyboard wedge).
 *
 * AAMVA format: starts with "@\n\x1e\r" header, then subfile records.
 * Each data element is 3 chars (e.g. "DAA", "DBB") followed by the value.
 */

export function parseAAMVALicense(raw) {
  if (!raw || !raw.startsWith('@')) {
    throw new Error('Not a valid AAMVA barcode — ensure you are using a 2D scanner.');
  }

  const lines = raw.split(/\r\n|\n|\r/);
  const fields = {};

  for (const line of lines) {
    if (line.length < 3) continue;
    const code  = line.substring(0, 3);
    const value = line.substring(3).trim();
    if (value) fields[code] = value;
  }

  // DOB: DBB field, MMDDYYYY format
  const dobRaw = fields['DBB'];
  if (!dobRaw || dobRaw.length < 8) {
    throw new Error('Date of birth not found in license barcode.');
  }

  const dob = parseAAMVADate(dobRaw);

  // Name: prefer separate fields (DCS=last, DAC=first), fall back to DAA (full name)
  const lastName  = fields['DCS'] || (fields['DAA'] || '').split(',')[0]?.trim() || '';
  const firstName = fields['DAC'] || fields['DCT'] || (fields['DAA'] || '').split(',')[1]?.trim() || '';

  return {
    firstName,
    lastName,
    fullName:      [firstName, lastName].filter(Boolean).join(' '),
    dob,
    age:           calculateAge(dob),
    licenseNumber: fields['DAQ'] || '',
    state:         fields['DAJ'] || '',
    expiryDate:    fields['DBA'] ? parseAAMVADate(fields['DBA']) : null,
  };
}

// AAMVA dates are MMDDYYYY
function parseAAMVADate(str) {
  const s = str.replace(/\D/g, '');
  if (s.length === 8) {
    const mm = s.slice(0, 2), dd = s.slice(2, 4), yyyy = s.slice(4, 8);
    const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
    if (!isNaN(d)) return d;
  }
  throw new Error(`Unrecognised AAMVA date: ${str}`);
}

export function calculateAge(dob) {
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

export function meetsAgeRequirement(dob, requiredAge) {
  return calculateAge(dob) >= requiredAge;
}

// Quick check: is this raw string likely a DL barcode?
export function looksLikeLicense(raw) {
  return typeof raw === 'string' && raw.startsWith('@') && raw.includes('DBB');
}

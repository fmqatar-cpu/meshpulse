/**
 * DeviceAliasService.ts
 * Manages custom device names and CSV import/export across stations and phones.
 * Stores data in localStorage as CSV for true zero-dependency portability.
 */

export interface DeviceAlias {
  mac: string;
  name: string;
  ip: string;
  notes: string;
  updatedAt: string;
}

export const LOCAL_STORAGE_CSV_KEY = 'meshpulse_device_aliases_csv';

/**
 * Escapes CSV values per RFC 4180
 */
export function escapeCsv(val: any): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Robust RFC 4180 CSV line parser supporting embedded commas and escaped quotes
 */
export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

/**
 * Parses CSV text into a map of device aliases.
 * Indexes by normalized MAC (lowercase with colons) and by IP for fast lookup.
 */
export function parseCsv(csvText: string): Record<string, DeviceAlias> {
  const map: Record<string, DeviceAlias> = {};
  if (!csvText || typeof csvText !== 'string') return map;

  const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length <= 1) return map;

  // Header detection
  const headers = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
  let macIdx = headers.findIndex(h => h === 'mac' || h === 'mac_address' || h === 'hardware_address');
  let nameIdx = headers.findIndex(h => h === 'name' || h === 'custom_name' || h === 'alias' || h === 'device_name');
  let ipIdx = headers.findIndex(h => h === 'ip' || h === 'ip_address');
  let notesIdx = headers.findIndex(h => h === 'notes' || h === 'note' || h === 'location' || h === 'description');

  if (macIdx === -1) macIdx = 0;
  if (nameIdx === -1) nameIdx = 1;
  if (ipIdx === -1 && headers.length > 2) ipIdx = 2;
  if (notesIdx === -1 && headers.length > 3) notesIdx = 3;

  for (let i = 1; i < lines.length; i++) {
    const parts = parseCsvLine(lines[i]);
    const rawMac = (parts[macIdx] || '').trim().toLowerCase().replace(/-/g, ':');
    const name = (parts[nameIdx] || '').trim();
    const ip = ipIdx >= 0 ? (parts[ipIdx] || '').trim() : '';
    const notes = notesIdx >= 0 ? (parts[notesIdx] || '').trim() : '';

    if (name && (rawMac || ip)) {
      const alias: DeviceAlias = {
        mac: rawMac,
        name,
        ip,
        notes,
        updatedAt: new Date().toISOString()
      };
      if (rawMac) map[rawMac] = alias;
      if (ip) map[ip] = alias;
    }
  }
  return map;
}

/**
 * Serializes aliases dictionary to standard CSV string
 */
export function serializeToCsv(aliases: Record<string, DeviceAlias>): string {
  const rows = ['mac,name,ip,notes,updated_at'];
  const seenKeys = new Set<string>();

  for (const item of Object.values(aliases)) {
    const uniqueKey = item.mac || item.ip;
    if (!uniqueKey || seenKeys.has(uniqueKey)) continue;
    seenKeys.add(uniqueKey);

    rows.push([
      escapeCsv(item.mac || ''),
      escapeCsv(item.name || ''),
      escapeCsv(item.ip || ''),
      escapeCsv(item.notes || ''),
      escapeCsv(item.updatedAt || new Date().toISOString())
    ].join(','));
  }
  return rows.join('\n');
}

/**
 * Loads aliases from localStorage
 */
export function loadFromLocalStorage(): Record<string, DeviceAlias> {
  try {
    const csv = localStorage.getItem(LOCAL_STORAGE_CSV_KEY);
    if (csv) {
      return parseCsv(csv);
    }
  } catch (e) {
    console.error('Failed to load device aliases from localStorage:', e);
  }
  return {};
}

/**
 * Saves aliases to localStorage as CSV and returns the serialized CSV text
 */
export function saveToLocalStorage(aliases: Record<string, DeviceAlias>): string {
  const csv = serializeToCsv(aliases);
  try {
    localStorage.setItem(LOCAL_STORAGE_CSV_KEY, csv);
  } catch (e) {
    console.error('Failed to save device aliases to localStorage:', e);
  }
  return csv;
}

/**
 * Finds alias for a device by MAC first, then by IP
 */
export function getAliasForDevice(
  aliases: Record<string, DeviceAlias>,
  mac?: string | null,
  ip?: string | null
): DeviceAlias | null {
  if (mac) {
    const normMac = mac.trim().toLowerCase().replace(/-/g, ':');
    if (aliases[normMac]) return aliases[normMac];
  }
  if (ip && aliases[ip.trim()]) {
    return aliases[ip.trim()];
  }
  return null;
}

/**
 * Exports current aliases (optionally augmented with newly discovered unassigned devices) as a downloadable CSV
 */
export function exportCsvFile(
  aliases: Record<string, DeviceAlias>,
  currentDiscoveredDevices: any[] = []
): void {
  const exportMap = { ...aliases };

  // Pre-fill unassigned discovered devices so the exported CSV can serve as a full device inventory template
  currentDiscoveredDevices.forEach(dev => {
    const normMac = (dev.mac || '').trim().toLowerCase().replace(/-/g, ':');
    const key = normMac || dev.ip;
    if (key && !exportMap[key]) {
      exportMap[key] = {
        mac: normMac,
        name: dev.name || dev.vendor || 'Unknown Device',
        ip: dev.ip || '',
        notes: dev.isRandomized ? 'Private MAC' : (dev.type || ''),
        updatedAt: new Date().toISOString()
      };
    }
  });

  const csvContent = serializeToCsv(exportMap);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const dateStr = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = `meshpulse_device_aliases_${dateStr}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Reads a File object and returns parsed aliases and count
 */
export function readCsvFile(file: File): Promise<{ count: number; aliases: Record<string, DeviceAlias>; rawCsv: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        if (!text) {
          return resolve({ count: 0, aliases: {}, rawCsv: '' });
        }
        const parsed = parseCsv(text);
        const uniqueCount = new Set(Object.values(parsed).map(a => a.mac || a.ip)).size;
        resolve({ count: uniqueCount, aliases: parsed, rawCsv: text });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

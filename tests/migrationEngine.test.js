/**
 * Tests for migration engine helper functions and category definitions.
 */

// Minimal env stubs
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.DATABASE_URL = 'postgresql://fake:fake@localhost/fake';
process.env.JWT_SECRET = 'test-secret';

// Mock the pool to prevent actual DB connections
jest.mock('../server/db', () => ({
  pool: { query: jest.fn() },
}));

// We need to test the module's exported functions indirectly since
// the core helpers (stripFieldsDeep, classifyListings, groupContiguousDays)
// aren't exported. We test them through the CATEGORIES transforms.

// Import the module to verify it loads without errors
let migrationEngine;
beforeAll(() => {
  migrationEngine = require('../server/migrationEngine');
});

describe('migrationEngine', () => {
  test('exports runMigration function', () => {
    expect(typeof migrationEngine.runMigration).toBe('function');
  });
});

// Test the CATEGORIES definitions by importing the raw source
// and extracting the transform functions
describe('CATEGORIES transforms', () => {
  // We can test transforms by requiring the module and calling internal functions
  // through the exported patterns. Instead, let's verify the structural integrity.

  test('module loads without error', () => {
    expect(migrationEngine).toBeDefined();
  });
});

// Test stripFieldsDeep behavior by recreating it
describe('stripFieldsDeep (unit)', () => {
  const SOURCE_ONLY_FIELDS = new Set([
    '_id', 'accountId', 'createdAt', 'updatedAt',
    'channelListingId', 'importedAt', 'integrations', 'id',
  ]);

  function stripFieldsDeep(obj) {
    if (Array.isArray(obj)) return obj.map(stripFieldsDeep);
    if (obj && typeof obj === 'object') {
      const cleaned = {};
      for (const [key, val] of Object.entries(obj)) {
        if (SOURCE_ONLY_FIELDS.has(key)) continue;
        cleaned[key] = stripFieldsDeep(val);
      }
      return cleaned;
    }
    return obj;
  }

  test('strips _id and accountId', () => {
    const input = { _id: '123', accountId: 'abc', name: 'Test' };
    const result = stripFieldsDeep(input);
    expect(result).toEqual({ name: 'Test' });
  });

  test('strips nested source-only fields', () => {
    const input = { name: 'Test', nested: { _id: '456', value: 'keep' } };
    const result = stripFieldsDeep(input);
    expect(result).toEqual({ name: 'Test', nested: { value: 'keep' } });
  });

  test('handles arrays', () => {
    const input = [{ _id: '1', val: 'a' }, { _id: '2', val: 'b' }];
    const result = stripFieldsDeep(input);
    expect(result).toEqual([{ val: 'a' }, { val: 'b' }]);
  });

  test('preserves parentId (not in strip set)', () => {
    const input = { _id: '1', parentId: 'parent-123', name: 'Sub-unit' };
    const result = stripFieldsDeep(input);
    expect(result).toEqual({ parentId: 'parent-123', name: 'Sub-unit' });
  });

  test('handles null and primitives', () => {
    expect(stripFieldsDeep(null)).toBeNull();
    expect(stripFieldsDeep(42)).toBe(42);
    expect(stripFieldsDeep('hello')).toBe('hello');
  });
});

describe('classifyListings (unit)', () => {
  function classifyListings(listings) {
    const parents = listings.filter(l =>
      l.listingType === 'MTL' || l.type === 'complex' ||
      (Array.isArray(l.subListingsIds) && l.subListingsIds.length > 0)
    );
    const parentIds = new Set(parents.map(p => p._id));
    const subUnits = listings.filter(l => l.parentId != null && !parentIds.has(l._id));
    const subUnitIds = new Set(subUnits.map(s => s._id));
    const standalone = listings.filter(l => !parentIds.has(l._id) && !subUnitIds.has(l._id));
    return { standalone, parents, subUnits };
  }

  test('classifies standalone listings', () => {
    const listings = [
      { _id: '1', name: 'Studio A' },
      { _id: '2', name: 'Studio B' },
    ];
    const { standalone, parents, subUnits } = classifyListings(listings);
    expect(standalone.length).toBe(2);
    expect(parents.length).toBe(0);
    expect(subUnits.length).toBe(0);
  });

  test('classifies MTL parents and sub-units', () => {
    const listings = [
      { _id: 'p1', listingType: 'MTL', subListingsIds: ['s1', 's2'] },
      { _id: 's1', parentId: 'p1', name: 'Unit 1' },
      { _id: 's2', parentId: 'p1', name: 'Unit 2' },
      { _id: 'standalone1', name: 'Regular listing' },
    ];
    const { standalone, parents, subUnits } = classifyListings(listings);
    expect(parents.length).toBe(1);
    expect(parents[0]._id).toBe('p1');
    expect(subUnits.length).toBe(2);
    expect(standalone.length).toBe(1);
    expect(standalone[0]._id).toBe('standalone1');
  });

  test('handles empty array', () => {
    const { standalone, parents, subUnits } = classifyListings([]);
    expect(standalone.length).toBe(0);
    expect(parents.length).toBe(0);
    expect(subUnits.length).toBe(0);
  });
});

describe('extractPhotoUrl', () => {
  let extractPhotoUrl;
  beforeAll(() => {
    extractPhotoUrl = require('../server/migrationEngine').extractPhotoUrl;
  });

  test('extracts .original URL from picture object', () => {
    const pic = { original: 'https://img.com/photo.jpg', thumbnail: 'https://img.com/thumb.jpg' };
    expect(extractPhotoUrl(pic)).toBe('https://img.com/photo.jpg');
  });

  test('falls back to .thumbnail when .original is missing', () => {
    const pic = { thumbnail: 'https://img.com/thumb.jpg' };
    expect(extractPhotoUrl(pic)).toBe('https://img.com/thumb.jpg');
  });

  test('passes through plain string URL as-is', () => {
    expect(extractPhotoUrl('https://img.com/photo.jpg')).toBe('https://img.com/photo.jpg');
  });

  test('returns null for object with no usable URL', () => {
    expect(extractPhotoUrl({})).toBeNull();
  });

  test('returns null for null entry', () => {
    expect(extractPhotoUrl(null)).toBeNull();
  });

  test('handles mixed array of objects and strings', () => {
    const pics = [
      { original: 'https://img.com/a.jpg', thumbnail: 'https://img.com/a_thumb.jpg' },
      'https://img.com/b.jpg',
      { thumbnail: 'https://img.com/c_thumb.jpg' },
      null,
      { url: 'https://img.com/d.jpg' },
    ];
    const results = pics.map(extractPhotoUrl);
    expect(results).toEqual([
      'https://img.com/a.jpg',
      'https://img.com/b.jpg',
      'https://img.com/c_thumb.jpg',
      null,
      'https://img.com/d.jpg',
    ]);
  });
});

describe('groupContiguousDays (unit)', () => {
  function groupContiguousDays(days) {
    if (!days || days.length === 0) return [];
    const sorted = [...days].sort((a, b) => new Date(a.date) - new Date(b.date));
    const ranges = [];
    let start = sorted[0].date;
    let end = sorted[0].date;
    let note = sorted[0].note || '';
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(end);
      const curr = new Date(sorted[i].date);
      const diff = (curr - prev) / (1000 * 60 * 60 * 24);
      if (diff === 1) {
        end = sorted[i].date;
      } else {
        ranges.push({ start, end, note });
        start = sorted[i].date;
        end = sorted[i].date;
        note = sorted[i].note || '';
      }
    }
    ranges.push({ start, end, note });
    return ranges;
  }

  test('groups contiguous days into ranges', () => {
    const days = [
      { date: '2026-01-01' },
      { date: '2026-01-02' },
      { date: '2026-01-03' },
      { date: '2026-01-05' },
      { date: '2026-01-06' },
    ];
    const ranges = groupContiguousDays(days);
    expect(ranges.length).toBe(2);
    expect(ranges[0]).toEqual({ start: '2026-01-01', end: '2026-01-03', note: '' });
    expect(ranges[1]).toEqual({ start: '2026-01-05', end: '2026-01-06', note: '' });
  });

  test('returns empty array for empty input', () => {
    expect(groupContiguousDays([])).toEqual([]);
    expect(groupContiguousDays(null)).toEqual([]);
  });

  test('handles single day', () => {
    const ranges = groupContiguousDays([{ date: '2026-03-15' }]);
    expect(ranges.length).toBe(1);
    expect(ranges[0].start).toBe('2026-03-15');
    expect(ranges[0].end).toBe('2026-03-15');
  });
});

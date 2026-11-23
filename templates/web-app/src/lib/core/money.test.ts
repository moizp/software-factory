import { describe, expect, it } from 'vitest';

import { formatMoney, toCents } from './money';

describe('money', () => {
	it('rounds to whole cents', () => {
		expect(toCents(1.005 + 0.0001)).toBe(101);
	});

	it('formats cents with the currency', () => {
		expect(formatMoney(1234)).toBe('$12.34');
	});
});

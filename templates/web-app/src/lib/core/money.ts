/** Example core module: plain TypeScript, no framework, nothing imported. Delete it once the app has real core code. */
export const toCents = (amount: number): number => Math.round(amount * 100);

export const formatMoney = (cents: number, currency = 'USD', locale = 'en-US'): string =>
	new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);

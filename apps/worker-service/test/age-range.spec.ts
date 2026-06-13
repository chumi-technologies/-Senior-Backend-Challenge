import { calculateAgeRange } from '../src/processors/age-range';

/**
 * Characterization test for the worker's age-bucket mapping.
 * Locks the exact boundaries so a future edit to the messy worker cannot
 * silently shift a customer's demographic bucket.
 */
describe('calculateAgeRange (worker age-bucket mapping)', () => {
    it.each([
        [10, 'under-18'],
        [17, 'under-18'],
        [18, '18-24'],
        [24, '18-24'],
        [25, '25-34'],
        [34, '25-34'],
        [35, '35-44'],
        [44, '35-44'],
        [45, '45-54'],
        [54, '45-54'],
        [55, '55+'],
        [80, '55+'],
    ])('maps age %i to %s', (age, expected) => {
        expect(calculateAgeRange(age as number)).toBe(expected);
    });
});

/**
 * Maps a numeric age to a standard age range bucket.
 *
 * Extracted from AnalysisProcessor so the messy worker pipeline has a pure,
 * dependency-free unit that can be characterization-tested without a DB or the
 * third-party API. Behavior is byte-for-byte identical to the previous private method.
 */
export function calculateAgeRange(age: number): string {
    if (age < 18) return 'under-18';
    if (age < 25) return '18-24';
    if (age < 35) return '25-34';
    if (age < 45) return '35-44';
    if (age < 55) return '45-54';
    return '55+';
}

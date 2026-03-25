// ─────────────────────────────────────────────
// LOAD RESUMES FROM PRIVATE APIFY KEY-VALUE STORE
// Add any number of keys starting with "resume_"
// e.g. resume_swe, resume_ai, resume_data, resume_pm, etc.
// ─────────────────────────────────────────────
let candidateProfile = '';

try {
    const store = await Actor.openKeyValueStore('candidate-resumes', { forceCloud: true });
    
    // Dynamically find all keys that start with "resume_"
    const resumeSections = [];
    await store.forEachKey(async (key) => {
        if (key.startsWith('resume_')) {
            const value = await store.getValue(key);
            if (value) {
                const label = key.replace('resume_', '').toUpperCase().replace(/_/g, ' ');
                resumeSections.push(`=== ${label} RESUME ===\n${value}`);
                console.log(`Loaded resume: ${key}`);
            }
        }
    });

    candidateProfile = resumeSections.length > 0
        ? resumeSections.join('\n\n')
        : getFallbackProfile();

    console.log(`Total resumes loaded: ${resumeSections.length}`);
} catch (err) {
    console.warn('Could not load resumes from store, using fallback:', err.message);
    candidateProfile = getFallbackProfile();
}
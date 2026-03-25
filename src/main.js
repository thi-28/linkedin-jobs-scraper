import { Actor } from 'apify';
import { PlaywrightCrawler } from '@crawlee/playwright';

await Actor.init();

const input = await Actor.getInput();
const {
    keywords = ['software engineering intern'],
    location = 'United States',
    jobType = 'I',
    datePosted = 'r86400',
    maxJobs = 10,
    resumeStoreId = null,
} = input ?? {};

// ---- LOAD RESUMES FROM PRIVATE KEY-VALUE STORE ----
let candidateProfile = '';

try {
    const store = await Actor.openKeyValueStore('candidate-resumes', { forceCloud: true });
    const swеResume = await store.getValue('resume_swe') ?? '';
    const dsResume = await store.getValue('resume_data_science') ?? '';
    const generalResume = await store.getValue('resume_general') ?? '';

    candidateProfile = `
=== SOFTWARE ENGINEERING RESUME ===
${sweResume}

=== DATA SCIENCE RESUME ===
${dsResume}

=== GENERAL RESUME ===
${generalResume}
    `.trim();

    console.log('Successfully loaded resumes from Key-Value Store');
} catch (err) {
    console.warn('Could not load resumes, using fallback profile', err);
    candidateProfile = 'Masters student in Computer Science seeking internships.';
}
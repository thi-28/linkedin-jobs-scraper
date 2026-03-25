import { Actor } from 'apify';
import { PlaywrightCrawler } from '@crawlee/playwright';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

// ─────────────────────────────────────────────
// FALLBACK PROFILE (used if no resumes found)
// ─────────────────────────────────────────────
function getFallbackProfile() {
    return '';
}

// ─────────────────────────────────────────────
// PARSE RESUME BASED ON FILE TYPE
// ─────────────────────────────────────────────
async function extractText(buffer, key) {
    try {
        if (key.toLowerCase().endsWith('.pdf')) {
            const data = await pdfParse(buffer);
            return data.text;
        } else if (key.toLowerCase().endsWith('.docx')) {
            const result = await mammoth.extractRawText({ buffer });
            return result.value;
        } else {
            return buffer.toString('utf-8');
        }
    } catch (err) {
        console.warn(`Could not parse file "${key}":`, err.message);
        return null;
    }
}

await Actor.init();

const input = await Actor.getInput();
const {
    keywords = ['AI research intern', 'machine learning intern', 'NLP intern', 'software engineering intern', 'data science intern'],
    location = 'United States',
    jobType = 'I',
    datePosted = 'r86400',
    maxJobs = 10,
} = input ?? {};

// ─────────────────────────────────────────────
// LOAD & PARSE ALL RESUMES FROM KEY-VALUE STORE
// Supports .pdf, .docx, and plain text — any number of files
// ─────────────────────────────────────────────
let candidateProfile = '';

try {
    const store = await Actor.openKeyValueStore('candidate-resumes', { forceCloud: true });
    const resumeSections = [];

    await store.forEachKey(async (key) => {
        try {
            const value = await store.getValue(key);
            if (!value) return;

            let text = '';

            if (Buffer.isBuffer(value)) {
                text = await extractText(value, key);
            } else if (typeof value === 'string') {
                text = value;
            } else if (typeof value === 'object') {
                const buf = Buffer.from(value);
                text = await extractText(buf, key);
            }

            if (text && text.trim().length > 0) {
                const label = key
                    .replace(/\.(pdf|docx|txt)$/i, '')
                    .replace(/[_-]/g, ' ')
                    .toUpperCase();
                resumeSections.push(`=== ${label} ===\n${text.trim()}`);
                console.log(`Loaded and parsed: ${key} (${text.length} chars)`);
            }
        } catch (err) {
            console.warn(`Skipping key "${key}":`, err.message);
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

// ─────────────────────────────────────────────
// SCRAPE LINKEDIN JOBS FOR EACH KEYWORD
// ─────────────────────────────────────────────
const results = [];

const urls = keywords.map((keyword) => ({
    url: `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(keyword)}&location=${encodeURIComponent(location)}&f_JT=${jobType}&f_TPR=${datePosted}`,
    userData: { keyword },
}));

const crawler = new PlaywrightCrawler({
    headless: true,
    maxRequestsPerCrawl: urls.length * 2,

    async requestHandler({ page, request }) {
        const { keyword } = request.userData;
        console.log(`Scraping keyword: "${keyword}"`);

        try {
            await page.waitForSelector('.jobs-search__results-list', { timeout: 15000 });
        } catch {
            console.warn(`No results found for keyword: "${keyword}"`);
            return;
        }

        const jobs = await page.evaluate((max) => {
            const items = document.querySelectorAll('.jobs-search__results-list li');
            const data = [];

            items.forEach((item, i) => {
                if (i >= max) return;
                const title    = item.querySelector('.base-search-card__title')?.innerText?.trim();
                const company  = item.querySelector('.base-search-card__subtitle')?.innerText?.trim();
                const location = item.querySelector('.job-search-card__location')?.innerText?.trim();
                const link     = item.querySelector('a.base-card__full-link')?.href;
                const date     = item.querySelector('time')?.getAttribute('datetime');

                if (title && link) data.push({ title, company, location, link, date });
            });

            return data;
        }, maxJobs);

        console.log(`Found ${jobs.length} jobs for "${keyword}"`);
        results.push(...jobs.map((job) => ({ ...job, searchKeyword: keyword })));
    },
});

await crawler.run(urls);

// Deduplicate by job link
const seen = new Set();
const uniqueResults = results.filter((job) => {
    if (seen.has(job.link)) return false;
    seen.add(job.link);
    return true;
});

console.log(`Total unique jobs scraped: ${uniqueResults.length}`);

// ─────────────────────────────────────────────
// SCORE EACH JOB WITH CLAUDE
// ─────────────────────────────────────────────
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const hasResumes = candidateProfile.trim().length > 0;

async function scoreJob(job) {
    if (!ANTHROPIC_API_KEY || !hasResumes) {
        return {
            date: job.date,
            title: job.title,
            company: job.company,
            location: job.location,
            link: job.link,
            searchKeyword: job.searchKeyword,
            atsScore: 'N/A',
            confidenceScore: 'N/A',
            improvements: !hasResumes
                ? 'No resumes found in Key-Value Store'
                : 'ANTHROPIC_API_KEY not set',
            predictedScoreAfterImprovement: 'N/A',
        };
    }

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 600,
                messages: [
                    {
                        role: 'user',
                        content: `You are an expert ATS (Applicant Tracking System) analyst and career coach.

Analyze this job listing against the candidate's resume profiles and return scores and actionable advice.

CANDIDATE PROFILES:
${candidateProfile}

JOB LISTING:
- Title: ${job.title}
- Company: ${job.company}
- Location: ${job.location}
- Found via search: "${job.searchKeyword}"

Return ONLY a valid JSON object with NO extra text, markdown, or backticks:
{
  "atsScore": <integer 0-100, how well the candidate's current resume matches this job>,
  "confidenceScore": <integer 0-100, your confidence in this assessment given the info available>,
  "improvements": "<2-3 specific, actionable things the candidate should tailor or highlight in their resume/cover letter for this specific role>",
  "predictedScoreAfterImprovement": <integer 0-100, estimated ATS score if the improvements are made>
}`,
                    },
                ],
            }),
        });

        const data = await response.json();
        const text = data.content?.[0]?.text?.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(text);

        return {
            date: job.date,
            title: job.title,
            company: job.company,
            location: job.location,
            link: job.link,
            searchKeyword: job.searchKeyword,
            atsScore: parsed.atsScore ?? 'N/A',
            confidenceScore: parsed.confidenceScore ?? 'N/A',
            improvements: parsed.improvements ?? '',
            predictedScoreAfterImprovement: parsed.predictedScoreAfterImprovement ?? 'N/A',
        };
    } catch (err) {
        console.error(`Failed to score job "${job.title}":`, err.message);
        return {
            date: job.date,
            title: job.title,
            company: job.company,
            location: job.location,
            link: job.link,
            searchKeyword: job.searchKeyword,
            atsScore: 'N/A',
            confidenceScore: 'N/A',
            improvements: 'Scoring failed — check API key and model access',
            predictedScoreAfterImprovement: 'N/A',
        };
    }
}

console.log(`Scoring ${uniqueResults.length} jobs with Claude...`);

// Score in batches of 5 to avoid rate limits
const batchSize = 5;
const scoredJobs = [];

for (let i = 0; i < uniqueResults.length; i += batchSize) {
    const batch = uniqueResults.slice(i, i + batchSize);
    const scored = await Promise.all(batch.map(scoreJob));
    scoredJobs.push(...scored);
    if (i + batchSize < uniqueResults.length) {
        await new Promise((r) => setTimeout(r, 1000));
    }
}

// Sort by ATS score descending (N/A goes to bottom)
scoredJobs.sort((a, b) => {
    if (a.atsScore === 'N/A') return 1;
    if (b.atsScore === 'N/A') return -1;
    return b.atsScore - a.atsScore;
});

console.log(`Done! Pushing ${scoredJobs.length} scored jobs to dataset.`);
await Actor.pushData(scoredJobs);
await Actor.exit();
import { Actor } from 'apify';
import { PlaywrightCrawler } from '@crawlee/playwright';

await Actor.init();

const input = await Actor.getInput();
const {
    keywords = 'software engineering intern',
    location = 'United States',
    maxJobs = 10,
} = input ?? {};

const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(keywords)}&location=${encodeURIComponent(location)}&f_JT=I&f_TPR=r86400`;

const results = [];

const crawler = new PlaywrightCrawler({
    headless: true,
    maxRequestsPerCrawl: 5,

    async requestHandler({ page }) {
        await page.waitForSelector('.jobs-search__results-list', { timeout: 15000 });

        const jobs = await page.evaluate((max) => {
            const items = document.querySelectorAll('.jobs-search__results-list li');
            const data = [];

            items.forEach((item, i) => {
                if (i >= max) return;
                const title = item.querySelector('.base-search-card__title')?.innerText?.trim();
                const company = item.querySelector('.base-search-card__subtitle')?.innerText?.trim();
                const location = item.querySelector('.job-search-card__location')?.innerText?.trim();
                const link = item.querySelector('a.base-card__full-link')?.href;
                const date = item.querySelector('time')?.getAttribute('datetime');

                if (title && link) {
                    data.push({ title, company, location, link, date });
                }
            });

            return data;
        }, maxJobs);

        results.push(...jobs);
    },
});

await crawler.run([searchUrl]);

await Actor.pushData(results);
await Actor.exit();
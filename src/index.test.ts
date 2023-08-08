import { unstable_dev } from 'wrangler';
import type { UnstableDevWorker } from 'wrangler';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

describe('Worker', () => {
	let worker: UnstableDevWorker;

	beforeAll(async () => {
		worker = await unstable_dev('src/index.ts');
	});

	afterAll(async () => {
		await worker.stop();
	});

	it('should return 200 response with a text opengraph tag', async () => {
		const req = new Request(
			'https://txtumblr.suckerberg.workers.dev/engineering/690135035533230080',
			{ method: 'GET' }
		);
		const resp = await worker.fetch(req.url);
		expect(resp.status).toBe(200);

		const text = await resp.text();
		expect(text).toContain('<meta name="description" content="Tags: #tumblr update');
	});

	it('should return 200 response with an image opengraph tag', async () => {
		const req = new Request(
			'https://txtumblr.suckerberg.workers.dev/engineering/713599421825351680',
			{ method: 'GET' }
		);
		const resp = await worker.fetch(req.url);
		expect(resp.status).toBe(200);

		const text = await resp.text();
		expect(text).toContain(
			'<meta property="og:image" content="https://64.media.tumblr.com/0807dffbcf1e9db8a3ddf31b4f026c39/dec349afc8bbeb99-9a/s2048x3072/a10138f06f43173037f613167f32acc41495996c.png" />'
		);
		expect(text).toContain('<meta name="twitter:card" content="summary_large_image">');
	});
});

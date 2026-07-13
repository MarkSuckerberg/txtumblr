import {
	FetchPost,
	GetNotes,
	TumblrAPIError,
	TumblrBlocksPost,
	TumblrNeueAudioBlock,
	TumblrNeueImageBlock,
	TumblrNeueVideoBlock,
} from 'typeble';
import { collage } from './collage';
import { DBRefreshToken, txTumblrError, txtumblrVersion } from './types';

const allow = 'GET, HEAD, OPTIONS, DELETE';
let currentToken: DBRefreshToken | undefined;

async function main(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	switch (request.method) {
		case 'GET':
		case 'HEAD':
			break;
		case 'OPTIONS':
			return new Response(allow, { status: 200, headers: { Allow: allow } });
		case 'DELETE':
			if (request.headers.get('Authorization') != `Basic ${env.CACHE_CLEAR_TOKEN}`) {
				return new Response('Unauthorized', {
					status: 401,
					headers: {
						'WWW-Authenticate': 'realm="txtumblr", charset="UTF-8"',
					},
				});
			}
			break;
		default:
			return new Response(`Method ${request.method} not allowed`, {
				status: 405,
				headers: { Allow: allow },
			});
	}

	const url = new URL(request.url);

	//special dumb favicon handling. I probably shouldn't care but shrug
	if (url.pathname == '/favicon.ico') {
		const referer = request.headers.get('referer');
		if (!referer) {
			return new Response(null, { status: 404 });
		}

		const newUrl = new URL(referer);

		url.pathname = newUrl.pathname;
		url.search = '?favico';
	}

	const pathInfo = url.pathname.split('/');
	const trimmedPathInfo = pathInfo.filter(string => string);

	if (trimmedPathInfo[0] === 'oembed') {
		const username = url.searchParams.get('username');
		const postID = url.searchParams.get('post_id');
		const blogUrl = url.searchParams.get('blog_url');
		const embedType = url.searchParams.get('type') || 'link';
		const postTime = url.searchParams.get('post_time');
		const format = url.searchParams.get('format');

		if (!username || !postID) {
			return new Response('Missing username or post_id', { status: 400 });
		}

		return oembed(
			username,
			postID,
			env.TUMBLR_CONSUMER_KEY,
			request.headers.get('accept-language'),
			blogUrl || `https://tumblr.com/${username}`,
			embedType,
			postTime ? +postTime : undefined,
			format
		);
	}

	const username = trimmedPathInfo[0];
	const postID = trimmedPathInfo[1];

	const consumerID = env.TUMBLR_CONSUMER_KEY;
	const consumerSecret = env.TUMBLR_CONSUMER_SECRET;

	if (!trimmedPathInfo.length) {
		return Response.redirect('https://github.com/MarkSuckerberg/txtumblr', 301);
	}

	if (!Number.isInteger(+postID)) {
		throw new txTumblrError('Bad post ID', 400, false);
	}

	if (!username) {
		throw new txTumblrError('No username provided', 400, false);
	}

	const canonical = new URL(
		`${url.protocol}//${url.hostname}/${username}/${postID}${url.search}`
	);

	if (request.method == 'DELETE') {
		if (await caches.default.delete(canonical)) {
			return new Response(null, { status: 204 });
		} else {
			return new Response('Not cached', { status: 404 });
		}
	}

	const cached = await caches.default.match(canonical);

	if (cached && env.CACHE_CLEAR_TOKEN) {
		return cached;
	}

	let accessToken: string | undefined = undefined;

	if (currentToken && currentToken.ExpiresTime > Date.now()) {
		accessToken = currentToken.AccessToken;
	}

	try {
		const getToken = env.DB.prepare(
			'SELECT *, expirestime < unixepoch() as Expired FROM refreshtokens ORDER BY RetrievedTime DESC LIMIT 1'
		);
		const dbResponse = await getToken.run<DBRefreshToken>();

		for (const potentialToken of dbResponse.results) {
			if (!potentialToken.Expired) {
				currentToken = potentialToken;
				accessToken = potentialToken.AccessToken;
				break;
			}

			const data = await refreshTokenAuth(
				consumerID,
				consumerSecret,
				potentialToken.RefreshToken
			);

			if (typeof data === 'object') {
				const setToken = env.DB.prepare(
					'DELETE FROM refreshtokens; INSERT INTO refreshtokens (RetrievedTime, ExpiresTime, AccessToken, RefreshToken) VALUES (unixepoch(), unixepoch() + ?, ?, ?)'
				);

				await setToken.bind(data.expires_in, data.access_token, data.refresh_token).run();
				accessToken = data.access_token;
				currentToken = {
					RetrievedTime: Date.now(),
					ExpiresTime: Date.now() + data.expires_in,
					AccessToken: data.access_token,
					RefreshToken: data.refresh_token,
				};
				break;
			}
		}

		if (!accessToken) {
			const data = await refreshTokenAuth(
				consumerID,
				consumerSecret,
				env.TUMBLR_INITIAL_REFRESH_TOKEN
			);

			if (typeof data === 'object') {
				const setToken = env.DB.prepare(
					'DELETE FROM refreshtokens; INSERT INTO refreshtokens (RetrievedTime, ExpiresTime, AccessToken, RefreshToken) VALUES (unixepoch(), unixepoch() + ?, ?, ?);'
				);

				ctx.waitUntil(
					setToken.bind(data.expires_in, data.access_token, data.refresh_token).run()
				);
			}
		}
	} catch (error) {
		console.error(error);
	}

	let post: TumblrBlocksPost;
	try {
		post = await FetchPost<TumblrBlocksPost>(
			accessToken || consumerID,
			username,
			postID,
			false,
			false,
			undefined,
			true,
			!accessToken,
			caches.default
		);
	} catch (error) {
		if (error instanceof TumblrAPIError) {
			const errorDetail = 'Tumblr API: ' + error.response.errors?.at(0)?.detail;
			const errorDescription =
				error.response.meta.msg + (errorDetail ? `: ${errorDetail}` : '');

			throw new txTumblrError(errorDescription, error.response.meta.status);
		}

		throw error;
	}

	const originalPost = post.trail[0] as TumblrBlocksPost;

	let response: Response;

	if (url.searchParams.has('oembed')) {
		response = await oembed(
			post.blog.name,
			post.id_string,
			consumerID,
			request.headers.get('accept-language') || undefined,
			post.blog.url,
			url.searchParams.get('type') || 'link',
			post.timestamp,
			url.searchParams.get('format')
		);
	} else if (url.searchParams.has('collage')) {
		response = await collage(post, ctx, url.searchParams);
	} else if (url.searchParams.has('json')) {
		response = json(post);
	} else if (url.searchParams.has('favico')) {
		response = await favico(post, request);
	} else {
		response = mainPage(post, originalPost, url);
	}

	ctx.waitUntil(caches.default.put(canonical, response.clone()));

	return response;
}

export default {
	async fetch(request: Request, env: Env, ctx) {
		try {
			return await main(request, env, ctx);
		} catch (err) {
			if (err instanceof txTumblrError) {
				return errorPage(err.message, new URL(request.url), err.status, err.redirect);
			}

			const message = `Internal server error. This one's on me. ${err as string}`;

			return errorPage(message, new URL(request.url), 500, false);
		}
	},
} satisfies ExportedHandler<Env>;

async function oembed(
	blogName: string,
	postID: string,
	consumerID: string,
	locale?: string | null,
	blogUrl?: string | null,
	embedType = 'link',
	postTime?: number | null,
	format?: string | null
) {
	if (format == 'xml') {
		return new Response(null, { status: 501 });
	}

	if (!blogUrl) {
		blogUrl = `https://tumblr.com/${blogName}`;
	}
	const notes = await GetNotes(consumerID, blogName, postID, undefined, 'conversation', true);
	if (!notes.total_likes) {
		notes.total_likes = notes.notes.filter(note => note.type === 'like').length;
	}
	if (!notes.total_reblogs) {
		notes.total_reblogs = notes.notes.filter(note => note.type === 'reblog').length;
	}

	try {
		locale = Intl.getCanonicalLocales(locale?.split(',')[0])[0];
	} catch {
		locale = 'en';
	}

	const noteString = Intl.NumberFormat(locale).format(notes.total_notes);
	const reblogString = Intl.NumberFormat(locale).format(notes.total_reblogs);
	const likeString = Intl.NumberFormat(locale).format(notes.total_likes);
	const dateString = postTime
		? ` | ${Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(postTime * 1000)}`
		: '';

	const response = {
		author_name: `${noteString} 📝 | ${reblogString} 🔁 | ${likeString} ❤️${dateString}`,
		author_url: blogUrl,
		provider_name: 'txTumblr - now with collages!',
		provider_url: 'https://github.com/MarkSuckerberg/txtumblr',
		title: 'Tumblr',
		type: embedType,
		version: '1.0',
	};

	return new Response(JSON.stringify(response), {
		headers: {
			'Content-Type': 'application/json;charset=UTF-8',
			'Cache-Control': 'public, max-age=3600, stale-while-revalidate=300',
			'Vary': 'Accept-Language',
		},
	});
}

async function favico(post: TumblrBlocksPost, req: Request) {
	if (!('avatar' in post.blog)) {
		return new Response(null, { status: 404 });
	}

	const avatar = post.blog.avatar as { width: number; height: number; url: string }[];
	const smallestAvatar = avatar.at(-1);

	if (!smallestAvatar) {
		return new Response(null, { status: 404 });
	}

	const ourReq = new Request(smallestAvatar.url, {
		...req,
		headers: {
			'Accept': req.headers.get('Accept') || 'image/png',
			'Accept-Encoding': req.headers.get('Accept-Encoding') || 'br, gzip',
			'User-Agent': txtumblrVersion,
		},
	});

	const resp = (await caches.default.match(ourReq)) || (await fetch(ourReq));

	return resp;
}

function json(post: TumblrBlocksPost) {
	return new Response(JSON.stringify(post), {
		headers: {
			'content-type': 'application/json;charset=UTF-8',
		},
	});
}

function mainPage(post: TumblrBlocksPost, originalPost: TumblrBlocksPost | undefined, url: URL) {
	const trail = post.trail as TumblrBlocksPost[];
	const blocks = post.content.concat(
		trail.flatMap(trailPost => {
			return trailPost.content;
		})
	);

	const twitterCard =
		blocks.find(element => element.type == 'image' || element.type == 'video')?.type == 'video'
			? 'player'
			: 'summary_large_image';

	const textBlocks = blocks.filter(element => element.type == 'text');
	const text = textBlocks
		.map(block => block.text)
		.filter(text => text.trim().length > 0)
		.join('\n\n↱')
		.replace(/"/g, '&quot;');

	const imageBlocks = blocks.filter(element => element.type == 'image');
	const imageTags = imageBlocks.map(obj => openGraphFromMedia(obj));

	const imageIndex = url.searchParams.get('image');
	const imagesToShow = imageIndex ? imageTags[+imageIndex - 1] : imageTags.join('\n');

	const videoBlocks = blocks.filter(element => element.type == 'video') as TumblrNeueVideoBlock[];
	const videoUrls = videoBlocks.map(block => block.url || block.media.url);
	const videoTags = videoUrls.map(
		videoUrl => `<meta property="og:video" content="${videoUrl}" />`
	);

	const videoIndex = url.searchParams.get('video');
	const videosToShow = videoIndex ? videoTags[+videoIndex - 1] : videoTags.join('\n');

	const title = `${post.blog.name} ${
		originalPost
			? `🔁 ${originalPost.blog?.name || originalPost.broken_blog_name}`
			: post.blog.title
				? `(${post.blog.title})`
				: ''
	}`;

	const audioBlocks = blocks.filter(element => element.type == 'audio') as TumblrNeueAudioBlock[];
	const audioUrls = audioBlocks.map(block => block.url || block.media.url);
	const audioTags = audioUrls.map(
		audioUrl => `<meta property="og:audio" content="${audioUrl}" />`
	);

	const audioIndex = url.searchParams.get('audio');
	const audioToShow = audioIndex ? audioUrls[+audioIndex - 1] : audioTags.join('\n');

	const tags = post.tags.length ? `Tags: #${post.tags.join(' #')}\n` : '';
	const body = `${tags}${text}`;

	// For the old behaviour, simply do ?image&video&audio.
	const values = [];
	if (url.searchParams.has('video')) {
		values.push(videosToShow);
	}
	if (url.searchParams.has('audio')) {
		values.push(audioToShow);
	}
	if (url.searchParams.has('image')) {
		values.push(imagesToShow);
	}

	const mediaToShow = values.join('\n') || videosToShow || audioToShow || imagesToShow;

	const embedType =
		videosToShow.length > 0
			? 'video'
			: audioToShow.length > 0
				? 'audio'
				: imagesToShow.length > 0
					? 'photo'
					: 'link';

	const oembedParams = new URLSearchParams({
		username: post.blog.name,
		post_id: post.id_string,
		blog_url: post.blog.url,
		type: embedType,
		post_time: post.timestamp.toString(),
	});

	const collageUrl = new URL(url);
	collageUrl.search = 'collage';

	const collage =
		embedType == 'photo' && imageTags.length > 1
			? `<meta property="og:image" content="${collageUrl.href}" /><meta property="twitter:image" content="${collageUrl.href}" />`
			: '';

	const html = `<!DOCTYPE html>
	<head>
		<title>${title}</title>
		<meta name="description" content="${body}" />
		<link rel="canonical" href="${post.post_url}" />

		<!-- OpenGraph embed tags -->
		<meta property="og:site_name" content="txTumblr" />
		<meta property="og:type" content="website" />
		<meta property="og:title" content="${title}" />
		<meta property="og:url" content="${post.post_url}" />
		<meta property="og:description" content="${body}" />

		<!-- Twitter embed tags -->
		<meta name="twitter:card" content="${twitterCard}">
		<meta property="twitter:domain" content="tumblr.com">
		<meta property="twitter:title" content="${title}" />
		<meta property="twitter:creator" content="${post.blog_name}" />
		<meta property="twitter:site" content="${post.blog.url}" />
		<meta property="twitter:url" content="${post.post_url}" />
		<meta property="twitter:description" content="${body}" />

		${collage}

		${mediaToShow}

		<link rel="alternate" href="${post.blog.url}/rss" type="application/rss+xml" />
		<link rel="alternate" href="android-app://com.tumblr/tumblr/x-callback-url/blog?blogName=${post.blog_name}&postID=${post.id}" />
		<link rel="alternate" href="ios-app://305343404/tumblr/x-callback-url/blog?blogName=${post.blog_name}&postID=${post.id}" />
		<link
			rel="alternate"
			href="${url.protocol}//${url.hostname}/oembed?${oembedParams.toString()}"
	}"
			type="application/json+oembed"
			title="${post.blog_name}"
		/>

		${
			!url.searchParams.has('noRedirect')
				? `<meta http-equiv="refresh" content="0;url=${post.post_url}" />`
				: ''
		}

		<meta property="theme-color" content="#${
			imageBlocks.find(block => block.colors)?.colors?.c0 || '5555aa'
		}" />
	</head>
	<body>
		<p><a href="${post.post_url}">Click here if you are not redirected automatically...</a></p>
	</body>`;

	return new Response(html, {
		headers: {
			'Content-Type': 'text/html;charset=UTF-8',
			'Cache-Control': 'public, max-age=604800, stale-while-revalidate=600',
		},
	});
}

function openGraphFromMedia(block: TumblrNeueImageBlock): string {
	const media = block.media.find(media => media.has_original_dimensions) || block.media[0];

	return `<meta property="og:image" content="${media.url}" />
				<meta property="og:image:height" content="${media.height}" />
				<meta property="og:image:width" content="${media.width}" />
				<meta property="og:image:alt" content="${block.alt_text}" />
				<meta property="twitter:image" content="${media.url}" />`;
}

function errorPage(
	errorDescription: string,
	url: URL,
	status: number = 500,
	redirect: boolean = true
) {
	const pathInfo = url.pathname.split('/');
	const trimmedPathInfo = pathInfo.filter(string => string);
	const username = trimmedPathInfo[0];
	const postID = trimmedPathInfo[1];
	const postUrl = `https://www.tumblr.com/${username}/${postID}`;

	if (url.searchParams.has('noRedirect')) {
		redirect = false;
	}

	const html = `<!DOCTYPE html>
	<head>
		<title>txTumblr</title>
		<meta name="description" content="Unable to retrieve post from this link.\n\nError:\n${errorDescription}" />
		<link rel="canonical" href="${postUrl}" />
		<!-- OpenGraph embed tags -->
		<meta property="og:type" content="website" />
		<meta property="og:title" content="txTumblr" />
		<meta property="og:url" content="${postUrl}" />
		<meta property="og:description" content="Unable to retrieve post from this link.\n\nError:\n${errorDescription}" />

		<!-- Twitter embed tags -->
		<meta name="twitter:card" content="summary">
		<meta property="twitter:domain" content="tumblr.com">
		<meta property="twitter:title" content="txTumblr" />
		<meta property="twitter:url" content="${postUrl}" />
		<meta property="twitter:description" content="Unable to retrieve post from this link.\n\nError:\n${errorDescription}" />

		${redirect ? `<meta http-equiv="refresh" content="0;url=${postUrl}" />` : ''}

		<meta property="theme-color" content="#aa5555" />
	</head>
	<body>
		<p>Error retrieving post: ${errorDescription}</p>

		<p><a href="${postUrl}">${redirect ? 'Click here if you are not redirected automatically...' : 'Click here to view the source post.'}</a></p>
	</body>`;

	return new Response(html, {
		status,
		headers: {
			'content-type': 'text/html;charset=UTF-8',
		},
	});
}

interface RefreshTokenResponse {
	access_token: string;
	expires_in: number;
	token_type: string;
	scope: string;
	id_token: string;
	refresh_token: string;
}

async function refreshTokenAuth(
	consumerID: string,
	consumerSecret: string,
	refreshToken: string
): Promise<string | RefreshTokenResponse> {
	const res = await fetch('https://api.tumblr.com/v2/oauth2/token', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Accept': 'application/json',
			'User-Agent': 'txtumblr/2.0.0',
		},
		body: JSON.stringify({
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
			client_id: consumerID,
			client_secret: consumerSecret,
		}),
	});

	if (!res.ok) {
		return res.text();
	}

	return await res.json();
}

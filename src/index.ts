import {
	FetchPost,
	GetNotes,
	TumblrAPIError,
	TumblrBlocksPost,
	TumblrNeueAudioBlock,
	TumblrNeueImageBlock,
	TumblrNeueTextBlock,
	TumblrNeueVideoBlock,
} from 'typeble';

interface TumblrBotEnv {
	TUMBLR_CONSUMER_KEY: string;
	TUMBLR_CONSUMER_SECRET: string;
	AUTH: KVNamespace;
}

export default {
	async fetch(request: Request, env: TumblrBotEnv) {
		const url = new URL(request.url);
		const pathInfo = url.pathname.split('/');
		const trimmedPathInfo = pathInfo.filter(string => string);
		const username = trimmedPathInfo[0];
		const postID = trimmedPathInfo[1];

		const consumerID = env.TUMBLR_CONSUMER_KEY;
		const consumerSecret = env.TUMBLR_CONSUMER_SECRET;

		if (!trimmedPathInfo.length) {
			return Response.redirect('https://github.com/MarkSuckerberg/txtumblr', 301);
		}

		if (!Number.isInteger(+postID)) {
			return new Response('Bad post ID', { status: 400 });
		}

		if (!username) {
			return new Response('No username provided', { status: 400 });
		}

		const refreshToken = await env.AUTH.get('refresh_token');
		let accessToken = undefined;
		let tokenError = "";

		if (refreshToken) {
			const data = await refreshTokenAuth(consumerID, consumerSecret, refreshToken);

			if (typeof data === 'object') {
				await env.AUTH.put('refresh_token', data.refresh_token!);
				accessToken = data.access_token;
			} else {
				// Clear tokens if refresh fails, it will need to manually be re-added
				tokenError = data;
				await env.AUTH.put('access_token_error', data);
			}
		}

		let post;
		try {
			post = await FetchPost<TumblrBlocksPost>(
				accessToken || consumerID,
				username,
				postID,
				false,
				false,
				undefined,
				true,
				!accessToken
			);
		} catch (error) {
			const tumblrUrl = new URL(`https://www.tumblr.com/${username}/${postID}`);

			return errorPage(error, tumblrUrl, url);
		}

		const originalPost = post.trail[0] as TumblrBlocksPost;

		if (url.searchParams.has('oembed')) {
			return oembed(post, consumerID);
		} else if (url.searchParams.has('json')) {
			return json(post);
		} else {
			return mainPage(post, originalPost, url);
		}
	},
};

async function oembed(post: TumblrBlocksPost, consumerID: string) {
	const notes = await GetNotes(
		consumerID,
		post.blog.name,
		post.id_string,
		undefined,
		'conversation',
		true
	);
	if (!notes.total_likes) {
		notes.total_likes = notes.notes.filter(note => note.type === 'like').length;
	}
	if (!notes.total_reblogs) {
		notes.total_reblogs = notes.notes.filter(note => note.type === 'reblog').length;
	}
	const response = {
		author_name: `${post.note_count} 📝 | ${notes.total_reblogs} 🔁 | ${notes.total_likes} ❤️`,
		author_url: post.blog.url,
		provider_name: 'txTumblr',
		provider_url: 'https://github.com/MarkSuckerberg/txtumblr',
		title: 'Tumblr',
		type: 'link',
		version: '1.0',
	};

	return new Response(JSON.stringify(response), {
		headers: {
			'content-type': 'text/json;charset=UTF-8',
		},
	});
}

async function json(post: TumblrBlocksPost) {
	return new Response(JSON.stringify(post), {
		headers: {
			'content-type': 'text/json;charset=UTF-8',
		},
	});
}

async function mainPage(
	post: TumblrBlocksPost,
	originalPost: TumblrBlocksPost | undefined,
	url: URL
) {
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

	const textBlocks = blocks.filter(element => element.type == 'text') as TumblrNeueTextBlock[];
	const text = textBlocks
		.map(block => block.text)
		.join('\n\n')
		.replace(/"/g, '&quot;');

	const imageBlocks = blocks.filter(element => element.type == 'image') as TumblrNeueImageBlock[];
	const imageMediaObjects = imageBlocks.map(
		block => block.media.find(media => media.has_original_dimensions) || block.media[0]
	);

	const imageTags = imageMediaObjects.map(
		mediaObject =>
			`<meta property="og:image" content="${mediaObject.url}" />
				<meta property="og:image-height" content="${mediaObject.height}" />
				<meta property="og:image-width" content="${mediaObject.width}" />
				<meta property="twitter:image" content="${mediaObject.url}" />`
	);

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
			: `(${post.blog.title})`
	}`;

	const audioBlocks = blocks.filter(element => element.type == 'audio') as TumblrNeueAudioBlock[];
	const audioUrls = audioBlocks.map(block => block.url || block.media.url);
	const audioTags = audioUrls.map(
		audioUrl => `<meta property="og:audio" content="${audioUrl}" />`
	);

	const tags = post.tags.length ? `Tags: #${post.tags.join(' #')}\n` : '';
	const body = `${tags}${text}`;

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

		${videosToShow}
		${imagesToShow}
		${audioTags}

		<link
			rel="alternate"
			href="${url.protocol}//${url.hostname}${url.pathname}?oembed"
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
	</head>`;

	return new Response(html, {
		headers: {
			'content-type': 'text/html;charset=UTF-8',
		},
	});
}

async function errorPage(error: unknown, postUrl: URL, url: URL, extra?: string) {
	if (!(error instanceof TumblrAPIError)) {
		return new Response(`Error fetching post: ${error}\n${extra}`, { status: 500 });
	}

	const errorDetail = error.response.errors?.at(0)?.detail;
	const errorDescription = error.response.meta.msg + (errorDetail ? `: ${errorDetail}` : '');
	const extraInfo = extra ? `\n${extra}` : '';

	const html = `<!DOCTYPE html>
	<head>
		<title>txTumblr</title>
		<meta name="description" content="Unable to retrieve post from this link.\n\nTumblr Error:\n${errorDescription}${extraInfo}" />
		<link rel="canonical" href="${postUrl}" />
		<!-- OpenGraph embed tags -->
		<meta property="og:type" content="website" />
		<meta property="og:title" content="txTumblr" />
		<meta property="og:url" content="${postUrl}" />
		<meta property="og:description" content="Unable to retrieve post from this link.\n\nTumblr Error:\n${errorDescription}${extraInfo}" />

		<!-- Twitter embed tags -->
		<meta name="twitter:card" content="summary">
		<meta property="twitter:domain" content="tumblr.com">
		<meta property="twitter:title" content="txTumblr" />
		<meta property="twitter:url" content="${postUrl}" />
		<meta property="twitter:description" content="Unable to retrieve post from this link.\n\nTumblr Error:\n${errorDescription}${extraInfo}" />

		${
			!url.searchParams.has('noRedirect')
				? `<meta http-equiv="refresh" content="0;url=${postUrl}" />`
				: ''
		}

		<meta property="theme-color" content="#aa5555" />
	</head>`;

	return new Response(html, {
		headers: {
			'content-type': 'text/html;charset=UTF-8',
			'status': error.response.meta.status.toString(),
		},
	});
}

async function refreshTokenAuth(consumerID: string, consumerSecret: string, refreshToken: string) {
	const res = await fetch('https://api.tumblr.com/v2/oauth2/token', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Accept': 'application/json',
			'User-Agent': 'Typeble-Auth/1.1.0',
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

	return (await res.json()) as {
		access_token: string;
		expires_in: number;
		token_type: string;
		scope: string;
		id_token: string;
		refresh_token: string;
	};
}

import { TumblrBlocksPost, TumblrNeueImageBlock, TumblrNeueTextBlock } from 'typeble';

interface TumblrBotEnv {
	TUMBLR_CONSUMER_KEY: string;
}

export default {
	async fetch(request: Request, env: TumblrBotEnv) {
		const url = new URL(request.url);
		const pathInfo = url.pathname.split('/');
		const trimmedPathInfo = pathInfo.filter(string => string);
		const username = trimmedPathInfo[0];
		const postID = trimmedPathInfo[1];

		if (!trimmedPathInfo.length) {
			return Response.redirect('https://github.com/MarkSuckerberg/txtumblr', 301);
		}

		if (!Number.isInteger(+postID)) {
			return new Response('Bad post ID', { status: 400 });
		}

		if (!username) {
			return new Response('No username provided', { status: 400 });
		}

		//TODO: Make this properly use typeble
		const postResponse = await fetch(
			`https://www.tumblr.com/api/v2/blog/${username}/posts?api_key=${env.TUMBLR_CONSUMER_KEY}&id=${postID}&npf=true`
		);
		const postData: any = await postResponse.json();

		if (!postData['response']['posts']) {
			return new Response('Post not found', { status: 404 });
		}

		const post = postData['response']['posts'][0] as TumblrBlocksPost;
		const originalPost = post.trail[0] as TumblrBlocksPost;

		if (url.searchParams.has('oembed')) {
			return oembed(post);
		} else if (url.searchParams.has('json')) {
			return new Response(JSON.stringify(post), {
				headers: {
					'content-type': 'text/json;charset=UTF-8',
				},
			});
		} else {
			return mainPage(post, originalPost, url);
		}
	},
};

function oembed(post: TumblrBlocksPost): Response {
	const response = {
		author_name: `${post.note_count} 📝`,
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

function mainPage(
	post: TumblrBlocksPost,
	originalPost: TumblrBlocksPost | undefined,
	url: URL
): Response {
	const blocks = originalPost ? originalPost.content.concat(post.content) : post.content;

	const textBlocks = blocks.filter(element => element.type == 'text') as TumblrNeueTextBlock[];
	const text = textBlocks.map(block => block.text).join('\n\n');

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
	const imagesToShow = imageIndex ? imageTags[+imageIndex + 1] : imageTags.join('\n');

	const title = `${post.blog.name} ${
		originalPost ? `🔁 ${originalPost.blog.name}` : `(${post.blog.title})`
	}`;

	const html = `<!DOCTYPE html>
	<head>
		<title>${title}</title>
		<meta name="description" content="${text}" />
		<link rel="canonical" href="${post.post_url} />

		<!-- OpenGraph embed tags -->
		<meta property="og:site_name" content="txTumblr" />
		<meta property="og:type" content="website" />
		<meta property="og:title" content="${title}" />
		<meta property="og:url" content="${post.post_url}" />
		<meta property="og:description" content="${text}" />

		<!-- Twitter embed tags -->
		<meta name="twitter:card" content="summary_large_image">
		<meta property="twitter:domain" content="tumblr.com">
		<meta property="twitter:title" content="${title}" />
		<meta property="twitter:creator" content="${post.blog_name}" />
		<meta property="twitter:site" content="${post.blog.url}" />
		<meta property="twitter:url" content="${post.post_url}" />
		<meta property="twitter:description" content="${text}" />

		${imagesToShow}

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

		<meta property="theme-color" content="#${imageBlocks.find(block => block.colors)?.colors?.c0}" />
	</head>`;

	return new Response(html, {
		headers: {
			'content-type': 'text/html;charset=UTF-8',
		},
	});
}

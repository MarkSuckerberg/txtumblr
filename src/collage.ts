import * as JPEG from 'jpeg-js';
import { decode } from 'fast-png';
import { TumblrBlocksPost, TumblrNeueImageBlock } from 'typeble';

export function get1DPosition2D(x: number, y: number, width: number) {
	return (x % width) + y * width;
}

interface RawImage {
	data: Buffer;
	height: number;
	width: number;
}

export async function collage(post: TumblrBlocksPost, ctx: ExecutionContext) {
	const trail = post.trail as TumblrBlocksPost[];
	const blocks = post.content.concat(
		trail.flatMap(trailPost => {
			return trailPost.content;
		})
	);

	const imageBlocks = blocks.filter(element => element.type == 'image') as TumblrNeueImageBlock[];

	if (imageBlocks.length < 1) {
		return new Response('post has no image', { status: 404 });
	}
	if (imageBlocks.length < 2) {
		return new Response('pointless to collage, only one image', { status: 404 });
	}

	const bgColorStr = (imageBlocks.find(block => block.colors?.c0)?.colors!.c0 || '888888') + '00';

	const possibleWidths = imageBlocks[0].media.map(media => media.width);

	const widths = new Array<number>(possibleWidths.length);
	let matchingWidth = possibleWidths.find((current, widthIndex) =>
		imageBlocks.every((value, blockIndex) => {
			if (
				value.media.find(
					media => media.width && media.width <= 500 && media.width == current
				)
			) {
				return true;
			}

			//Set the highest index this particular width got
			widths[widthIndex] = blockIndex;
			return false;
		})
	);

	if (!matchingWidth) {
		//Use the most largest (ish) most commonly found width, or just 250 if all else fails.
		matchingWidth = possibleWidths.at(widths.indexOf(Math.max(...widths))) || 250;
	}

	const imageMediaObjects = imageBlocks
		.map(block => block.media.find(media => media.width == matchingWidth))
		.filter(media => media != undefined)
		.filter(media => media.type == 'image/png' || media.type == 'image/jpeg');

	if (imageMediaObjects.length < 2) {
		return new Response('Not enough images of the same crop width', { status: 404 });
	}

	const maxMemory = 64 / imageMediaObjects.length;

	const cols = 1 + Math.ceil(imageMediaObjects.length / 6);
	const rows = Math.ceil(imageMediaObjects.length / cols);

	let colHeights = new Array<number>(cols).fill(0);
	imageMediaObjects.forEach((image, index) => {
		const col = Math.floor(index / rows);

		colHeights[col] += image.height || 0;
	});

	const width = matchingWidth * cols;
	const height = Math.max(...colHeights);
	const channels = 4;

	const outBuf = Buffer.alloc(width * height * channels, bgColorStr, 'hex');
	let originX = 0;
	let originY = 0;

	const rawImageData = {
		data: outBuf,
		width: width,
		height: height,
	};

	for (let col = 0; col < cols; col++) {
		const colOffset = Math.floor(((1 - colHeights[col] / height) * height) / 2);

		for (let row = 0; row < rows; row++) {
			const imageIndex = col * rows + row;
			if (imageIndex > imageMediaObjects.length) {
				break;
			}
			const image = imageMediaObjects[imageIndex];

			const req = (await caches.default.match(image.url)) || (await fetch(image.url));
			ctx.waitUntil(caches.default.put(image.url, req.clone()));

			if (!req.ok) {
				continue;
			}

			try {
				const inBuf = await req.arrayBuffer();
				let data: RawImage;

				if (image.type == 'image/jpeg') {
					data = JPEG.decode(inBuf, {
						maxMemoryUsageInMB: maxMemory,
					});
				} else {
					const pngData = decode(inBuf);
					data = {
						height: pngData.height,
						width: pngData.width,
						data: Buffer.from(pngData.data.buffer),
					};
				}

				const offsetX = Math.round((matchingWidth - data.width) / 2);
				for (let index = 0; index < height; index++) {
					const pos =
						get1DPosition2D(originX + offsetX, originY + index + colOffset, width) *
						channels;

					data.data.copy(
						outBuf,
						pos,
						index * data.width * channels,
						index * data.width * channels + data.width * channels
					);
				}
				originY += data.height;
			} catch {
				originY += Math.round(height / rows);
			}
		}
		originY = 0;
		originX += matchingWidth;
	}

	const filename = `${post.blog_name}_${post.id_string}`;

	return new Response(JPEG.encode(rawImageData, 50).data, {
		headers: {
			'Content-Type': 'image/jpeg',
			'Content-Disposition': `inline; filename="${filename}.png"`,
			'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400, immutable',
		},
	});
}

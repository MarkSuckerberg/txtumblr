import * as JPEG from 'jpeg-js';
import * as PNG from 'fast-png';
import { TumblrBlocksPost, TumblrMediaObject, TumblrNeueImageBlock } from 'typeble';
import { txTumblrError, txtumblrVersion } from './types';

export function get1DPosition2D(x: number, y: number, width: number) {
	return (x % width) + y * width;
}

interface RawImage {
	data: Buffer;
	height: number;
	width: number;
	channels: number;
}

export async function collage(
	post: TumblrBlocksPost,
	ctx: ExecutionContext,
	params: URLSearchParams
) {
	const trail = post.trail as TumblrBlocksPost[];
	const blocks = post.content.concat(
		trail.flatMap(trailPost => {
			return trailPost.content;
		})
	);

	const imageBlocks = blocks.filter(element => element.type == 'image');

	if (imageBlocks.length < 1) {
		throw new txTumblrError('Post has no image', 404, false);
	}
	if (imageBlocks.length < 2) {
		throw new txTumblrError('Pointless to collage, only one image', 404, false);
	}

	const matchingWidth = findIdealWidth(imageBlocks);

	const imageMediaObjects = imageBlocks
		.map(block => block.media.find(media => media.width == matchingWidth))
		.filter(media => media != undefined)
		.filter(media => media.type == 'image/png' || media.type == 'image/jpeg');

	if (imageMediaObjects.length < 2) {
		throw new txTumblrError('Not enough images of the same crop width', 404, false);
	}

	const rawImageData = await createCollage(
		imageMediaObjects,
		matchingWidth,
		getColorStr(imageBlocks),
		ctx
	);

	const filename = `${post.blog_name}_${post.id_string}`;

	switch (params.get('format')) {
		case 'bmp':
			return new Response(BMPencode(rawImageData), {
				headers: {
					'Content-Type': 'image/bmp',
					'Content-Disposition': `inline; filename="${filename}.bmp"`,
					'Cache-Control':
						'public, max-age=604800, stale-while-revalidate=86400, immutable',
				},
			});
		case 'png':
			return new Response(PNG.encode(rawImageData, { zlib: { level: 1 } }), {
				headers: {
					'Content-Type': 'image/png',
					'Content-Disposition': `inline; filename="${filename}.png"`,
					'Cache-Control':
						'public, max-age=604800, stale-while-revalidate=86400, immutable',
				},
			});
		case 'jpg':
		default:
			return new Response(JPEG.encode(rawImageData).data, {
				headers: {
					'Content-Type': 'image/jpeg',
					'Content-Disposition': `inline; filename="${filename}.jpg"`,
					'Cache-Control':
						'public, max-age=604800, stale-while-revalidate=86400, immutable',
				},
			});
	}
}

async function createCollage(
	imageMediaObjects: TumblrMediaObject[],
	matchingWidth: number,
	bgColorStr: string = '88888800',
	ctx: ExecutionContext
): Promise<RawImage> {
	const cols = 1 + Math.ceil(imageMediaObjects.length / 6);
	const rows = Math.ceil(imageMediaObjects.length / cols);

	const colHeights = new Array<number>(cols).fill(0);
	imageMediaObjects.forEach((image, index) => {
		const col = Math.floor(index / rows);

		colHeights[col] += image.height || 0;
	});

	const width = matchingWidth * cols;
	const height = Math.max(...colHeights);
	const channels = 4;

	const outBuf = Buffer.alloc(width * height * channels, bgColorStr, 'hex');

	const rawImageData: RawImage = {
		data: outBuf,
		width: width,
		height: height,
		channels: channels,
	};

	//const promises: Promise<void>[] = [];

	for (let col = 0; col < cols; col++) {
		const colOffset = Math.floor(((1 - colHeights[col] / height) * height) / 2);

		await addRow(rawImageData, imageMediaObjects, rows, col, matchingWidth, ctx, colOffset);
	}

	//await Promise.allSettled(promises);

	return rawImageData;
}

function BMPencode(image: RawImage) {
	const headerSize = 0x7a;
	const outBuffer = Buffer.allocUnsafe(image.data.length + headerSize);
	const view = new DataView(outBuffer.buffer);

	outBuffer.write('BM', 0); //Header
	view.setUint32(2, outBuffer.byteLength, true); //Filesize
	outBuffer.write('\x00\x00\x00\x00', 6); //Empty
	view.setUint32(10, headerSize, true); // Start of pixmap

	// DIB

	view.setUint32(14, headerSize - 14, true); //DIB size
	view.setInt32(18, image.width, true);
	view.setInt32(22, -image.height, true);
	view.setUint16(26, 1, true); //Color planes
	view.setUint16(28, 32, true); //Bits per pixel
	view.setUint32(30, 3, true); //Compression method
	view.setUint32(34, image.data.byteLength, true); //Image size
	view.setInt32(38, 2835, true); //pixels per metre horiz
	view.setInt32(42, 2835, true); //pixels per metre vert
	view.setUint32(46, 0, true); //# palette colours
	view.setUint32(50, 0, true); //# Important colours

	view.setUint32(54, 0xff000000); // red mask (big endian)
	view.setUint32(58, 0x00ff0000); // green
	view.setUint32(62, 0x0000ff00); // blue
	view.setUint32(66, 0x000000ff); // alph

	outBuffer.write('sRGB', 70); // colour space
	// blanks until 0x7a

	image.data.copy(outBuffer, headerSize, 0, image.data.byteLength);

	return outBuffer;
}

function getColorStr(imageBlocks: TumblrNeueImageBlock[]) {
	const bgColorStr = imageBlocks.find(block => block.colors?.c0)?.colors!.c0;

	return bgColorStr ? `${bgColorStr}00` : '88888800';
}

function findIdealWidth(imageBlocks: TumblrNeueImageBlock[]) {
	const possibleWidths = imageBlocks[0].media.map(media => media.width);

	const widths = new Array<number>(possibleWidths.length);
	let matchingWidth = possibleWidths.find((current, widthIndex) =>
		imageBlocks.every((value, blockIndex) => {
			if (
				value.media.find(
					media =>
						media.width &&
						media.width <= 500 &&
						media.width > 100 &&
						media.width == current
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

	return matchingWidth;
}

const extractSizes = /\/s(\d+)x(\d+)(?:_c\d)?\//;

async function tryGetBetterUrl(image: TumblrMediaObject, idealWidth?: number) {
	const url = image.url;

	if (idealWidth) {
		url.replace(extractSizes, `/s${idealWidth}x${idealWidth}`);
	}

	if (url.endsWith('.png')) {
		const pnjUrl = url.slice(0, -4) + '.pnj';

		if ((await fetch(pnjUrl, { method: 'HEAD' })).ok) {
			return new Request(pnjUrl, {
				headers: { 'Accept': 'image/jpeg', 'User-Agent': txtumblrVersion },
			});
		}
	}

	return url;
}

async function getImageData(
	image: TumblrMediaObject,
	ctx: ExecutionContext,
	idealWidth?: number
): Promise<RawImage | undefined> {
	//const betterUrl = await tryGetBetterUrl(image, idealWidth);

	const req = (await caches.default.match(image.url)) || (await fetch(image.url));
	ctx.waitUntil(caches.default.put(image.url, req.clone()));

	if (!req.ok) {
		return;
	}

	try {
		const inBuf = await req.arrayBuffer();
		let data: RawImage;

		if (req.headers.get('content-type') == 'image/jpeg') {
			data = {
				channels: 4,
				...JPEG.decode(inBuf),
			};
		} else {
			const pngData = PNG.decode(inBuf);
			data = {
				...pngData,
				data: Buffer.from(pngData.data.buffer),
			};
		}

		return data;
	} catch (err) {
		console.error(err);
	}
}

function blitImage(collage: RawImage, image: RawImage, originX: number, originY: number) {
	for (let index = 0; index < image.height; index++) {
		const pos = get1DPosition2D(originX, originY + index, collage.width);
		const targetPos = get1DPosition2D(0, index, image.width);

		image.data.copy(
			collage.data,
			pos * collage.channels,
			targetPos * collage.channels,
			(targetPos + image.width) * collage.channels
		);
	}
}

function blitWrongChannels(collage: RawImage, image: RawImage, originX: number, originY: number) {
	for (let y = 0; y < image.height; y++) {
		for (let x = 0; x < image.width; x++) {
			const targetPos =
				get1DPosition2D(originX + x, originY + y, collage.width) * collage.channels;
			const sourcePos = get1DPosition2D(x, y, image.width) * image.channels;

			image.data.copy(collage.data, targetPos, sourcePos, sourcePos + image.channels);
		}
	}
}

async function addRow(
	collage: RawImage,
	images: TumblrMediaObject[],
	rows: number,
	col: number,
	matchingWidth: number,
	ctx: ExecutionContext,
	colOffsetY: number
): Promise<void> {
	const originX = matchingWidth * col;
	let originY = 0;

	for (let row = 0; row < rows; row++) {
		const imageIndex = col * rows + row;
		if (imageIndex >= images.length) {
			break;
		}
		const image = images[imageIndex];

		const data = await getImageData(image, ctx);

		if (!data) {
			originY += image.height || Math.round(collage.height / rows);
			continue;
		}

		try {
			const actualChannels = Math.floor(data.data.length / data.height / data.width);
			const offsetX = Math.round((matchingWidth - data.width) / 2);

			if (actualChannels != collage.channels) {
				blitWrongChannels(collage, data, originX + offsetX, originY + colOffsetY);
			} else {
				blitImage(collage, data, originX + offsetX, originY + colOffsetY);
			}

			originY += data.height;
		} catch (err) {
			console.error(err);
			originY += image.height || Math.round(collage.height / rows);
		}
	}
}

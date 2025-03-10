# TxTumblr Tumblr Unofficial Embedding Helper

## ⚠️ Notice ⚠️

This tool is **NOT** official, endorsed, sponsored by, or otherwise associated with Tumblr in any way, shape, or form.

## The Project

This project aims to create a tool for embedding multi-image and multi-post Tumblr content on Discord and similar sites that use OpenGraph information for creating embeds. It uses the Tumblr API to fetch the information, and simply sends a bare-bones HTML page with all the information necessary for an informational embed as well as a redirect meta tag so that if you go to the page in a browser, you would immediately be transferred to the actual post.

## Usage

Simply replace `tumblr.com` in links with `txtumblr.com`. This works for URLS formatted as `https://tumblr.com/USERNAME/POSTID` and `https://USERNAME.tumblr.com/POSTID`. Simply prepend `tx` to the tumblr on any post and it will attempt to fetch the information. Posts that would require a login to access cannot be embedded, but the tool will return embed information with an error that says as much.

## How to self-host (WIP)

1. Register a Tumblr app [here](https://www.tumblr.com/oauth/apps)
2. Get a [Cloudflare](https://cloudflare.com/) account if you don't already have one
3. [Install Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (used to deploy the code)
4. Replace the consumer key in `wrangler.toml` with the one from your Tumblr app
5. Create a Cloudflare worker with an environment secret of `TUMBLR_CONSUMER_SECRET` set to the secret key from your Tumblr app
6. Use like you would the main application

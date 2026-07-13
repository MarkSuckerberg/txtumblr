export const txtumblrVersion = 'txtumblr/0.1.0';

export class txTumblrError extends Error {
	status: number;
	message: string;
	redirect: boolean;

	constructor(message: string, status: number = 500, redirect = true) {
		super();

		this.status = status;
		this.message = message;
		this.redirect = redirect;
	}
}

export interface DBRefreshToken {
	RetrievedTime: number;
	ExpiresTime: number;
	AccessToken: string;
	RefreshToken: string;
	Expired?: boolean;
}
